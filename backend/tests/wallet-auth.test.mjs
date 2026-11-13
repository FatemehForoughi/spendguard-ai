import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, before, beforeEach, mock, test } from 'node:test'
import mongoose from 'mongoose'
import { KeyPair } from '@near-js/crypto'
import { serialize } from 'borsh'

process.env.NODE_ENV = 'test'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.NEAR_NETWORK_ID = 'mainnet'
process.env.NEAR_RPC_URL = 'https://near-rpc.example.test'
const { default: app } = await import('../src/app.ts')
const { UserModel, WalletModel } = await import('../src/models/index.ts')
const { SessionModel } = await import('../src/models/session.model.ts')
const { WalletChallengeModel } = await import('../src/models/wallet-challenge.model.ts')
const { nep413Hash, verifyNep413Signature } = await import('../src/services/near-wallet-verifier.ts')
const { hashToken } = await import('../src/services/session.service.ts')

const originalFetch = globalThis.fetch
const origin = 'http://localhost:5173'
const stores = new Map([UserModel, WalletModel, SessionModel, WalletChallengeModel].map((Model) => [Model, []]))
let rpcHandler
let rpcCalls
let server
let baseUrl
let clientNumber = 0

function matches(record, filter) {
  return Object.entries(filter).every(([key, wanted]) => {
    const actual = record[key]
    if (wanted && typeof wanted === 'object' && !(wanted instanceof mongoose.Types.ObjectId) && !(wanted instanceof Date)) {
      if ('$exists' in wanted) return Object.hasOwn(record, key) === wanted.$exists
      if ('$gt' in wanted) return actual > wanted.$gt
      if ('$type' in wanted) return wanted.$type === 'date' && actual instanceof Date
    }
    if (actual instanceof mongoose.Types.ObjectId) return actual.equals(wanted)
    return actual === wanted
  })
}

function applyUpdate(record, update) {
  if (update.$set) Object.assign(record, update.$set)
  if (update.$inc) for (const [field, value] of Object.entries(update.$inc)) record[field] = (record[field] ?? 0) + value
}

function installCollection(Model) {
  const documents = stores.get(Model)
  mock.method(Model.collection, 'insertOne', async (data) => {
    if (Model === UserModel && documents.some((d) => d.authIssuer === data.authIssuer && d.authSubject === data.authSubject)) {
      throw Object.assign(new Error('Duplicate identity'), { code: 11000 })
    }
    if (Model === WalletModel && data.verifiedAt && documents.some((d) => d.network === data.network && d.address === data.address && d.verifiedAt)) {
      throw Object.assign(new Error('Duplicate wallet claim'), { code: 11000 })
    }
    documents.push({ ...data })
    return { acknowledged: true, insertedId: data._id }
  })
  mock.method(Model.collection, 'findOne', async (filter) => documents.find((d) => matches(d, filter)) ?? null)
  mock.method(Model.collection, 'find', (filter) => ({ toArray: async () => documents.filter((d) => matches(d, filter)) }))
  mock.method(Model.collection, 'updateOne', async (filter, update) => {
    const record = documents.find((d) => matches(d, filter))
    if (record) applyUpdate(record, update)
    return { acknowledged: true, matchedCount: record ? 1 : 0, modifiedCount: record ? 1 : 0 }
  })
  mock.method(Model.collection, 'findOneAndUpdate', async (filter, update) => {
    const record = documents.find((d) => matches(d, filter))
    if (!record) return null
    applyUpdate(record, update)
    return { ...record }
  })
}

before(async () => {
  for (const Model of stores.keys()) installCollection(Model)
  mock.method(console, 'error', () => {})
  mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) !== process.env.NEAR_RPC_URL) return originalFetch(url, options)
    rpcCalls++
    return rpcHandler(url, options)
  })
  server = createServer(app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(() => {
  for (const documents of stores.values()) documents.length = 0
  rpcCalls = 0
  rpcHandler = async (_url, options) => {
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal)
    const request = JSON.parse(options.body)
    assert.equal(request.method, 'query')
    assert.equal(request.params.request_type, 'view_access_key')
    assert.equal(request.params.finality, 'final')
    return Response.json({ jsonrpc: '2.0', id: 'spendguard-wallet-key', result: {
      permission: 'FullAccess', block_height: 100, block_hash: 'final-block',
    } })
  }
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  mock.restoreAll()
})

