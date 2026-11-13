import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWalletFlow } from '../src/services/wallet-flow.ts'

const time = Date.parse('2026-01-01T00:00:00Z')
const challenge = { challengeId: 'challenge-one', accountId: 'alice.near', networkId: 'mainnet',
  message: 'Exact ownership message\nDo not authorize spending.', recipient: 'localhost:5173',
  nonce: 'a'.repeat(43) + '=', expiresAt: new Date(time + 300_000).toISOString() }
const session = { user: { id: 'owner-one' }, wallet: { id: 'wallet-one', address: 'alice.near', network: 'near:mainnet',
  verificationStatus: 'VERIFIED', verifiedAt: new Date(time).toISOString() }, expiresAt: new Date(time + 3_600_000).toISOString() }
const signed = { accountId: 'alice.near', publicKey: 'test-public-key', signature: 'test-signature', state: challenge.challengeId }

function fixture(overrides = {}) {
  const calls = []
  const api = {
    getConfig: async () => ({ networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300 }),
    getSession: async () => null,
    getChallenge: async (address) => { calls.push(['challenge', address]); return structuredClone(challenge) },
    prepareWallet: async (network) => { calls.push(['prepare', network]) },
    signChallenge: async (value) => { calls.push(['sign', value]); return signed },
    submitProof: async (id, proof) => { calls.push(['submit', id, proof]); return session },
    logout: async () => { calls.push(['logout']) }, host: 'localhost:5173', now: () => time,
    ...overrides,
  }
  return { flow: createWalletFlow(api), calls, api }
}

test('an entered wallet address does not produce a verified session', async () => {
  const { flow, calls } = fixture()
  await flow.initialize()
  await flow.openDialog()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  assert.equal(flow.verified.value, false)
  assert.equal(flow.session.value, null)
  assert.equal(flow.challenge.value.message, challenge.message)
  assert.equal(calls.some(([method]) => method === 'sign'), false)
})

test('a first visit and opening the dialog do not sign or load Meteor before an account is entered', async () => {
  const { flow, calls } = fixture()
  await flow.initialize()
  await flow.openDialog()
  assert.equal(flow.accountId.value, '')
  assert.equal(flow.error.value, '')
  assert.equal(flow.connectionError.value, '')
  assert.equal(flow.ready.value, true)
  assert.deepEqual(calls, [])
})

test('a session gateway failure preserves network settings and offers recovery without an account error', async () => {
  let available = false
  const { flow, calls } = fixture({ getSession: async () => {
    if (!available) throw new Error('502 Bad Gateway')
    return null
  } })
  await flow.initialize()
  await flow.openDialog()
  assert.equal(flow.config.value.networkId, 'mainnet')
  assert.equal(flow.error.value, '')
  assert.match(flow.connectionError.value, /unavailable/)
  assert.equal(flow.ready.value, false)
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  assert.deepEqual(calls, [])
  available = true
  await flow.initialize()
  assert.equal(flow.ready.value, true)
  assert.equal(flow.connectionError.value, '')
  assert.equal(flow.accountId.value, 'alice.near')
  await flow.prepareChallenge()
  assert.equal(flow.challenge.value.accountId, 'alice.near')
})

test('a configuration failure never restores an unconfirmed session and can recover on refresh', async () => {
  let available = false
  const { flow } = fixture({ getConfig: async () => {
    if (!available) throw new Error('502 Bad Gateway')
    return { networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300 }
  }, getSession: async () => session })
  await flow.initialize()
  assert.equal(flow.session.value, null)
  assert.equal(flow.ready.value, false)
  assert.equal(flow.error.value, '')
  available = true
  await flow.refreshSession()
  assert.equal(flow.verified.value, true)
  assert.equal(flow.connectionError.value, '')
})

test('the exact reviewed challenge is signed and verified before showing a connected wallet', async () => {
  const { flow, calls } = fixture()
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  await flow.verifyChallenge()
  assert.deepEqual(calls.find(([method]) => method === 'sign')[1], challenge)
  assert.deepEqual(calls.find(([method]) => method === 'submit').slice(1), [challenge.challengeId, signed])
  assert.equal(flow.verified.value, true)
  assert.equal(flow.session.value.wallet.address, 'alice.near')
  assert.equal(flow.challenge.value, null)
  assert.equal(flow.dialogOpen.value, false)
})

