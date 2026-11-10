import assert from 'node:assert/strict'
import { after, beforeEach, mock, test } from 'node:test'

process.env.NEAR_AI_API_KEY = 'test-key'
process.env.NEAR_AI_MODEL = 'test-model'
process.env.NEAR_AI_BASE_URL = 'https://ai.test.invalid/v1'
process.env.NODE_ENV = 'test'

let responses
let requests

mock.method(globalThis, 'fetch', async (url, options) => {
  assert.equal(String(url), 'https://ai.test.invalid/v1/chat/completions')
  requests.push(JSON.parse(options.body))
  const response = responses.shift()
  assert.ok(response, 'No unexpected AI requests are permitted')
  response.onFetch?.()
  return new Response(JSON.stringify(response.body), {
    status: response.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
})

const { analyzeRisk } = await import('../src/services/ai.service.ts')
const { analyzeTransactionController } = await import('../src/controllers/transaction.controller.ts')
const { TransactionModel } = await import('../src/models/transaction.model.ts')
const saveMock = mock.method(TransactionModel, 'create', async () => {
  return { _id: { toString: () => 'test-analysis-id' } }
})

beforeEach(() => {
  responses = []
  requests = []
})
after(() => mock.restoreAll())

const request = 'Transfer 100 USDC from Ethereum to Aurora to alice.near'
const validAnalysis = {
  details: {
    amount: '100', asset: 'USDC', sourceNetwork: 'Ethereum',
    destinationNetwork: 'Aurora', recipient: 'alice.near',
  },
  score: 10, status: 'ALLOW', message: 'No significant risk signals.',
  reasons: [], recommendation: 'Review the recipient before proceeding.',
}

function completion(content = validAnalysis, finishReason = 'stop', message = {}) {
  return {
    body: {
      choices: [{
        message: {
          content: typeof content === 'string' || content === null ? content : JSON.stringify(content),
          ...message,
        },
        finish_reason: finishReason,
      }],
    },
  }
}

test('a complete valid analysis succeeds with one AI call', async () => {
  responses.push(completion())
  assert.deepEqual(await analyzeRisk(request), validAnalysis)
  assert.equal(requests.length, 1)
  assert.ok(requests[0].max_tokens > 300)
})

test('truncated output is regenerated once with more tokens and the original request', async () => {
  responses.push(completion('{"details":', 'length'), completion())
  assert.deepEqual(await analyzeRisk(request), validAnalysis)
  assert.equal(requests.length, 2)
  assert.ok(requests[1].max_tokens > requests[0].max_tokens)
  assert.equal(requests[0].messages[1].content, request)
  assert.equal(requests[1].messages[1].content, request)
  assert.match(requests[1].messages[0].content, /previous response was incomplete or invalid/)
})

test('valid-looking JSON marked as truncated cannot produce an ALLOW result', async () => {
  const blockedAnalysis = { ...validAnalysis, score: 90, status: 'BLOCK', reasons: ['Phishing indicators.'] }
  responses.push(completion(validAnalysis, 'length'), completion(blockedAnalysis))
  assert.deepEqual(await analyzeRisk(request), blockedAnalysis)
  assert.equal(requests.length, 2)
})

const invalidCompletions = [
  ['malformed JSON', completion('{bad json}')],
  ['missing required fields', completion({ details: validAnalysis.details })],
  ['an out-of-range score', completion({ ...validAnalysis, score: 101 })],
  ['an invalid status', completion({ ...validAnalysis, status: 'SAFE' })],
  ['a blank message', completion({ ...validAnalysis, message: '   ' })],
  ['a blank recommendation', completion({ ...validAnalysis, recommendation: '' })],
  ['an empty reason', completion({ ...validAnalysis, reasons: [' '] })],
  ['empty content', completion('')],
  ['null content', completion(null)],
  ['missing choices', { body: { choices: [] } }],
  ['a missing choices field', { body: {} }],
  ['a missing message', { body: { choices: [{ finish_reason: 'stop' }] } }],
  ['a missing completion reason', { body: { choices: [{ message: { content: JSON.stringify(validAnalysis) } }] } }],
  ['non-string content', { body: { choices: [{ finish_reason: 'stop', message: { content: validAnalysis } }] } }],
  ['a null response body', { body: null }],
]

for (const [description, invalidCompletion] of invalidCompletions) {
  test(`${description} gets one recovery attempt`, async () => {
    responses.push(invalidCompletion, completion())
    assert.deepEqual(await analyzeRisk(request), validAnalysis)
    assert.equal(requests.length, 2)
  })
}

test('a refused response stops without a recovery attempt', async () => {
  responses.push(completion(validAnalysis, 'stop', { refusal: 'Provider refusal.' }))
  await assert.rejects(analyzeRisk(request), /declined to analyze/)
  assert.equal(requests.length, 1)
})

test('a filtered response stops without a recovery attempt', async () => {
  responses.push(completion(null, 'content_filter'))
  await assert.rejects(analyzeRisk(request), /declined to analyze/)
  assert.equal(requests.length, 1)
})

test('an unexpected completion type is rejected', async () => {
  responses.push(completion(validAnalysis, 'tool_calls'))
  await assert.rejects(analyzeRisk(request), /unexpected completion type/)
  assert.equal(requests.length, 1)
})

test('a provider request error is not retried as malformed model output', async () => {
  responses.push({ status: 400, body: { error: { message: 'Unsupported request', type: 'invalid_request_error' } } })
  await assert.rejects(analyzeRisk(request), (error) => error.status === 400)
  assert.equal(requests.length, 1)
})

test('repeated invalid responses stop after two attempts without saving an analysis', async (t) => {
  responses.push(completion('{"details":', 'length'), completion({ score: 10 }))
  t.mock.method(console, 'error', () => {})
  const savesBefore = saveMock.mock.callCount()
  const response = {
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
  await analyzeTransactionController({ body: { request } }, response)
  assert.equal(requests.length, 2)
  assert.equal(saveMock.mock.callCount(), savesBefore)
  assert.equal(response.code, 502)
  assert.equal(response.body.success, false)
  assert.equal(response.body.data, undefined)
})

test('the analysis deadline prevents another attempt', async (t) => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const truncated = completion('{"details":', 'length')
  truncated.onFetch = () => controller.abort(new Error('Analysis deadline exceeded'))
  responses.push(truncated)
  await assert.rejects(analyzeRisk(request), /abort|deadline/i)
  assert.equal(requests.length, 1)
})