// Synthetic test keys only. Sign independently from the production hash helper,
// following the published Wallet Selector payload schema.
function signChallenge(challenge, key = KeyPair.fromRandom('ed25519'), overrides = {}) {
  const payload = { tag: 2147484061, message: challenge.message,
    nonce: Buffer.from(challenge.nonce, 'base64'), recipient: challenge.recipient, callbackUrl: undefined, ...overrides }
  const bytes = serialize({ struct: {
    tag: 'u32', message: 'string', nonce: { array: { type: 'u8', len: 32 } }, recipient: 'string', callbackUrl: { option: 'string' },
  } }, payload)
  // SHA-256 itself uses a separately imported platform primitive.
  return import('node:crypto').then(({ createHash }) => ({
    challengeId: challenge.challengeId, accountId: challenge.accountId,
    publicKey: key.getPublicKey().toString(), signature: Buffer.from(key.sign(createHash('sha256').update(bytes).digest()).signature).toString('base64'),
  }))
}

function browser() {
  const cookies = new Map()
  // Each test client receives its own synthetic loopback source IP, avoiding rate limiter coupling.
  const address = `127.0.0.${++clientNumber + 1}`
  return {
    cookies,
    async request(path, body, options = {}) {
      const headers = { origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers }
      if (body !== undefined) headers['content-type'] = 'application/json'
      const response = await new Promise((resolve, reject) => {
        const req = httpRequest(`${baseUrl}/api/${path}`, {
          method: body === undefined ? 'GET' : 'POST', headers, localAddress: address, agent: false,
        }, (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            const headers = new Headers()
            for (const [key, value] of Object.entries(res.headers)) {
              for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) headers.append(key, entry)
            }
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }))
          })
        })
        req.on('error', reject)
        req.end(body === undefined ? undefined : JSON.stringify(body))
      })
      for (const cookie of response.headers.getSetCookie()) {
        const part = cookie.split(';')[0]
        const separator = part.indexOf('=')
        const key = part.slice(0, separator)
        const value = part.slice(separator + 1)
        if (value) cookies.set(key, value); else cookies.delete(key)
      }
      return { response, status: response.status, body: await response.json(), address }
    },
  }
}

async function challengeFor(client, accountId = 'alice.near') {
  const result = await client.request('wallet/challenges', { accountId })
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.data
}

function seedSession(client, accountId = 'alice.near') {
  const user = new UserModel({ authIssuer: 'near:mainnet', authSubject: accountId }).toObject()
  const wallet = new WalletModel({ ownerUserId: user._id, network: 'near:mainnet', address: accountId,
    verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationMethod: 'NEP413', verificationReference: randomUUID() }).toObject()
  const token = randomBytes(32).toString('base64url')
  const session = new SessionModel({ ownerUserId: user._id, walletId: wallet._id, tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000) }).toObject()
  stores.get(UserModel).push(user)
  stores.get(WalletModel).push(wallet)
  stores.get(SessionModel).push(session)
  client.cookies.set('sg_session', token)
  return { user, wallet, session }
}

