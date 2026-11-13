import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { walletOriginGuard, walletRateLimit } from '../middleware/wallet-security.js'
import { WalletModel } from '../models/index.js'
import { nearAccountIdSchema } from '../services/near-wallet-verifier.js'
import {
  CHALLENGE_COOKIE, SESSION_COOKIE, clearTokenCookie, createSession, findSession,
  readTokenCookie, requireSession, revokeSession, sessionDto, setTokenCookie, walletDto,
} from '../services/session.service.js'
import { CHALLENGE_LIFETIME_MS, issueWalletChallenge, verifyWalletOwnership } from '../services/wallet.service.js'

const challengeRequest = z.strictObject({ accountId: nearAccountIdSchema })
const proofRequest = z.strictObject({
  challengeId: z.uuid(), accountId: nearAccountIdSchema,
  publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  signature: z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/),
})

// Avoid retaining request bodies, signatures, cookies, or raw database errors in logs.
const safeRoute = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next) } catch (error) {
    next(error instanceof AppError ? error : new AppError(503, 'WALLET_SERVICE_UNAVAILABLE', 'Wallet sign-in is unavailable. Please try again.'))
  }
}

export const walletRoutes = Router()
export const authRoutes = Router()

for (const router of [walletRoutes, authRoutes]) router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

walletRoutes.get('/config', (_req, res) => {
  res.json({ success: true, data: { networkId: env.NEAR_NETWORK_ID, walletProvider: 'meteor-wallet', challengeLifetimeSeconds: CHALLENGE_LIFETIME_MS / 1000 } })
})

walletRoutes.post('/challenges', walletOriginGuard, walletRateLimit(10), safeRoute(async (req, res) => {
  const parsed = challengeRequest.safeParse(req.body)
  if (!parsed.success) throw new AppError(400, 'INVALID_WALLET_REQUEST', 'Please select a valid NEAR wallet account.')
  const context = await findSession(req)
  const result = await issueWalletChallenge(parsed.data.accountId, context)
  setTokenCookie(res, CHALLENGE_COOKIE, result.browserToken, CHALLENGE_LIFETIME_MS)
  res.status(201).json({ success: true, data: result.challenge })
}))

walletRoutes.post('/verify', walletOriginGuard, walletRateLimit(10), safeRoute(async (req, res) => {
  const parsed = proofRequest.safeParse(req.body)
  if (!parsed.success) throw new AppError(400, 'INVALID_WALLET_PROOF', 'The wallet returned an invalid ownership proof. Please start again.')
  const context = await findSession(req)
  const result = await verifyWalletOwnership(parsed.data, readTokenCookie(req, CHALLENGE_COOKIE), context)
  const session = await createSession(result.user._id, result.wallet._id)
  await revokeSession(req)
  setTokenCookie(res, SESSION_COOKIE, session.token, session.maxAge)
  clearTokenCookie(res, CHALLENGE_COOKIE)
  res.json({ success: true, data: { user: { id: result.user.id }, wallet: walletDto(result.wallet), expiresAt: session.expiresAt } })
}))

walletRoutes.get('/', safeRoute(async (req, res) => {
  const context = await requireSession(req)
  const wallets = await WalletModel.find({ ownerUserId: context.user._id }).sort({ createdAt: -1 })
  res.json({ success: true, data: wallets.map(walletDto) })
}))

walletRoutes.get('/:id', safeRoute(async (req, res) => {
  const context = await requireSession(req)
  const id = z.string().regex(/^[a-fA-F0-9]{24}$/).safeParse(req.params.id)
  if (!id.success) throw new AppError(400, 'INVALID_WALLET_ID', 'That wallet link is invalid.')
  const wallet = await WalletModel.findOne({ _id: id.data, ownerUserId: context.user._id })
  if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'That wallet could not be found.')
  res.json({ success: true, data: walletDto(wallet) })
}))

authRoutes.get('/session', safeRoute(async (req, res) => {
  const context = await findSession(req)
  if (!context) clearTokenCookie(res, SESSION_COOKIE)
  res.json({ success: true, data: context ? sessionDto(context) : null })
}))

authRoutes.post('/logout', walletOriginGuard, safeRoute(async (req, res) => {
  await revokeSession(req)
  clearTokenCookie(res, SESSION_COOKIE)
  clearTokenCookie(res, CHALLENGE_COOKIE)
  res.json({ success: true, data: null })
}))
