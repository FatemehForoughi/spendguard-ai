import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, beforeEach, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

const partnerKey = 'test_partner_secret_key'
const grantToken = 'test_grant_secret_token'
process.env.NODE_ENV = 'test'
process.env.AGENTS_ON_INTENTS_PARTNER_API_KEY = `  ${partnerKey}  `
process.env.AGENTS_ON_INTENTS_BASE_URL = 'https://intents.test.invalid'
process.env.AGENTS_ON_INTENTS_TIMEOUT_MS = '35000'

let requests
let respond
mock.method(globalThis, 'fetch', async (url, options) => {
  requests.push({ url: new URL(url), ...options })
  return respond(url, options)
})

const { AgentsOnIntentsClient, AgentsOnIntentsApiError, agentsOnIntentsClient } = await import('../src/services/agents-on-intents.client.ts')
const { errorHandler } = await import('../src/middleware/error-handler.ts')
const { AppError } = await import('../src/errors/app-error.ts')
const status = { correlation_id: `op_${'a'.repeat(43)}`, status: 'UNCERTAIN' }

function json(body, responseStatus = 200) {
  return new Response(JSON.stringify(body), { status: responseStatus, headers: { 'content-type': 'application/json' } })
}

function client(overrides = {}) {
  return new AgentsOnIntentsClient({ partnerApiKey: partnerKey, ...overrides })
}

beforeEach(() => {
  requests = []
  respond = () => json(status)
})
after(() => mock.restoreAll())

test('the configured client sends the normalized partner key only in X-API-Key', async () => {
  assert.deepEqual(await agentsOnIntentsClient.get('/v1/status'), status)
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.equal(request.url.href, 'https://intents.test.invalid/v1/status')
  assert.equal(request.method, 'GET')
  assert.equal(request.headers.get('X-API-Key'), partnerKey)
  assert.equal(request.headers.get('Accept'), 'application/json')
  assert.equal(request.headers.has('Authorization'), false)
  assert.equal(request.headers.has('Content-Type'), false)
  assert.equal(request.body, undefined)
  assert.equal(request.redirect, 'error')
  assert.equal(request.credentials, 'omit')
  assert.doesNotMatch(request.url.href, new RegExp(partnerKey))
  assert.doesNotMatch(inspect(agentsOnIntentsClient), new RegExp(partnerKey))
  assert.doesNotMatch(JSON.stringify(agentsOnIntentsClient), new RegExp(partnerKey))
})

test('GET query parameters preserve strings, zero, and false and omit undefined values', async () => {
  await client({ baseUrl: 'https://api.agentsonintents.com/' }).get('/v1/status', {
    query: { correlation_id: status.correlation_id, wait_ms: 0, refresh: false, cursor: 'a + b&c=?', omitted: undefined },
  })
  assert.equal(requests[0].url.origin, 'https://api.agentsonintents.com')
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), {
    correlation_id: status.correlation_id, wait_ms: '0', refresh: 'false', cursor: 'a + b&c=?',
  })
})

test('POST sends JSON and caller-owned idempotency and grant tokens as headers', async () => {
  const body = { type: 'agent_freeze', agent_id: 'a'.repeat(64) }
  const options = { idempotencyKey: 'logical-operation-123', grantToken }
  const api = client()
  await api.post('/v1/generate-intent', body, options)
  await api.post('/v1/generate-intent', body, options)
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('Content-Type'), 'application/json')
    assert.equal(request.headers.get('X-API-Key'), partnerKey)
    assert.equal(request.headers.get('Idempotency-Key'), options.idempotencyKey)
    assert.equal(request.headers.get('X-Grant-Token'), grantToken)
    assert.deepEqual(JSON.parse(request.body), body)
    assert.doesNotMatch(request.body + request.url.href, new RegExp(`${partnerKey}|${grantToken}`))
  }
})

test('a missing or blank partner key fails before making any request', async () => {
  for (const partnerApiKey of [undefined, '', '   ']) {
    await assert.rejects(client({ partnerApiKey }).get('/v1/status'), { statusCode: 503, code: 'INTENTS_NOT_CONFIGURED' })
  }
  assert.equal(requests.length, 0)
})

test('absolute URLs, traversal, encoded paths, and path-injected query strings are refused', async () => {
  for (const path of [
    'https://other.test/v1/status', '//other.test/v1/status', '/v1/../status', '/v1/%2e%2e/status',
    '/v1/status?correlation_id=x', '/v1/status#fragment', '/v1/\\other.test/status',
  ]) {
    await assert.rejects(client().get(path), { code: 'INTENTS_REQUEST_INVALID' })
  }
  assert.equal(requests.length, 0)
})