test('NEP-413 hash agrees with a fixed canonical Borsh byte fixture', () => {
  assert.equal(Buffer.from(nep413Hash({ message: 'hi', recipient: 'myapp.com', nonce: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64') })).toString('hex'),
    '0e80e1606a46e66fcb450f6ceb55803921e465fddee8216463cf7b2680c09f37')
})

test('signature verification rejects malformed keys, signatures and changed signed fields', async () => {
  const payload = { challengeId: randomUUID(), accountId: 'alice.near', message: 'hi', recipient: 'myapp.com', nonce: randomBytes(32).toString('base64') }
  const proof = await signChallenge(payload)
  assert.equal(verifyNep413Signature(payload, proof.publicKey, proof.signature), true)
  for (const change of [{ message: 'changed' }, { recipient: 'evil.example' }, { nonce: randomBytes(32).toString('base64') }]) {
    assert.equal(verifyNep413Signature({ ...payload, ...change }, proof.publicKey, proof.signature), false)
  }
  for (const key of ['ed25519:bad', 'secp256k1:bad', 'ed25519:' + '1'.repeat(44)]) assert.equal(verifyNep413Signature(payload, key, proof.signature), false)
  for (const signature of ['bad', proof.signature.replace(/=$/, ''), proof.signature + '\n']) assert.equal(verifyNep413Signature(payload, proof.publicKey, signature), false)
})

test('a submitted address creates only a browser-bound challenge, never a user, wallet or session', async () => {
  const client = browser()
  const result = await client.request('wallet/challenges', { accountId: 'alice.near' })
  assert.equal(result.status, 201)
  assert.equal(Buffer.from(result.body.data.nonce, 'base64').length, 32)
  assert.equal(result.body.data.recipient, 'localhost:5173')
  assert.match(result.body.data.message, /does not authorize transactions or spending/)
  assert.ok(client.cookies.get('sg_wallet_flow'))
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/)
  assert.match(result.response.headers.get('set-cookie'), /SameSite=Strict/)
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  for (const Model of [UserModel, WalletModel, SessionModel]) assert.equal(stores.get(Model).length, 0)
  assert.doesNotMatch(JSON.stringify(result.body), /browserBindingHash|tokenHash/)
})

test('a valid signature plus a full-access key creates the verified wallet and hashed session', async () => {
  const client = browser()
  const challenge = await challengeFor(client)
  const result = await client.request('wallet/verify', await signChallenge(challenge))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.data.wallet.verificationStatus, 'VERIFIED')
  assert.equal(result.body.data.wallet.address, 'alice.near')
  assert.equal(rpcCalls, 1)
  const [wallet] = stores.get(WalletModel)
  const [user] = stores.get(UserModel)
  assert.ok(wallet.ownerUserId.equals(user._id))
  assert.equal(wallet.verificationReference, challenge.challengeId)
  const [session] = stores.get(SessionModel)
  assert.equal(session.tokenHash, hashToken(client.cookies.get('sg_session')))
  assert.notEqual(session.tokenHash, client.cookies.get('sg_session'))
  assert.ok(stores.get(WalletChallengeModel)[0].consumedAt)
  assert.equal(client.cookies.has('sg_wallet_flow'), false)
  assert.doesNotMatch(JSON.stringify(result.body), /signature|publicKey|tokenHash|browserBindingHash/)
  assert.equal((await client.request('auth/session')).body.data.wallet.address, 'alice.near')
})

test('an invalid signature never calls RPC or creates authenticated records', async () => {
  const client = browser()
  const challenge = await challengeFor(client)
  const result = await client.request('wallet/verify', await signChallenge(challenge, undefined, { message: 'tampered' }))
  assert.equal(result.status, 401)
  assert.equal(result.body.code, 'INVALID_WALLET_SIGNATURE')
  assert.equal(rpcCalls, 0)
  assert.equal(stores.get(WalletModel).length, 0)
})

test('expired and replayed challenges are rejected before persistence', async () => {
  const client = browser()
  const challenge = await challengeFor(client)
  const record = stores.get(WalletChallengeModel)[0]
  const proof = await signChallenge(challenge)
  record.expiresAt = new Date(Date.now() - 1)
  let result = await client.request('wallet/verify', proof)
  assert.equal(result.status, 401)
  record.expiresAt = new Date(Date.now() + 60_000)
  record.consumedAt = new Date()
  result = await client.request('wallet/verify', proof)
  assert.equal(result.status, 401)
  assert.equal(rpcCalls, 0)
  assert.equal(stores.get(SessionModel).length, 0)
})

test('a proof from another browser or account cannot use the challenge', async () => {
  const client = browser()
  const other = browser()
  const proof = await signChallenge(await challengeFor(client))
  assert.equal((await other.request('wallet/verify', proof)).status, 401)
  assert.equal((await client.request('wallet/verify', { ...proof, accountId: 'bob.near' })).status, 401)
  assert.equal(rpcCalls, 0)
})

test('function-call keys and absent keys fail ownership verification', async () => {
  const client = browser()
  rpcHandler = async () => Response.json({ jsonrpc: '2.0', id: 'spendguard-wallet-key', result: {
    permission: { FunctionCall: { receiver_id: 'contract.near', method_names: [] } }, block_height: 100, block_hash: 'block',
  } })
  let result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 401)
  assert.equal(result.body.code, 'WALLET_KEY_NOT_AUTHORIZED')
  rpcHandler = async () => Response.json({ error: { cause: { name: 'UNKNOWN_ACCESS_KEY' } } })
  result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 401)
  assert.equal(stores.get(SessionModel).length, 0)
})

test('RPC failure and malformed output fail safely without exposing upstream details', async () => {
  const client = browser()
  rpcHandler = async () => { throw new Error('secret upstream transport details') }
  let result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 503)
  assert.equal(result.body.code, 'WALLET_VERIFICATION_UNAVAILABLE')
  assert.doesNotMatch(JSON.stringify(result.body), /secret|transport/)
  rpcHandler = async () => Response.json({ result: { permission: 'FullAccess' } })
  result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 503)
  assert.equal(stores.get(UserModel).length, 0)
})

