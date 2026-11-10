import type { ErrorRequestHandler } from 'express'
import OpenAI from 'openai'
import { AppError } from '../errors/app-error.js'

function userError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof OpenAI.RateLimitError) {
    return new AppError(429, 'AI_RATE_LIMITED', 'The analysis service is busy. Please wait a moment and try again.')
  }
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
  ) {
    return new AppError(504, 'AI_TIMEOUT', 'The analysis took too long. Please try again.')
  }
  if (error instanceof OpenAI.APIError) {
    return new AppError(503, 'AI_UNAVAILABLE', 'The analysis service is unavailable right now. Please try again shortly.')
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.too.large') {
      return new AppError(413, 'REQUEST_TOO_LARGE', 'Your request is too large. Please shorten the transaction description.')
    }
    if (error.type === 'entity.parse.failed') {
      return new AppError(400, 'INVALID_REQUEST', 'The request could not be read. Please check your transaction description and try again.')
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error)
  const failure = userError(error)
  console.error('Request failed:', error)
  return res.status(failure.statusCode).json({
    success: false,
    code: failure.code,
    message: failure.message,
  })
}
