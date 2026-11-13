import assert from 'node:assert/strict'
import { test } from 'node:test'
import { walletRateLimit } from '../src/middleware/wallet-security.ts'
import { readTokenCookie, setTokenCookie, clearTokenCookie } from '../src/services/session.service.ts'
import { env } from '../src/config/env.ts'

test('wallet rate limiting bounds repeated work and permits a fresh window', (t) => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const limiter = walletRateLimit(2, 1000)
  let error
  const headers = {}
  const response = { setHeader: (name, value) => { headers[name] = value } }
  const run = (ip) => { error = undefined; limiter({ ip }, response, (failure) => { error = failure }) }
  run('one'); assert.equal(error, undefined)
  run('one'); assert.equal(error, undefined)
  run('one'); assert.equal(error.code, 'WALLET_RATE_LIMITED')
  assert.equal(headers['Retry-After'], 1)
  run('two'); assert.equal(error, undefined)
  now = 2001
  run('one'); assert.equal(error, undefined)
})

test('opaque cookie parsing refuses malformed and duplicate cookies', () => {
  const token = 'a'.repeat(43)
  const read = (cookie) => readTokenCookie({ headers: { cookie } }, 'sg_session')
  assert.equal(read(`other=value; sg_session=${token}`), token)
  for (const value of ['', 'bad', 'a'.repeat(44), token + '%0a']) assert.equal(read(`sg_session=${value}`), undefined)
  assert.equal(read(`sg_session=${token}; sg_session=${token}`), undefined)
})

test('session cookies are HttpOnly, strict and secure on HTTPS or in production', (t) => {
  const original = { clientUrl: env.CLIENT_URL, mode: env.NODE_ENV }
  t.after(() => { env.CLIENT_URL = original.clientUrl; env.NODE_ENV = original.mode })
  let options
  const response = { cookie(_name, _token, value) { options = value }, clearCookie(_name, value) { options = value } }
  env.CLIENT_URL = 'https://spendguard.example'
  env.NODE_ENV = 'production'
  setTokenCookie(response, 'sg_session', 'synthetic-token', 60_000)
  assert.deepEqual(options, { httpOnly: true, sameSite: 'strict', path: '/api', secure: true, maxAge: 60_000 })
  clearTokenCookie(response, 'sg_session')
  assert.equal(options.secure, true)
  assert.equal(options.maxAge, undefined)
  env.CLIENT_URL = 'http://localhost:5173'
  env.NODE_ENV = 'development'
  setTokenCookie(response, 'sg_session', 'synthetic-token', 60_000)
  assert.equal(options.secure, false)
})
