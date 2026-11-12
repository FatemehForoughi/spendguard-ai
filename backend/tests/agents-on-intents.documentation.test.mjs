import assert from 'node:assert/strict'
import { after, beforeEach, mock, test } from 'node:test'

process.env.NODE_ENV = 'test'
process.env.AGENTS_ON_INTENTS_PARTNER_API_KEY = 'phase1_test_partner_key'
process.env.AGENTS_ON_INTENTS_BASE_URL = 'https://api.agentsonintents.com'
process.env.AGENTS_ON_INTENTS_TIMEOUT_MS = '35000'

let calls
let response
mock.method(globalThis, 'fetch', async (url, options) => {
  calls.push({ url: new URL(url), options })
  return response(url, options)
})

const { AgentsOnIntentsClient } = await import('../src/services/agents-on-intents.client.ts')

beforeEach(() => {
  calls = []
  response = () => new Response(JSON.stringify({ api_key_id: 'key_test', tenant_id: 'partner_test' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
after(() => mock.restoreAll())

test('the documented whoami endpoint is reachable through the generic authenticated GET client', async () => {
  const client = new AgentsOnIntentsClient()
  const result = await client.get('/v1/whoami')

  assert.deepEqual(result, { api_key_id: 'key_test', tenant_id: 'partner_test' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.href, 'https://api.agentsonintents.com/v1/whoami')
  assert.equal(calls[0].options.headers.get('X-API-Key'), 'phase1_test_partner_key')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[0].options.credentials, 'omit')
})

test('a provider grant rejection is surfaced without retrying the request or exposing provider details', async () => {
  response = () => new Response(JSON.stringify({
    errors: [{ code: 'agent_grant_required', title: 'Grant required', detail: 'Sensitive provider detail' }],
  }), { status: 403, headers: { 'content-type': 'application/json' } })

  const client = new AgentsOnIntentsClient()
  await assert.rejects(client.post('/v1/agents/agent_test/transfer', {}, {
    grantToken: 'ngt_test_grant_token',
    idempotencyKey: 'phase1-transfer-0001',
  }), (error) => {
    assert.equal(error.upstreamStatus, 403)
    assert.deepEqual(error.providerCodes, ['agent_grant_required'])
    assert.doesNotMatch(error.message, /Sensitive provider detail|Grant required/)
    return true
  })
  assert.equal(calls.length, 1)
})

test('redirect responses are not followed', async () => {
  response = () => new Response(null, {
    status: 302,
    headers: { location: 'https://attacker.invalid/collect' },
  })

  const client = new AgentsOnIntentsClient()
  await assert.rejects(client.get('/v1/whoami'), { code: 'INTENTS_REQUEST_FAILED' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.origin, 'https://api.agentsonintents.com')
})
