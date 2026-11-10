export class ApiError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function fallbackMessage(status: number): string {
  if (status === 400 || status === 422) return 'Please check your transaction description and try again.'
  if (status === 404) return 'The requested information could not be found.'
  if (status === 413) return 'Your request is too large. Please shorten the transaction description.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status === 504) return 'The request took too long. Please try again.'
  if (status >= 500) return 'SpendGuard is unavailable right now. Please try again shortly.'
  return 'We could not read the response. Please try again.'
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(100_000),
    })
  } catch (error) {
    if (isTimeout(error)) {
      throw new ApiError('SpendGuard took too long to respond. Please try again.', 'REQUEST_TIMEOUT')
    }
    throw new ApiError('Could not connect to SpendGuard. Check your connection and try again.', 'NETWORK_ERROR')
  }

  let result: unknown
  try {
    result = await response.json()
  } catch (error) {
    if (isTimeout(error)) {
      throw new ApiError('SpendGuard took too long to respond. Please try again.', 'REQUEST_TIMEOUT')
    }
    throw new ApiError(fallbackMessage(response.status), 'INVALID_RESPONSE', response.status)
  }

  if (typeof result !== 'object' || result === null || !('success' in result)) {
    throw new ApiError(fallbackMessage(response.status), 'INVALID_RESPONSE', response.status)
  }
  if (!response.ok || result.success !== true) {
    const message = 'message' in result && typeof result.message === 'string' && result.message.trim()
      ? result.message.trim() : fallbackMessage(response.status)
    const code = 'code' in result && typeof result.code === 'string' ? result.code : 'REQUEST_FAILED'
    throw new ApiError(message, code, response.status)
  }
  return result as T
}