test('a wallet cannot be attached to a different authenticated owner', async () => {
  const client = browser()
  seedSession(client, 'alice.near')
  seedSession(browser(), 'bob.near')
  const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client, 'bob.near')))
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'WALLET_ALREADY_LINKED')
  assert.equal(stores.get(WalletModel).find((w) => w.address === 'bob.near').ownerUserId.toString(), stores.get(UserModel)[1]._id.toString())
})

test('changing the session owner invalidates an already issued link challenge', async () => {
  const client = browser()
  seedSession(client, 'alice.near')
  const challenge = await challengeFor(client, 'charlie.near')
  const second = browser()
  seedSession(second, 'bob.near')
  client.cookies.set('sg_session', second.cookies.get('sg_session'))
  const result = await client.request('wallet/verify', await signChallenge(challenge))
  assert.equal(result.status, 401)
  assert.equal(result.body.code, 'INVALID_WALLET_CHALLENGE')
  assert.equal(rpcCalls, 0)
})

test('wallet list and detail endpoints exclude another owner and require authentication', async () => {
  const client = browser()
  const own = seedSession(client, 'alice.near')
  const other = seedSession(browser(), 'bob.near')
  const list = await client.request('wallet')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.data.map((w) => w.id), [own.wallet._id.toString()])
  assert.equal((await client.request(`wallet/${other.wallet._id}`)).status, 404)
  assert.equal((await client.request(`wallet/${own.wallet._id}`)).status, 200)
  assert.equal((await browser().request('wallet')).status, 401)
})

test('disabled owners, expired sessions and revoked wallets do not authenticate', async () => {
  const client = browser()
  const record = seedSession(client)
  record.user.status = 'DISABLED'
  assert.equal((await client.request('auth/session')).body.data, null)
  record.user.status = 'ACTIVE'
  client.cookies.set('sg_session', randomBytes(32).toString('base64url'))
  assert.equal((await client.request('wallet')).status, 401)
  const client2 = browser()
  const record2 = seedSession(client2, 'bob.near')
  record2.session.expiresAt = new Date(Date.now() - 1)
  assert.equal((await client2.request('auth/session')).body.data, null)
  const client3 = browser()
  const record3 = seedSession(client3, 'charlie.near')
  record3.wallet.verificationStatus = 'REVOKED'
  record3.wallet.revokedAt = new Date()
  assert.equal((await client3.request('auth/session')).body.data, null)
})

test('logout revokes the server session and clears both HttpOnly cookies', async () => {
  const client = browser()
  const { session } = seedSession(client)
  client.cookies.set('sg_wallet_flow', randomBytes(32).toString('base64url'))
  const result = await client.request('auth/logout', {})
  assert.equal(result.status, 200)
  assert.ok(session.revokedAt)
  assert.equal(client.cookies.size, 0)
  assert.equal((await client.request('auth/session')).body.data, null)
})

test('untrusted origins, missing origins and client verification flags are rejected', async () => {
  const client = browser()
  for (const origin of ['https://evil.example', 'null', '']) {
    const result = await client.request('wallet/challenges', { accountId: 'alice.near' }, { headers: { origin } })
    assert.equal(result.status, 403)
  }
  const result = await client.request('wallet/challenges', { accountId: 'alice.near', verificationStatus: 'VERIFIED', ownerUserId: 'forged' })
  assert.equal(result.status, 400)
})

test('concurrent submissions consume a challenge exactly once', async () => {
  const client = browser()
  const challenge = await challengeFor(client)
  const proof = await signChallenge(challenge)
  const results = await Promise.all([client.request('wallet/verify', proof), client.request('wallet/verify', proof)])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401])
  assert.equal(stores.get(SessionModel).length, 1)
  assert.equal(stores.get(WalletModel).length, 1)
})

test('a challenge expiring during the key lookup cannot establish ownership', async () => {
  const client = browser()
  const challenge = await challengeFor(client)
  const validRpc = rpcHandler
  rpcHandler = async (...args) => {
    stores.get(WalletChallengeModel)[0].expiresAt = new Date(Date.now() - 1)
    return validRpc(...args)
  }
  const result = await client.request('wallet/verify', await signChallenge(challenge))
  assert.equal(result.status, 401)
  assert.equal(stores.get(UserModel).length, 0)
  assert.equal(stores.get(SessionModel).length, 0)
})

