import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { UserModel, WalletModel } from '../models/index.js'
import { SessionModel } from '../models/session.model.js'

export const SESSION_COOKIE = 'sg_session'
export const CHALLENGE_COOKIE = 'sg_wallet_flow'
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

export function readTokenCookie(req: Request, name: string): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  if (matches.length !== 1) return undefined
  const value = matches[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
}

const cookieOptions = () => ({
  httpOnly: true, sameSite: 'strict' as const, path: '/api',
  secure: env.NODE_ENV === 'production' || new URL(env.CLIENT_URL).protocol === 'https:',
})

export function setTokenCookie(res: Response, name: string, token: string, maxAge: number) {
  res.cookie(name, token, { ...cookieOptions(), maxAge })
}

export function clearTokenCookie(res: Response, name: string) {
  res.clearCookie(name, cookieOptions())
}

export async function findSession(req: Request) {
  const token = readTokenCookie(req, SESSION_COOKIE)
  if (!token) return null
  const session = await SessionModel.findOne({
    tokenHash: hashToken(token), expiresAt: { $gt: new Date() }, revokedAt: { $exists: false },
  })
  if (!session) return null
  const [user, wallet] = await Promise.all([
    UserModel.findOne({ _id: session.ownerUserId, status: 'ACTIVE' }),
    WalletModel.findOne({ _id: session.walletId, ownerUserId: session.ownerUserId,
      network: `near:${env.NEAR_NETWORK_ID}`, verificationStatus: 'VERIFIED', revokedAt: { $exists: false } }),
  ])
  return user && wallet ? { session, user, wallet } : null
}

export type AuthContext = NonNullable<Awaited<ReturnType<typeof findSession>>>

export async function requireSession(req: Request): Promise<AuthContext> {
  const context = await findSession(req)
  if (!context) throw new AppError(401, 'AUTH_REQUIRED', 'Connect and verify your wallet to continue.')
  return context
}

export async function createSession(ownerUserId: AuthContext['user']['_id'], walletId: AuthContext['wallet']['_id']) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
  await SessionModel.create({ ownerUserId, walletId, tokenHash: hashToken(token), expiresAt })
  return { token, expiresAt, maxAge: SESSION_LIFETIME_MS }
}

export async function revokeSession(req: Request) {
  const token = readTokenCookie(req, SESSION_COOKIE)
  if (token) await SessionModel.updateOne({ tokenHash: hashToken(token), revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
}

export function walletDto(wallet: AuthContext['wallet']) {
  return { id: wallet.id, address: wallet.address, network: wallet.network,
    verificationStatus: wallet.verificationStatus, verifiedAt: wallet.verifiedAt, revokedAt: wallet.revokedAt }
}

export function sessionDto(context: AuthContext) {
  return { user: { id: context.user.id }, wallet: walletDto(context.wallet), expiresAt: context.session.expiresAt }
}
