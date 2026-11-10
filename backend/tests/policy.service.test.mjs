import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'

process.env.NEAR_AI_API_KEY = 'test-key'
process.env.NEAR_AI_MODEL = 'test-model'
process.env.NEAR_AI_BASE_URL = 'https://ai.test.invalid/v1'
process.env.NODE_ENV = 'test'

let aiResult
let savedAnalysis

mock.method(globalThis, 'fetch', async (url) => {
  assert.equal(String(url), 'https://ai.test.invalid/v1/chat/completions')
  return new Response(JSON.stringify({
    choices: [{
      message: { content: JSON.stringify(aiResult) },
      finish_reason: 'stop',
    }],
  }), { headers: { 'content-type': 'application/json' } })
})

const { analyzeTransaction } = await import('../src/services/policy.service.ts')
const { TransactionModel } = await import('../src/models/transaction.model.ts')

mock.method(TransactionModel, 'create', async (analysis) => {
  savedAnalysis = analysis
  return { _id: { toString: () => 'test-analysis-id' } }
})
after(() => mock.restoreAll())

const baseAnalysis = {
  details: {
    amount: '100', asset: 'USDC', sourceNetwork: 'Ethereum',
    destinationNetwork: 'Aurora', recipient: 'alice.near',
  },
  score: 10,
  status: 'ALLOW',
  message: 'No significant risk signals.',
  reasons: [],
  recommendation: 'Proceed with normal monitoring.',
}

async function analyze(overrides = {}) {
  aiResult = { ...baseAnalysis, ...overrides }
  const result = await analyzeTransaction('Transfer USDC from Ethereum to Aurora to alice.near')
  assert.equal(savedAnalysis.message, result.message)
  assert.equal(savedAnalysis.status, result.status)
  return result
}

test('missing recipient produces a warning with the policy reason and review advice', async () => {
  const result = await analyze({ details: { ...baseAnalysis.details, recipient: null } })
  assert.equal(result.status, 'WARN')
  assert.equal(result.score, 21)
  assert.match(result.message, /required transaction details are missing/)
  assert.match(result.message, /requires review/)
  assert.doesNotMatch(result.message, /No significant risk signals|Proceed with normal monitoring/)
})

test('high-value policy warning explains the threshold', async () => {
  const result = await analyze({ details: { ...baseAnalysis.details, amount: '1001' } })
  assert.equal(result.status, 'WARN')
  assert.match(result.message, /exceeds the demo threshold of 1000/)
  assert.doesNotMatch(result.message, /Proceed with normal monitoring/)
})

test('invalid amount produces review advice with the policy reason', async () => {
  const result = await analyze({ details: { ...baseAnalysis.details, amount: '-1' } })
  assert.equal(result.status, 'WARN')
  assert.match(result.message, /amount is invalid or unclear/)
  assert.doesNotMatch(result.message, /Proceed with normal monitoring/)
})

test('warning score overrides ALLOW advice', async () => {
  const result = await analyze({ score: 21, reasons: ['The recipient needs verification.'] })
  assert.equal(result.status, 'WARN')
  assert.match(result.message, /recipient needs verification/)
  assert.match(result.message, /requires review/)
  assert.doesNotMatch(result.message, /Proceed with normal monitoring/)
})

test('blocking score overrides ALLOW advice', async () => {
  const result = await analyze({ score: 80, reasons: ['Clear social engineering indicators.'] })
  assert.equal(result.status, 'BLOCK')
  assert.match(result.message, /Clear social engineering indicators/)
  assert.match(result.message, /Do not proceed with this transaction/)
  assert.doesNotMatch(result.message, /No significant risk signals|Proceed with normal monitoring/)
})

test('explicit BLOCK with a low score still gives blocking advice', async () => {
  const result = await analyze({ status: 'BLOCK' })
  assert.equal(result.status, 'BLOCK')
  assert.equal(result.score, 80)
  assert.match(result.message, /Do not proceed with this transaction/)
  assert.doesNotMatch(result.message, /Proceed with normal monitoring/)
})

test('explicit WARN cannot retain permissive AI advice', async () => {
  const result = await analyze({ status: 'WARN', score: 35 })
  assert.equal(result.status, 'WARN')
  assert.match(result.message, /requires review/)
  assert.doesNotMatch(result.message, /Proceed with normal monitoring/)
})

test('ALLOW retains the AI explanation and recommendation', async () => {
  const result = await analyze()
  assert.equal(result.status, 'ALLOW')
  assert.equal(result.score, 10)
  assert.equal(result.message, `${baseAnalysis.message} ${baseAnalysis.recommendation}`)
})
