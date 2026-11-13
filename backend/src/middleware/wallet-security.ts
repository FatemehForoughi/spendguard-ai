import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'

export const walletOriginGuard: RequestHandler = (req, _res, next) => {
  if (req.headers.origin !== new URL(env.CLIENT_URL).origin) {
    return next(new AppError(403, 'INVALID_ORIGIN', 'Open SpendGuard in its configured website to connect your wallet.'))
  }
  if (env.NODE_ENV === 'production' && new URL(env.CLIENT_URL).protocol !== 'https:') {
    return next(new AppError(503, 'WALLET_AUTH_NOT_CONFIGURED', 'Secure wallet sign-in is not configured.'))
  }
  next()
}

// Fixed-window limits bound challenge creation and expensive verification work.
// This is per API process; distributed deployments should also rate-limit at the gateway.
export function walletRateLimit(limit: number, windowMs = 60_000): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return (req, res, next) => {
    const now = Date.now()
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
    const key = req.ip ?? 'unknown'
    if (!buckets.has(key) && buckets.size >= 10_000) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000))
      return next(new AppError(429, 'WALLET_RATE_LIMITED', 'Too many wallet requests. Please wait a minute and try again.'))
    }
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + windowMs }
    bucket.count++
    buckets.set(key, bucket)
    if (bucket.count > limit) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
      return next(new AppError(429, 'WALLET_RATE_LIMITED', 'Too many wallet requests. Please wait a minute and try again.'))
    }
    next()
  }
}
