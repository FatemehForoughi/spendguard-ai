import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, mock, test } from 'node:test'
import OpenAI from 'openai'

process.env.NODE_ENV = 'test'
const { AppError } = await import('../src/errors/app-error.ts')
const { errorHandler } = await import('../src/middleware/error-handler.ts')
const { default: app } = await import('../src/app.ts')
mock.method(console, 'error', () => {})

let server
let baseUrl
before(async () => {
  server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  mock.restoreAll()
})

function handle(error) {
  const response = {
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
  errorHandler(error, {}, response, () => {})
  return response
}

for (const [status, expectedStatus, expectedCode] of [
  [429, 429, 'AI_RATE_LIMITED'],
  [401, 503, 'AI_UNAVAILABLE'],
  [403, 503, 'AI_UNAVAILABLE'],
  [400, 503, 'AI_UNAVAILABLE'],
  [500, 503, 'AI_UNAVAILABLE'],
]) {
  test(`provider status ${status} produces a safe user error`, () => {
    const error = OpenAI.APIError.generate(status, { error: { message: 'internal provider details' } }, '', new Headers())
    const response = handle(error)
    assert.equal(response.code, expectedStatus)
    assert.equal(response.body.code, expectedCode)
    assert.equal(response.body.success, false)
    assert.doesNotMatch(JSON.stringify(response.body), /internal provider details/)
  })
}

for (const error of [new OpenAI.APIConnectionTimeoutError(), new OpenAI.APIUserAbortError(), new DOMException('expired', 'TimeoutError')]) {
  test(`${error.name} timeout produces actionable feedback`, () => {
    const response = handle(error)
    assert.equal(response.code, 504)
    assert.equal(response.body.code, 'AI_TIMEOUT')
    assert.match(response.body.message, /too long.*try again/i)
  })
}

test('a connection failure is reported as a temporary service failure', () => {
  const response = handle(new OpenAI.APIConnectionError({ message: 'internal DNS details' }))
  assert.equal(response.code, 503)
  assert.equal(response.body.code, 'AI_UNAVAILABLE')
  assert.doesNotMatch(response.body.message, /DNS/)
})

test('an unexpected error does not expose its message or stack', () => {
  const response = handle(new Error('internal stack and configuration details'))
  assert.equal(response.code, 500)
  assert.equal(response.body.code, 'INTERNAL_ERROR')
  assert.doesNotMatch(JSON.stringify(response.body), /internal stack|configuration/)
})

test('an application error retains its safe status, code, and message', () => {
  const response = handle(new AppError(422, 'AI_REQUEST_DECLINED', 'Try describing only the transaction.'))
  assert.equal(response.code, 422)
  assert.equal(response.body.code, 'AI_REQUEST_DECLINED')
  assert.equal(response.body.message, 'Try describing only the transaction.')
})

test('malformed JSON receives a JSON error response', async () => {
  const response = await fetch(`${baseUrl}/api/transactions/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid',
  })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.code, 'INVALID_REQUEST')
  assert.doesNotMatch(body.message, /SyntaxError|Unexpected token/)
})

test('an oversized request receives a helpful JSON response', async () => {
  const response = await fetch(`${baseUrl}/api/transactions/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: 'a'.repeat(11_000) }),
  })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).code, 'REQUEST_TOO_LARGE')
})

test('empty transaction input receives a specific validation message', async () => {
  const response = await fetch(`${baseUrl}/api/transactions/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: ' ' }),
  })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.code, 'INVALID_TRANSACTION_REQUEST')
  assert.match(body.message, /describe the transaction/)
})

test('an unknown API route responds with JSON instead of an HTML error page', async () => {
  const response = await fetch(`${baseUrl}/api/missing`)
  assert.equal(response.status, 404)
  assert.equal((await response.json()).code, 'NOT_FOUND')
})