test('a session revoked during the key lookup cannot link another wallet', async () => {
  const client = browser()
  const existing = seedSession(client)
  const challenge = await challengeFor(client, 'charlie.near')
  const validRpc = rpcHandler
  rpcHandler = async (...args) => { existing.session.revokedAt = new Date(); return validRpc(...args) }
  const result = await client.request('wallet/verify', await signChallenge(challenge))
  assert.equal(result.status, 401)
  assert.equal(stores.get(WalletModel).length, 1)
})

test('a verified second wallet links to the current user and can sign back into that user', async () => {
  const client = browser()
  const existing = seedSession(client)
  const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client, 'charlie.near')))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.data.user.id, existing.user._id.toString())
  assert.ok(existing.session.revokedAt, 'The old session must be rotated')
  const secondWallet = stores.get(WalletModel).find((w) => w.address === 'charlie.near')
  assert.ok(secondWallet.ownerUserId.equals(existing.user._id))
  await client.request('auth/logout', {})
  const signedBackIn = await client.request('wallet/verify', await signChallenge(await challengeFor(client, 'charlie.near')))
  assert.equal(signedBackIn.status, 200)
  assert.equal(signedBackIn.body.data.user.id, existing.user._id.toString())
  assert.equal(stores.get(UserModel).length, 1)
})

test('another user cannot reserve a wallet by storing an unverified candidate', async () => {
  const client = browser()
  const otherOwner = seedSession(browser(), 'bob.near').user
  stores.get(WalletModel).push(new WalletModel({ ownerUserId: otherOwner._id, network: 'near:mainnet', address: 'alice.near' }).toObject())
  const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 200)
  const candidates = stores.get(WalletModel).filter((w) => w.address === 'alice.near')
  assert.equal(candidates.length, 2)
  assert.equal(candidates.filter((w) => w.verificationStatus === 'VERIFIED').length, 1)
  assert.ok(candidates.find((w) => w.verificationStatus === 'UNVERIFIED').ownerUserId.equals(otherOwner._id))
})

test('a verified wallet that was revoked cannot regain access by starting a new login', async () => {
  const client = browser()
  const existing = seedSession(client)
  existing.wallet.verificationStatus = 'REVOKED'
  existing.wallet.revokedAt = new Date()
  client.cookies.delete('sg_session')
  const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'WALLET_REVOKED')
})

test('a disabled owner cannot obtain a new session from a valid wallet proof', async () => {
  const client = browser()
  seedSession(client).user.status = 'DISABLED'
  client.cookies.delete('sg_session')
  const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'ACCOUNT_DISABLED')
})

test('a concurrent unique-index conflict does not return a session or raw database error', async (t) => {
  const client = browser()
  const challenge = await challengeFor(client)
  t.mock.method(WalletModel.collection, 'insertOne', async () => { throw Object.assign(new Error('Sensitive database payload'), { code: 11000 }) })
  const result = await client.request('wallet/verify', await signChallenge(challenge))
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'WALLET_OWNERSHIP_CONFLICT')
  assert.doesNotMatch(JSON.stringify(result.body), /Sensitive database payload/)
  assert.equal(stores.get(SessionModel).length, 0)
})

test('RPC deadlines, missing accounts and invalid response IDs fail safely', async () => {
  const client = browser()
  for (const handler of [
    async () => { throw new DOMException('RPC timed out', 'TimeoutError') },
    async () => Response.json({ jsonrpc: '2.0', id: 'wrong-id', result: { permission: 'FullAccess', block_height: 10, block_hash: 'block' } }),
    async () => Response.json({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }),
  ]) {
    rpcHandler = handler
    const result = await client.request('wallet/verify', await signChallenge(await challengeFor(client)))
    assert.ok([401, 503].includes(result.status))
    assert.equal(stores.get(SessionModel).length, 0)
  }
})

test('malformed JSON does not log wallet signature material', async (t) => {
  const logged = []
  t.mock.method(console, 'error', (...args) => { logged.push(args) })
  const response = await originalFetch(`${baseUrl}/api/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: '{"signature":"sensitive-wallet-signature",',
  })
  assert.equal(response.status, 400)
  assert.doesNotMatch(JSON.stringify(logged), /sensitive-wallet-signature/)
  assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive-wallet-signature/)
})
