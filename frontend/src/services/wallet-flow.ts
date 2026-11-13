import { computed, ref } from 'vue'
import type { WalletChallenge, WalletConfig, WalletSession, SignedWalletMessage } from '../types/wallet'

export interface WalletDependencies {
  getConfig(): Promise<WalletConfig>
  getSession(): Promise<WalletSession | null>
  getChallenge(accountId: string): Promise<WalletChallenge>
  prepareWallet(network: 'mainnet' | 'testnet'): Promise<unknown>
  signChallenge(challenge: WalletChallenge): Promise<SignedWalletMessage | void>
  submitProof(challengeId: string, proof: SignedWalletMessage): Promise<WalletSession>
  logout(): Promise<void>
  host: string
  now?: () => number
}

export function createWalletFlow(api: WalletDependencies) {
  const now = api.now ?? Date.now
  const session = ref<WalletSession | null>(null)
  const config = ref<WalletConfig | null>(null)
  const challenge = ref<WalletChallenge | null>(null)
  const accountId = ref('')
  const dialogOpen = ref(false)
  const busy = ref<'loading' | 'preparing' | 'signing' | 'verifying' | 'disconnecting' | ''>('')
  const error = ref('')
  const connectionError = ref('')
  const sessionReady = ref(false)
  const ready = computed(() => Boolean(config.value && sessionReady.value))
  const verified = computed(() => Boolean(session.value && session.value.wallet.verificationStatus === 'VERIFIED'))
  const networkLabel = computed(() => config.value ? `NEAR ${config.value.networkId === 'mainnet' ? 'Mainnet' : 'Testnet'}` : 'NEAR')

  function acceptSession(value: WalletSession | null) {
    session.value = value && Date.parse(value.expiresAt) > now() &&
      value.wallet.verificationStatus === 'VERIFIED' && value.wallet.network === `near:${config.value?.networkId}` ? value : null
  }

  async function initialize() {
    if (busy.value) return
    busy.value = 'loading'
    error.value = ''
    connectionError.value = ''
    try {
      const [settings, currentSession] = await Promise.allSettled([api.getConfig(), api.getSession()])
      config.value = settings.status === 'fulfilled' ? settings.value : null
      sessionReady.value = settings.status === 'fulfilled' && currentSession.status === 'fulfilled'
      acceptSession(currentSession.status === 'fulfilled' ? currentSession.value : null)
      if (!ready.value) connectionError.value = 'Wallet connection is unavailable. Please try again shortly.'
    } finally { busy.value = '' }
  }

  async function refreshSession() {
    if (busy.value) return
    if (!ready.value) return initialize()
    try {
      acceptSession(await api.getSession())
      connectionError.value = ''
    } catch {
      session.value = null
      sessionReady.value = false
      connectionError.value = 'Wallet connection is unavailable. Please try again shortly.'
    }
  }

  async function openDialog() {
    dialogOpen.value = true
    error.value = ''
    challenge.value = null
    if (!ready.value) await initialize()
  }

  function closeDialog() {
    if (busy.value) return
    dialogOpen.value = false
    challenge.value = null
    error.value = ''
  }

  async function prepareChallenge() {
    if (busy.value || !ready.value || !config.value) return
    error.value = ''
    const address = accountId.value.trim()
    if (address.length < 2 || address.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(address)) {
      error.value = 'Enter your NEAR account ID, such as user.near.'
      return
    }
    busy.value = 'preparing'
    challenge.value = null
    try {
      await api.prepareWallet(config.value.networkId)
      const value = await api.getChallenge(address)
      if (value.accountId !== address || value.networkId !== config.value.networkId ||
        value.recipient !== api.host || Date.parse(value.expiresAt) <= now()) throw new Error('The wallet verification request changed. Please start again.')
      challenge.value = value
    } catch (failure) {
      error.value = failure instanceof Error && ('code' in failure || /start again/.test(failure.message))
        ? failure.message : 'Could not prepare wallet verification. Please try again.'
    } finally { busy.value = '' }
  }

  async function verifyChallenge() {
    if (busy.value || !ready.value || !challenge.value) return
    const review = challenge.value
    if (Date.parse(review.expiresAt) <= now()) {
      challenge.value = null
      error.value = 'This verification has expired. Please start again.'
      return
    }
    busy.value = 'signing'
    error.value = ''
    try {
      const proof = await api.signChallenge(review)
      if (!proof) throw new Error('Meteor did not return a signature. Please start again.')
      if (proof.accountId !== review.accountId) throw new Error(`Meteor signed with a different account. Select ${review.accountId} and start again.`)
      if (proof.state !== review.challengeId) throw new Error('The signed verification request changed. Please start again.')
      busy.value = 'verifying'
      const result = await api.submitProof(review.challengeId, proof)
      if (result.wallet.address !== review.accountId || result.wallet.network !== `near:${review.networkId}`) {
        throw new Error('The verified wallet response did not match your request.')
      }
      acceptSession(result)
      if (!session.value) throw new Error('Your wallet session has expired. Please start again.')
      dialogOpen.value = false
    } catch (failure) {
      error.value = failure instanceof Error && 'code' in failure ? failure.message :
        (failure instanceof Error && /start again|did not match|session has expired/.test(failure.message)
          ? failure.message : 'Wallet verification was cancelled or failed. Please start again.')
    } finally {
      // A failed or ambiguous response always needs a fresh challenge.
      challenge.value = null
      busy.value = ''
    }
  }

  async function disconnect() {
    if (busy.value) return
    busy.value = 'disconnecting'
    error.value = ''
    try {
      await api.logout()
      session.value = null
      challenge.value = null
      dialogOpen.value = false
      accountId.value = ''
    } catch {
      error.value = 'Could not disconnect your wallet. Please try again.'
    } finally { busy.value = '' }
  }

  return { session, config, challenge, accountId, dialogOpen, busy, error, connectionError, ready, verified, networkLabel,
    initialize, refreshSession, openDialog, closeDialog, prepareChallenge, verifyChallenge, disconnect }
}

export type WalletFlow = ReturnType<typeof createWalletFlow>
