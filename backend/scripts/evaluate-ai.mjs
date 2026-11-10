import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cases = JSON.parse(await readFile(new URL('../evals/transaction-cases.json', import.meta.url), 'utf-8'))
const ids = new Set()
const detailFields = ['amount', 'asset', 'sourceNetwork', 'destinationNetwork', 'recipient']
for (const scenario of cases) {
  assert.ok(scenario.id && !ids.has(scenario.id), 'Evaluation IDs must be unique')
  ids.add(scenario.id)
  assert.ok(typeof scenario.request === 'string' && scenario.request.length > 0 && scenario.request.length <= 1000)
  const expected = scenario.expected
  assert.ok(['ALLOW', 'WARN', 'BLOCK'].includes(expected.status))
  assert.ok(Number.isInteger(expected.minScore) && Number.isInteger(expected.maxScore))
  assert.ok(expected.minScore >= 1 && expected.minScore <= expected.maxScore && expected.maxScore <= 100)
  const statusFor = (score) => score >= 80 ? 'BLOCK' : score >= 21 ? 'WARN' : 'ALLOW'
  assert.equal(statusFor(expected.minScore), expected.status)
  assert.equal(statusFor(expected.maxScore), expected.status)
  for (const [field, value] of Object.entries(expected.details ?? {})) {
    assert.ok(detailFields.includes(field))
    assert.ok(value === null || typeof value === 'string')
  }
  if (expected.reasonPattern) new RegExp(expected.reasonPattern, 'i')
}

if (!process.argv.includes('--live')) {
  console.log(`Validated ${cases.length} evaluation cases. No AI requests were sent.`)
  console.log('Live evaluation requires --live and defaults to one case. No live requests are made by this command.')
  process.exit(0)
}

const { analyzeRisk } = await import('../src/services/ai.service.ts')
const requestedIds = process.argv.filter((argument) => argument.startsWith('--case=')).map((argument) => argument.slice(7))
const candidateCases = requestedIds.length ? requestedIds.map((id) => {
  const scenario = cases.find((candidate) => candidate.id === id)
  assert.ok(scenario, `Unknown evaluation case: ${id}`)
  return scenario
}) : cases
const maxCasesArgument = process.argv.find((argument) => argument.startsWith('--max-cases='))
const maxCases = maxCasesArgument ? Number(maxCasesArgument.slice(12)) : 1
assert.ok(Number.isInteger(maxCases) && maxCases >= 1 && maxCases <= cases.length, `--max-cases must be between 1 and ${cases.length}`)
const selectedCases = candidateCases.slice(0, maxCases)
console.log(`Live evaluation limited to ${selectedCases.length} case(s).`)
let passed = 0
let evaluated = 0
for (const scenario of selectedCases) {
  evaluated++
  const failures = []
  try {
    const result = await analyzeRisk(scenario.request)
    const expected = scenario.expected
    if (result.status !== expected.status) failures.push(`status ${result.status}, expected ${expected.status}`)
    if (result.score < expected.minScore || result.score > expected.maxScore) {
      failures.push(`score ${result.score}, expected ${expected.minScore}-${expected.maxScore}`)
    }
    for (const [field, value] of Object.entries(expected.details ?? {})) {
      const actual = result.details[field]
      const equal = ['asset', 'sourceNetwork', 'destinationNetwork'].includes(field) && typeof value === 'string'
        ? typeof actual === 'string' && actual.toLowerCase() === value.toLowerCase()
        : actual === value
      if (!equal) failures.push(`${field}: ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`)
    }
    if (result.reasons.length > 3) failures.push('more than three reasons')
    if (result.status !== 'ALLOW' && result.reasons.length === 0) failures.push('missing risk reasons')
    if (expected.reasonPattern && !new RegExp(expected.reasonPattern, 'i').test(result.reasons.join(' '))) {
      failures.push('reasons do not explain the expected risk mechanism')
    }
    if (failures.length) console.log(`FAIL ${scenario.id}: ${failures.join('; ')}`)
    else {
      passed++
      console.log(`PASS ${scenario.id}: ${result.status} ${result.score}`)
    }
    if (failures.length || process.argv.includes('--verbose')) console.log(JSON.stringify(result))
  } catch (error) {
    const status = typeof error?.status === 'number' ? ` (provider status ${error.status})` : ''
    const kind = error instanceof Error ? error.constructor.name : 'UnknownError'
    console.log(`ERROR ${scenario.id}: analysis request failed${status} [${kind}]`)
    if (!['AI_RESPONSE_INVALID', 'AI_REQUEST_DECLINED'].includes(error?.code)) {
      console.log('Stopping evaluation because the analysis service could not complete the request.')
      break
    }
  }
}
console.log(`${passed}/${evaluated} evaluated cases passed (${selectedCases.length} selected).`)
process.exitCode = passed === selectedCases.length ? 0 : 1