test('a returned signature enters ownership verification before the wallet is connected', async () => {
  let finishVerification
  const { flow } = fixture({ submitProof: () => new Promise(resolve => { finishVerification = resolve }) })
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  const verification = flow.verifyChallenge()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(flow.busy.value, 'verifying')
  assert.equal(flow.verified.value, false)
  finishVerification(session)
  await verification
  assert.equal(flow.verified.value, true)
  assert.equal(flow.busy.value, '')
})

test('wallet cancellation leaves no session and requires a fresh challenge', async () => {
  const { flow, calls } = fixture({ signChallenge: async () => { throw new Error('User cancelled popup with internal details') } })
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  await flow.verifyChallenge()
  assert.equal(flow.verified.value, false)
  assert.equal(flow.challenge.value, null)
  assert.match(flow.error.value, /cancelled or failed/)
  assert.doesNotMatch(flow.error.value, /internal details/)
  assert.equal(calls.some(([method]) => method === 'submit'), false)
})

test('changed accounts and state never reach backend verification', async () => {
  for (const proof of [{ ...signed, accountId: 'bob.near' }, { ...signed, state: 'another-challenge' }, undefined]) {
    const { flow, calls } = fixture({ signChallenge: async () => proof })
    await flow.initialize()
    flow.accountId.value = 'alice.near'
    await flow.prepareChallenge()
    await flow.verifyChallenge()
    assert.equal(flow.verified.value, false)
    assert.equal(calls.some(([method]) => method === 'submit'), false)
  }
})

test('an expired challenge is never sent to the wallet', async () => {
  const { flow, api, calls } = fixture()
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  api.now = () => time + 300_001
  // The injected clock is captured at creation; expire the returned challenge instead.
  flow.challenge.value.expiresAt = new Date(time - 1).toISOString()
  await flow.verifyChallenge()
  assert.match(flow.error.value, /expired/)
  assert.equal(calls.some(([method]) => method === 'sign'), false)
})

test('backend failure never becomes a connected wallet', async () => {
  const { flow } = fixture({ submitProof: async () => { throw Object.assign(new Error('NEAR ownership verification is unavailable.'), { code: 'WALLET_VERIFICATION_UNAVAILABLE' }) } })
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  await flow.verifyChallenge()
  assert.equal(flow.session.value, null)
  assert.match(flow.error.value, /unavailable/)
})

test('restored sessions must be verified, current and on the configured network', async () => {
  for (const value of [
    { ...session, expiresAt: new Date(time - 1).toISOString() },
    { ...session, wallet: { ...session.wallet, verificationStatus: 'UNVERIFIED' } },
    { ...session, wallet: { ...session.wallet, network: 'near:testnet' } },
  ]) {
    const { flow } = fixture({ getSession: async () => value })
    await flow.initialize()
    assert.equal(flow.verified.value, false)
  }
  const { flow } = fixture({ getSession: async () => session })
  await flow.initialize()
  assert.equal(flow.verified.value, true)
})

test('wrong recipients and networks are rejected before signing', async () => {
  for (const changed of [{ ...challenge, recipient: 'evil.example' }, { ...challenge, networkId: 'testnet' }]) {
    const { flow, calls } = fixture({ getChallenge: async () => changed })
    await flow.initialize()
    flow.accountId.value = 'alice.near'
    await flow.prepareChallenge()
    assert.equal(flow.challenge.value, null)
    assert.equal(calls.some(([method]) => method === 'sign'), false)
  }
})

test('successful logout clears wallet state; failed logout stays retryable', async () => {
  const { flow } = fixture({ getSession: async () => session })
  await flow.initialize()
  await flow.disconnect()
  assert.equal(flow.session.value, null)
  const failed = fixture({ getSession: async () => session, logout: async () => { throw new Error('Network offline') } })
  await failed.flow.initialize()
  await failed.flow.disconnect()
  assert.equal(failed.flow.verified.value, true)
  assert.match(failed.flow.error.value, /try again/)
})

test('simultaneous verification clicks cannot request two signatures', async () => {
  let release
  let signatures = 0
  const { flow } = fixture({ signChallenge: () => { signatures++; return new Promise((resolve) => { release = resolve }) } })
  await flow.initialize()
  flow.accountId.value = 'alice.near'
  await flow.prepareChallenge()
  const first = flow.verifyChallenge()
  await flow.verifyChallenge()
  assert.equal(signatures, 1)
  release(signed)
  await first
})
