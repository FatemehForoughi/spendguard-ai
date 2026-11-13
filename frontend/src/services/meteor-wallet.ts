import { Buffer } from 'buffer'
import type { WalletSelector } from '@near-wallet-selector/core'
import type { WalletChallenge } from '../types/wallet'

let selectorPromise: Promise<WalletSelector> | undefined

export async function prepareMeteorWallet(networkId: 'mainnet' | 'testnet') {
  if (!selectorPromise) {
    selectorPromise = (async () => {
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
      const [{ setupWalletSelector }, { setupMeteorWallet }] = await Promise.all([
        import('@near-wallet-selector/core'), import('@near-wallet-selector/meteor-wallet'),
      ])
      return setupWalletSelector({ network: networkId, modules: [setupMeteorWallet()], debug: false })
    })().catch((error) => { selectorPromise = undefined; throw error })
  }
  const selector = await selectorPromise
  if (selector.options.network.networkId !== networkId) throw new Error('The wallet network changed. Reload SpendGuard.')
  return selector.wallet('meteor-wallet')
}

export async function signWalletChallenge(challenge: WalletChallenge) {
  const wallet = await prepareMeteorWallet(challenge.networkId)
  if (!wallet.signMessage) throw new Error('This wallet cannot sign ownership messages.')
  // Sign only the exact backend-issued NEP-413 message. Do not call signIn,
  // request access keys, import accounts, or sign/send transactions.
  return wallet.signMessage({
    message: challenge.message, recipient: challenge.recipient,
    nonce: Buffer.from(challenge.nonce, 'base64'), state: challenge.challengeId,
  })
}