test('unsafe base URLs and multiline keys fail without retaining credentials', () => {
  for (const options of [
    { baseUrl: 'http://other.test' }, { baseUrl: `https://user:${partnerKey}@other.test` },
    { baseUrl: 'https://other.test/v1' }, { baseUrl: `https://other.test?key=${partnerKey}` },
    { baseUrl: 'https://other.test#fragment' }, { baseUrl: 'not-a-url' },
    { partnerApiKey: `${partnerKey}\r\nInjected: value` }, { timeoutMs: 0 }, { timeoutMs: 120_001 },
  ]) {
    assert.throws(() => client(options), (error) => {
      assert.equal(error.code, 'INTENTS_CONFIGURATION_INVALID')
      assert.doesNotMatch(inspect(error), new RegExp(partnerKey))
      return true
    })
  }
  assert.equal(requests.length, 0)
})

test('invalid optional headers and unserializable POST bodies never reach the provider', async () => {
  for (const options of [
    { idempotencyKey: 'short' }, { idempotencyKey: 'operation\r\nInjected: value' },
    { grantToken: '' }, { grantToken: `${grantToken}\r\nInjected: value` },
  ]) {
    await assert.rejects(client().post('/v1/generate-intent', {}, options), { code: 'INTENTS_REQUEST_INVALID' })
  }
  const circular = {}
  circular.self = circular
  for (const body of [undefined, { amount: 1n }, circular]) {
    await assert.rejects(client().post('/v1/generate-intent', body), { code: 'INTENTS_REQUEST_INVALID' })
  }
  assert.equal(requests.length, 0)
})

for (const [upstreamStatus, expectedStatus, expectedCode] of [
  [401, 503, 'INTENTS_AUTH_FAILED'], [403, 503, 'INTENTS_AUTH_FAILED'], [429, 429, 'INTENTS_RATE_LIMITED'],
  [400, 400, 'INTENTS_REQUEST_FAILED'], [404, 404, 'INTENTS_REQUEST_FAILED'], [409, 409, 'INTENTS_REQUEST_FAILED'],
  [408, 504, 'INTENTS_TIMEOUT'], [504, 504, 'INTENTS_TIMEOUT'], [502, 503, 'INTENTS_UNAVAILABLE'],
]) {
  test(`upstream ${upstreamStatus} retains machine codes and produces a safe error without retrying`, async () => {
    respond = () => json({ errors: [
      { code: 'policy_revision_conflict', title: partnerKey, detail: grantToken },
      { code: 'policy_revision_conflict' }, { code: partnerKey }, { code: grantToken },
      { code: `secret: ${partnerKey}` }, { code: 123 }, null,
    ] }, upstreamStatus)
    await assert.rejects(client().post('/v1/generate-intent', {}, { grantToken }), (error) => {
      assert.ok(error instanceof AgentsOnIntentsApiError)
      assert.equal(error.upstreamStatus, upstreamStatus)
      assert.equal(error.statusCode, expectedStatus)
      assert.equal(error.code, expectedCode)
      assert.deepEqual(error.providerCodes, ['policy_revision_conflict'])
      assert.doesNotMatch(inspect(error), new RegExp(`${partnerKey}|${grantToken}`))
      assert.equal(error.cause, undefined)
      return true
    })
    assert.equal(requests.length, 1)
  })
}

