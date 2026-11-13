import { createHash } from 'node:crypto'
import { PublicKey } from '@near-js/crypto'
import { serialize } from 'borsh'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'

// NEAR account IDs use canonical lowercase ASCII and cannot contain adjacent separators.
export const nearAccountIdSchema = z.string().min(2).max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)

export interface Nep413Payload {
  message: string
  nonce: string
  recipient: string
}

// Same Borsh field order and domain-separation tag as NEAR Wallet Selector's
// official NEP-413 helper. Meteor returns signatures without a callback URL.
export function nep413Hash(payload: Nep413Payload): Uint8Array {
  const bytes = serialize({ struct: {
    tag: 'u32', message: 'string', nonce: { array: { type: 'u8', len: 32 } },
    recipient: 'string', callbackUrl: { option: 'string' },
  } }, { message: payload.message, recipient: payload.recipient, tag: 2147484061,
    nonce: Buffer.from(payload.nonce, 'base64'), callbackUrl: null })
  return createHash('sha256').update(bytes).digest()
}

export function verifyNep413Signature(payload: Nep413Payload, publicKey: string, signature: string): boolean {
  try {
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey)) return false
    const signatureBytes = Buffer.from(signature, 'base64')
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature) return false
    const key = PublicKey.from(publicKey)
    return key.verify(nep413Hash(payload), signatureBytes)
  } catch {
    return false
  }
}

const rpcResultSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.literal('spendguard-wallet-key'),
  result: z.object({ permission: z.unknown(), block_height: z.number().int().nonnegative(), block_hash: z.string().min(1) }),
})

export async function verifyFullAccessKey(accountId: string, publicKey: string): Promise<void> {
  const url = env.NEAR_RPC_URL ?? `https://rpc.${env.NEAR_NETWORK_ID}.near.org`
  const signal = AbortSignal.timeout(env.NEAR_RPC_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'spendguard-wallet-key', method: 'query', params: {
        request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey,
      } }),
    })
    if (!response.ok) throw new Error('RPC unavailable')
    const data: unknown = await response.json()
    // Documented absent account/key errors mean the claimed key is not an owner key.
    const error = z.object({ error: z.object({ cause: z.object({ name: z.string() }) }) }).safeParse(data)
    if (error.success && ['UNKNOWN_ACCOUNT', 'UNKNOWN_ACCESS_KEY'].includes(error.data.error.cause.name)) {
      throw new AppError(401, 'WALLET_KEY_NOT_AUTHORIZED', 'The signing key is not a full-access key on this NEAR account.')
    }
    const parsed = rpcResultSchema.safeParse(data)
    if (!parsed.success) throw new Error('Invalid RPC response')
    if (parsed.data.result.permission !== 'FullAccess') {
      throw new AppError(401, 'WALLET_KEY_NOT_AUTHORIZED', 'The signing key is not a full-access key on this NEAR account.')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    // Discard RPC bodies and transport errors; authentication fails safely.
    throw new AppError(503, 'WALLET_VERIFICATION_UNAVAILABLE', 'NEAR ownership verification is unavailable. Please try again.')
  }
}
