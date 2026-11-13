import { ApiError, requestJson } from './http'
import type { WalletChallenge, WalletConfig, WalletSession, SignedWalletMessage } from '../types/wallet'

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const invalid = () => new ApiError('We could not read the wallet response. Please try again.', 'INVALID_WALLET_RESPONSE')
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

async function walletRequest(path: string, body?: unknown) {
  const response = await requestJson<{ success: true; data: unknown }>(`${API_BASE_URL}/api/${path}`, {
    credentials: 'include', signal: AbortSignal.timeout(20_000),
    ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!('data' in response)) throw invalid()
  return response.data
}

export function parseWalletSession(value: unknown): WalletSession | null {
  if (value === null) return null
  if (!object(value) || !object(value.user) || typeof value.user.id !== 'string' ||
    !object(value.wallet) || typeof value.wallet.id !== 'string' || typeof value.wallet.address !== 'string' ||
    !['near:mainnet', 'near:testnet'].includes(String(value.wallet.network)) ||
    value.wallet.verificationStatus !== 'VERIFIED' || !date(value.wallet.verifiedAt) ||
    value.wallet.revokedAt != null || !date(value.expiresAt)) throw invalid()
  return value as unknown as WalletSession
}

export async function getWalletConfig(): Promise<WalletConfig> {
  const value = await walletRequest('wallet/config')
  if (!object(value) || !['mainnet', 'testnet'].includes(String(value.networkId)) ||
    value.walletProvider !== 'meteor-wallet' || typeof value.challengeLifetimeSeconds !== 'number') throw invalid()
  return value as unknown as WalletConfig
}

export async function getWalletSession(): Promise<WalletSession | null> {
  return parseWalletSession(await walletRequest('auth/session'))
}

export async function getWalletChallenge(accountId: string): Promise<WalletChallenge> {
  const value = await walletRequest('wallet/challenges', { accountId })
  if (!object(value) || typeof value.challengeId !== 'string' || value.accountId !== accountId ||
    !['mainnet', 'testnet'].includes(String(value.networkId)) || typeof value.message !== 'string' ||
    typeof value.recipient !== 'string' || typeof value.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(value.nonce) || !date(value.expiresAt)) throw invalid()
  return value as unknown as WalletChallenge
}

export async function submitWalletProof(challengeId: string, proof: SignedWalletMessage): Promise<WalletSession> {
  const session = parseWalletSession(await walletRequest('wallet/verify', {
    challengeId, accountId: proof.accountId, publicKey: proof.publicKey, signature: proof.signature,
  }))
  if (!session) throw invalid()
  return session
}

export async function logoutWallet(): Promise<void> {
  await walletRequest('auth/logout', {})
}
