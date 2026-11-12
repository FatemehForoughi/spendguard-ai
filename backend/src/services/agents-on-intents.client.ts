import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'

export interface AgentsOnIntentsClientOptions {
  partnerApiKey?: string
  baseUrl?: string
  timeoutMs?: number
}

export interface AgentsOnIntentsRequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
  idempotencyKey?: string
  grantToken?: string
}

function failureForStatus(status: number): [number, string, string] {
  if (status === 401 || status === 403) {
    return [503, 'INTENTS_AUTH_FAILED', 'The Agents on Intents service could not authorize this request.']
  }
  if (status === 429) {
    return [429, 'INTENTS_RATE_LIMITED', 'The Agents on Intents service is busy. Please wait a moment and try again.']
  }
  if (status === 408 || status === 504) {
    return [504, 'INTENTS_TIMEOUT', 'The Agents on Intents request took too long.']
  }
  if (status >= 500) {
    return [503, 'INTENTS_UNAVAILABLE', 'The Agents on Intents service is unavailable right now.']
  }
  if (status >= 400) {
    return [status, 'INTENTS_REQUEST_FAILED', 'The Agents on Intents request could not be completed.']
  }
  return [502, 'INTENTS_RESPONSE_INVALID', 'The Agents on Intents service returned an invalid response.']
}

export class AgentsOnIntentsApiError extends AppError {
  constructor(
    public readonly upstreamStatus: number,
    public readonly providerCodes: readonly string[] = [],
  ) {
    super(...failureForStatus(upstreamStatus))
    this.name = 'AgentsOnIntentsApiError'
  }
}

function invalidRequest(): AppError {
  return new AppError(400, 'INTENTS_REQUEST_INVALID', 'The Agents on Intents request is invalid.')
}

function providerCodes(body: unknown, secrets: string[]): string[] {
  if (typeof body !== 'object' || body === null || !('errors' in body) || !Array.isArray(body.errors)) return []
  return [...new Set(body.errors.flatMap((error: unknown) => {
    if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return []
    const code = error.code
    // Retain documented machine codes, never titles, details, or echoed credentials.
    return /^[a-z][a-z0-9_]{0,127}$/.test(code) && !secrets.some((secret) => code.includes(secret)) ? [code] : []
  }))]
}

export class AgentsOnIntentsClient {
  #partnerApiKey: string | undefined
  #baseUrl: URL
  #timeoutMs: number

  constructor(options: AgentsOnIntentsClientOptions = {}) {
    this.#partnerApiKey = options.partnerApiKey?.trim() || undefined
    this.#timeoutMs = options.timeoutMs ?? env.AGENTS_ON_INTENTS_TIMEOUT_MS
    try {
      this.#baseUrl = new URL(options.baseUrl ?? env.AGENTS_ON_INTENTS_BASE_URL)
      if (
        this.#baseUrl.protocol !== 'https:' || this.#baseUrl.username || this.#baseUrl.password ||
        this.#baseUrl.pathname !== '/' || this.#baseUrl.search || this.#baseUrl.hash ||
        (this.#partnerApiKey && !/^[\x21-\x7e]+$/.test(this.#partnerApiKey)) ||
        !Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 120_000
      ) throw new Error('Invalid client configuration')
    } catch {
      throw new AppError(503, 'INTENTS_CONFIGURATION_INVALID', 'The Agents on Intents service configuration is invalid.')
    }
  }

  get<T = unknown>(path: string, options: AgentsOnIntentsRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  post<T = unknown>(path: string, body: unknown, options: AgentsOnIntentsRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: AgentsOnIntentsRequestOptions,
  ): Promise<T> {
    if (!this.#partnerApiKey) {
      throw new AppError(503, 'INTENTS_NOT_CONFIGURED', 'The Agents on Intents service is not configured.')
    }
    // A caller cannot change the origin or inject query strings through the path.
    if (!/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path)) throw invalidRequest()
    const url = new URL(path, this.#baseUrl)
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value))
    }

    const headers = new Headers({ Accept: 'application/json', 'X-API-Key': this.#partnerApiKey })
    if (options.idempotencyKey !== undefined) {
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(options.idempotencyKey)) throw invalidRequest()
      headers.set('Idempotency-Key', options.idempotencyKey)
    }
    const grantToken = options.grantToken?.trim()
    if (options.grantToken !== undefined) {
      if (!grantToken || !/^[\x21-\x7e]+$/.test(grantToken)) throw invalidRequest()
      headers.set('X-Grant-Token', grantToken)
    }
    let payload: string | undefined
    if (method === 'POST') {
      headers.set('Content-Type', 'application/json')
      try {
        payload = JSON.stringify(body)
      } catch {
        throw invalidRequest()
      }
      if (payload === undefined) throw invalidRequest()
    }

    const deadline = AbortSignal.timeout(this.#timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
    try {
      signal.throwIfAborted()
      // Never follow redirects with credentials or automatically replay a mutation.
      const response = await fetch(url, { method, headers, body: payload, signal, redirect: 'error', credentials: 'omit' })
      let result: unknown
      try {
        result = await response.json()
      } catch (error) {
        if (signal.aborted) throw error
        if (!response.ok) throw new AgentsOnIntentsApiError(response.status)
        throw new AppError(502, 'INTENTS_RESPONSE_INVALID', 'The Agents on Intents service returned an invalid response.')
      }
      if (!response.ok) {
        throw new AgentsOnIntentsApiError(response.status, providerCodes(result, [this.#partnerApiKey, ...(grantToken ? [grantToken] : [])]))
      }
      if (result === null || typeof result !== 'object') {
        throw new AppError(502, 'INTENTS_RESPONSE_INVALID', 'The Agents on Intents service returned an invalid response.')
      }
      return result as T
    } catch (error) {
      if (deadline.aborted) {
        throw new AppError(504, 'INTENTS_TIMEOUT', 'The Agents on Intents request took too long.')
      }
      if (options.signal?.aborted) {
        throw new AppError(499, 'INTENTS_REQUEST_ABORTED', 'The Agents on Intents request was cancelled.')
      }
      if (error instanceof AppError) throw error
      // Transport errors can contain request headers or URLs; do not retain their cause.
      throw new AppError(503, 'INTENTS_UNAVAILABLE', 'The Agents on Intents service is unavailable right now.')
    }
  }
}

export const agentsOnIntentsClient = new AgentsOnIntentsClient({
  partnerApiKey: env.AGENTS_ON_INTENTS_PARTNER_API_KEY,
})
