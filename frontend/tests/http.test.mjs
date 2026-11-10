import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { ApiError, requestJson } from '../src/services/http.ts'

let transport
mock.method(globalThis, 'fetch', (...args) => transport(...args))
after(() => mock.restoreAll())

test('a successful response is returned and request options are preserved', async () => {
  const data = { success: true, data: { id: 'analysis-id' } }
  const controller = new AbortController()
  transport = async (url, options) => {
    assert.equal(url, '/api/transactions/analyze')
    assert.equal(options.method, 'POST')
    assert.equal(options.body, 'transaction request')
    assert.equal(options.signal, controller.signal)
    return Response.json(data)
  }
  assert.deepEqual(await requestJson('/api/transactions/analyze', {
    method: 'POST', body: 'transaction request', signal: controller.signal,
  }), data)
})

test('server messages and error codes reach the notification caller', async () => {
  transport = async () => Response.json({ success: false, code: 'AI_RATE_LIMITED', message: 'Please wait a moment and try again.' }, { status: 429 })
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.message, 'Please wait a moment and try again.')
    assert.equal(error.code, 'AI_RATE_LIMITED')
    assert.equal(error.status, 429)
    return true
  })
})

test('an HTML gateway error becomes a friendly service message', async () => {
  transport = async () => new Response('<html>internal proxy details</html>', { status: 503 })
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
    assert.equal(error.status, 503)
    assert.match(error.message, /unavailable.*try again/i)
    assert.doesNotMatch(error.message, /html|proxy|JSON/i)
    return true
  })
})

for (const data of [null, {}, { success: false, message: 123 }, { success: 'true' }]) {
  test(`an invalid response shape is handled: ${JSON.stringify(data)}`, async () => {
    transport = async () => Response.json(data)
    await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.match(error.message, /try again/i)
      return true
    })
  })
}

test('malformed JSON does not expose a parser error to the user', async () => {
  transport = async () => new Response('{invalid')
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
    assert.equal(error.code, 'INVALID_RESPONSE')
    assert.doesNotMatch(error.message, /SyntaxError|Unexpected token/)
    return true
  })
})

test('network failures show a connection message', async () => {
  transport = async () => { throw new TypeError('fetch failed: internal connection details') }
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR')
    assert.match(error.message, /Check your connection/)
    assert.doesNotMatch(error.message, /TypeError|internal/)
    return true
  })
})

test('a timeout has a specific message', async () => {
  transport = async () => { throw new DOMException('timeout', 'TimeoutError') }
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => {
    assert.equal(error.code, 'REQUEST_TIMEOUT')
    assert.match(error.message, /too long.*try again/i)
    return true
  })
})

test('a timeout while reading the body retains the timeout message', async () => {
  transport = async () => ({ status: 200, json: async () => { throw new DOMException('aborted body', 'AbortError') } })
  await assert.rejects(requestJson('/api/transactions/analyze'), (error) => error.code === 'REQUEST_TIMEOUT')
})