test('the existing error handler returns and logs no credentials or provider details', async (t) => {
  respond = () => json({ errors: [{ code: 'api_key_invalid', title: partnerKey, detail: 'internal provider details' }] }, 401)
  const logger = t.mock.method(console, 'error', () => {})
  let failure
  try { await client().get('/v1/status') } catch (error) { failure = error }
  const response = {
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
  errorHandler(failure, {}, response, () => {})
  assert.equal(response.code, 503)
  assert.deepEqual(response.body, {
    success: false, code: 'INTENTS_AUTH_FAILED', message: failure.message,
  })
  assert.doesNotMatch(JSON.stringify(response.body) + inspect(logger.mock.calls), new RegExp(`${partnerKey}|internal provider details`))
})

test('malformed, null, and primitive success responses are rejected', async () => {
  for (const content of ['{invalid JSON', 'null', '42', '"unexpected string"']) {
    respond = () => new Response(content)
    await assert.rejects(client().get('/v1/status'), { statusCode: 502, code: 'INTENTS_RESPONSE_INVALID' })
  }
})

test('a non-JSON provider error still retains its upstream HTTP status', async () => {
  respond = () => new Response(`<html>${partnerKey}</html>`, { status: 429 })
  await assert.rejects(client().get('/v1/status'), (error) => {
    assert.equal(error.upstreamStatus, 429)
    assert.equal(error.code, 'INTENTS_RATE_LIMITED')
    assert.deepEqual(error.providerCodes, [])
    assert.doesNotMatch(inspect(error), new RegExp(partnerKey))
    return true
  })
})

test('transport failure discards sensitive causes and never replays a POST', async () => {
  respond = () => { throw new Error(`Request headers: X-API-Key=${partnerKey}`) }
  await assert.rejects(client().post('/v1/generate-intent', {}, { idempotencyKey: 'original-operation-123' }), (error) => {
    assert.equal(error.code, 'INTENTS_UNAVAILABLE')
    assert.equal(error.cause, undefined)
    assert.doesNotMatch(inspect(error), new RegExp(partnerKey))
    return true
  })
  assert.equal(requests.length, 1)
})

for (const phase of ['fetch', 'body']) {
  test(`the configured deadline covers ${phase} and reports an intents timeout`, async (t) => {
    const deadline = new AbortController()
    t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
      assert.equal(milliseconds, 35_000)
      return deadline.signal
    })
    const expire = () => {
      deadline.abort(new DOMException(partnerKey, 'TimeoutError'))
      throw deadline.signal.reason
    }
    respond = () => {
      if (phase === 'fetch') return expire()
      const response = json(status)
      t.mock.method(response, 'json', expire)
      return response
    }
    await assert.rejects(client().get('/v1/status'), (error) => {
      assert.equal(error.statusCode, 504)
      assert.equal(error.code, 'INTENTS_TIMEOUT')
      assert.doesNotMatch(inspect(error), new RegExp(partnerKey))
      return true
    })
    assert.equal(requests.length, 1)
  })
}

test('caller cancellation is distinguished from an upstream timeout', async () => {
  const controller = new AbortController()
  respond = (_url, options) => {
    controller.abort(new Error(partnerKey))
    options.signal.throwIfAborted()
  }
  await assert.rejects(client().get('/v1/status', { signal: controller.signal }), { statusCode: 499, code: 'INTENTS_REQUEST_ABORTED' })
  assert.equal(requests.length, 1)
  requests = []
  await assert.rejects(client().get('/v1/status', { signal: controller.signal }), { code: 'INTENTS_REQUEST_ABORTED' })
  assert.equal(requests.length, 0)
})

test('cancellation also discards an application error used as the abort reason', async () => {
  const controller = new AbortController()
  controller.abort(new AppError(500, 'SENSITIVE_REASON', partnerKey))
  await assert.rejects(client().get('/v1/status', { signal: controller.signal }), (error) => {
    assert.equal(error.code, 'INTENTS_REQUEST_ABORTED')
    assert.doesNotMatch(inspect(error), new RegExp(`${partnerKey}|SENSITIVE_REASON`))
    return true
  })
  assert.equal(requests.length, 0)
})

function readEnvironment(overrides = {}) {
  const environment = { ...process.env, NODE_ENV: 'test' }
  for (const name of ['AGENTS_ON_INTENTS_PARTNER_API_KEY', 'AGENTS_ON_INTENTS_BASE_URL', 'AGENTS_ON_INTENTS_TIMEOUT_MS']) delete environment[name]
  Object.assign(environment, overrides)
  const envModule = new URL('../src/config/env.ts', import.meta.url).href
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    const { env } = await import(${JSON.stringify(envModule)});
    console.log(JSON.stringify({
      baseUrl: env.AGENTS_ON_INTENTS_BASE_URL,
      timeoutMs: env.AGENTS_ON_INTENTS_TIMEOUT_MS,
      hasKey: Boolean(env.AGENTS_ON_INTENTS_PARTNER_API_KEY),
    }));
  `], { env: environment, cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', timeout: 10_000 })
}

test('environment defaults allow starting without a partner key', () => {
  const result = readEnvironment()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), {
    baseUrl: 'https://api.agentsonintents.com', timeoutMs: 35_000, hasKey: false,
  })
})

test('environment validation rejects invalid URLs, timeouts, and key header injection without exposing values', () => {
  for (const overrides of [
    { AGENTS_ON_INTENTS_BASE_URL: 'not-a-url' },
    { AGENTS_ON_INTENTS_BASE_URL: `https://user:${partnerKey}@other.test` },
    { AGENTS_ON_INTENTS_TIMEOUT_MS: '0' },
    { AGENTS_ON_INTENTS_PARTNER_API_KEY: `${partnerKey}\nInjected: value` },
  ]) {
    const result = readEnvironment(overrides)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Invalid environment variables/)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(partnerKey))
  }
})
