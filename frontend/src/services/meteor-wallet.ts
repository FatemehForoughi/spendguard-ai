import { Buffer } from 'buffer'
import type { MeteorWallet } from '@meteorwallet/sdk'
import type { WalletChallenge } from '../types/wallet'
import { ApiError } from './http'

let walletPromise: Promise<{ wallet: MeteorWallet; networkId: 'mainnet' | 'testnet' }> | undefined

export async function prepareMeteorWallet(networkId: 'mainnet' | 'testnet') {
  if (!walletPromise) {
    walletPromise = (async () => {
      // The wallet SDK includes Node-compatible utilities. Supply only the
      // browser global and Buffer shims it needs before loading those modules.
      const browserGlobals = globalThis as unknown as {
        global?: typeof globalThis
        Buffer?: typeof Buffer
        process?: { env: Record<string, string>; nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void }
      }
      browserGlobals.global ??= globalThis
      browserGlobals.Buffer ??= Buffer
      browserGlobals.process ??= { env: {}, nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)) }
      const { MeteorWallet } = await import('@meteorwallet/sdk')
      // Ownership signing never needs browser access keys. Avoid SDK init(),
      // which clears stored keys, and make all key-store writes fail explicitly.
      const rejectKeyWrite = async () => { throw new Error('Ownership verification cannot write access keys.') }
      const keyStore: ConstructorParameters<typeof MeteorWallet>[0]['keyStore'] = {
        setKey: rejectKeyWrite, removeKey: rejectKeyWrite, clear: rejectKeyWrite,
        getKey: async () => { throw new Error('Ownership verification does not use browser access keys.') },
        getNetworks: async () => [], getAccounts: async () => [],
      }
      return { wallet: new MeteorWallet({ networkId, appKeyPrefix: 'spendguard_ownership', keyStore }), networkId }
    })().catch((error) => { walletPromise = undefined; throw error })
  }
  const prepared = await walletPromise
  if (prepared.networkId !== networkId) throw new Error('The wallet network changed. Reload SpendGuard.')
  return prepared.wallet
}

export async function signWalletChallenge(challenge: WalletChallenge) {
  const wallet = await prepareMeteorWallet(challenge.networkId)
  // Sign only the exact backend-issued NEP-413 message. Do not call signIn,
  // request access keys, import accounts, or sign/send transactions.
  try {
    // Let Meteor select from its own unlocked accounts. In a message-only flow,
    // do not send a local sign-in account or an optional account filter. The
    // reviewed message and backend verification still bind the exact account.
    const response = await wallet.signMessage({
      message: challenge.message, recipient: challenge.recipient,
      nonce: Buffer.from(challenge.nonce, 'base64'), state: challenge.challengeId,
    })
    return response.payload
  } catch (failure) {
    const reason = typeof failure === 'object' && failure !== null && '_reason' in failure ? failure._reason : failure
    const tags = typeof reason === 'object' && reason !== null && 'endTags' in reason && Array.isArray(reason.endTags)
      ? reason.endTags : []
    if (tags.some(tag => ['POPUP_WINDOW_OPEN_FAILED', 'POPUP_WINDOW_REFUSED'].includes(tag))) {
      throw new ApiError('Allow pop-ups for SpendGuard, then start wallet verification again.', 'WALLET_POPUP_BLOCKED')
    }
    if (tags.includes('NO_ACCOUNTS')) {
      throw new ApiError(`Meteor could not find an account on NEAR ${challenge.networkId === 'mainnet' ? 'Mainnet' : 'Testnet'}. Open wallet.meteorwallet.app in this same browser profile, unlock your account, then start verification again.`, 'METEOR_ACCOUNT_UNAVAILABLE')
    }
    if (tags.some(tag => ['WINDOW_CLOSED', 'USER_CANCELLED', 'INCOMPLETE_ACTION'].includes(tag))) {
      throw new ApiError('The ownership message was not approved in Meteor. Please start again.', 'WALLET_SIGNING_CANCELLED')
    }
    throw new ApiError('Meteor could not sign the ownership message. Unlock your wallet and approve the message, then try again.', 'WALLET_SIGNING_FAILED')
  }
}

export async function signOwnerIntent(networkId:'mainnet'|'testnet', payload:{message:string;recipient:string;nonce:string}, accountId:string, publicKey:string) {
  const result=await signWalletChallenge({ networkId, ...payload, accountId, challengeId:crypto.randomUUID(), expiresAt:new Date(Date.now()+300_000).toISOString() })
  if (!result || result.accountId!==accountId || result.publicKey!==publicKey) throw new ApiError('Select the registered owner account and signing key in Meteor.','OWNER_ACCOUNT_MISMATCH')
  return {payload,publicKey:result.publicKey,signature:result.signature}
}
