import assert from 'node:assert/strict'
import { test } from 'node:test'
import mongoose from 'mongoose'
import { UserModel, WalletModel } from '../src/models/index.ts'

const ownerUserId = new mongoose.Types.ObjectId()
const verifiedAt = new Date('2026-01-01T00:00:00Z')
const revokedAt = new Date('2026-01-02T00:00:00Z')

function wallet(overrides = {}) {
  return { ownerUserId, network: 'near:mainnet', address: 'user.near', ...overrides }
}

function proof(overrides = {}) {
  return {
    verificationStatus: 'VERIFIED', verifiedAt,
    verificationMethod: 'signature-proof', verificationReference: 'challenge-one',
    ...overrides,
  }
}

async function invalid(Model, data, path) {
  await assert.rejects(new Model(data).validate(), (error) => {
    assert.equal(error.name, 'ValidationError')
    assert.ok(error.errors[path], `Expected ${path}; got ${Object.keys(error.errors).join(', ')}`)
    return true
  })
}

test('authenticated identity values remain exact and distinct', async () => {
  const identity = { authIssuer: 'https://identity.example', authSubject: ' user-1 ' }
  const user = new UserModel(identity)
  await user.validate()
  assert.equal(user.authIssuer, identity.authIssuer)
  assert.equal(user.authSubject, identity.authSubject)
  assert.notEqual(user.authSubject, new UserModel({ ...identity, authSubject: 'user-1' }).authSubject)
  assert.equal(user.status, 'ACTIVE')
})

test('identities require nonblank strings and a valid account state', async () => {
  const identity = { authIssuer: 'https://identity.example', authSubject: 'user-1' }
  for (const field of ['authIssuer', 'authSubject']) {
    for (const value of [undefined, null, '', ' \t\n ', 123, {}, 'x'.repeat(513)]) {
      await invalid(UserModel, { ...identity, [field]: value }, field)
    }
  }
  await new UserModel({ ...identity, status: 'DISABLED' }).validate()
  await invalid(UserModel, { ...identity, status: null }, 'status')
})

test('the authenticated identity and wallet ownership cannot be reassigned after loading', async () => {
  const user = UserModel.hydrate(new UserModel({ authIssuer: 'issuer-one', authSubject: 'user-one' }).toObject())
  user.authIssuer = 'issuer-two'
  user.authSubject = 'user-two'
  assert.equal(user.authIssuer, 'issuer-one')
  assert.equal(user.authSubject, 'user-one')
  await assert.rejects(user.validate(), /immutable/)

  const record = WalletModel.hydrate(new WalletModel(wallet()).toObject())
  record.ownerUserId = new mongoose.Types.ObjectId()
  record.network = 'near:testnet'
  record.address = 'other.near'
  await assert.rejects(record.validate(), /immutable/)
  assert.equal(record.ownerUserId.toString(), ownerUserId.toString())
  assert.equal(record.network, 'near:mainnet')
  assert.equal(record.address, 'user.near')
})

test('a wallet requires its owner, network and address', async () => {
  await invalid(WalletModel, wallet({ ownerUserId: undefined }), 'ownerUserId')
  await invalid(WalletModel, wallet({ ownerUserId: 'another-user' }), 'ownerUserId')
  for (const field of ['network', 'address']) {
    for (const value of [undefined, null, '', 123, {}, 'x'.repeat(513)]) {
      await invalid(WalletModel, wallet({ [field]: value }), field)
    }
  }
})

test('wallet identifiers reject whitespace without silently changing an address', async () => {
  for (const field of ['network', 'address']) {
    for (const value of [' user.near', 'user.near ', 'user near', 'user\nnear', ' \t ']) {
      await invalid(WalletModel, wallet({ [field]: value }), field)
    }
  }
  // Phase 2 stores provider-validated canonical values without assuming a chain's casing rules.
  const record = new WalletModel(wallet({ network: 'other:mainnet', address: 'MixedCaseAddress' }))
  await record.validate()
  assert.equal(record.address, 'MixedCaseAddress')
})

test('an address submission has no verification or revocation evidence', async () => {
  const record = new WalletModel(wallet())
  await record.validate()
  assert.equal(record.verificationStatus, 'UNVERIFIED')
  for (const field of ['verifiedAt', 'verificationMethod', 'verificationReference', 'revokedAt']) {
    assert.equal(record[field], undefined)
    await invalid(WalletModel, wallet({ [field]: null }), 'verificationStatus')
  }
  await invalid(WalletModel, wallet({ verificationStatus: null }), 'verificationStatus')
})

test('verified wallets require the entire proof trail and cannot contain revocation metadata', async () => {
  await new WalletModel(wallet(proof())).validate()
  for (const field of ['verifiedAt', 'verificationMethod', 'verificationReference']) {
    for (const value of [undefined, null]) {
      await invalid(WalletModel, wallet(proof({ [field]: value })), field)
    }
  }
  await invalid(WalletModel, wallet(proof({ verifiedAt: 'not-a-date' })), 'verifiedAt')
  await invalid(WalletModel, wallet(proof({ revokedAt })), 'revokedAt')
  await invalid(WalletModel, wallet(proof({ revokedAt: null })), 'revokedAt')
})

test('revoking a verified wallet retains complete evidence in chronological order', async () => {
  await new WalletModel(wallet(proof({ verificationStatus: 'REVOKED', revokedAt }))).validate()
  for (const field of ['verifiedAt', 'verificationMethod', 'verificationReference']) {
    await invalid(WalletModel, wallet(proof({ verificationStatus: 'REVOKED', revokedAt, [field]: undefined })), field)
  }
  await invalid(WalletModel, wallet(proof({ verificationStatus: 'REVOKED', revokedAt: undefined })), 'revokedAt')
  await invalid(WalletModel, wallet(proof({ verificationStatus: 'REVOKED', revokedAt: new Date('2025-12-31') })), 'revokedAt')
})

test('an unverified wallet can be revoked without inventing ownership proof', async () => {
  const record = new WalletModel(wallet({ verificationStatus: 'REVOKED', revokedAt }))
  await record.validate()
  assert.equal(record.verifiedAt, undefined)
  assert.equal(record.verificationReference, undefined)
  await invalid(WalletModel, wallet({ verificationStatus: 'REVOKED', revokedAt, verificationReference: 'partial-proof' }), 'verifiedAt')
})

test('user and wallet records reject credentials and arbitrary client fields', () => {
  for (const [Model, data] of [
    [UserModel, { authIssuer: 'issuer', authSubject: 'user' }], [WalletModel, wallet()],
  ]) {
    for (const field of ['password', 'privateKey', 'seedPhrase', 'grantToken', 'isVerified']) {
      assert.throws(() => new Model({ ...data, [field]: 'sensitive-value' }), /strict mode/)
    }
  }
})

test('wallet indexes reserve globally only proven addresses and prevent duplicate owner records', () => {
  const indexes = WalletModel.schema.indexes()
  const find = (keys) => indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys))?.[1]
  const claim = find({ network: 1, address: 1 })
  assert.equal(claim.unique, true)
  assert.deepEqual(claim.partialFilterExpression, { verifiedAt: { $type: 'date' } })
  assert.equal(find({ ownerUserId: 1, network: 1, address: 1 }).unique, true)
  assert.ok(find({ ownerUserId: 1, verificationStatus: 1 }))
})

test('the wallet save path persists ownership, timestamps and an unverified default', async (t) => {
  let stored
  t.mock.method(WalletModel.collection, 'insertOne', async (document) => {
    stored = document
    return { acknowledged: true, insertedId: document._id }
  })
  const record = await WalletModel.create(wallet())
  assert.equal(stored.ownerUserId.toString(), ownerUserId.toString())
  assert.equal(stored.verificationStatus, 'UNVERIFIED')
  assert.equal(stored.verifiedAt, undefined)
  assert.ok(stored.createdAt instanceof Date)
  assert.ok(stored.updatedAt instanceof Date)
  assert.equal(record.id, stored._id.toString())
})

test('incomplete verification fails before a wallet can be persisted', async (t) => {
  const insert = t.mock.method(WalletModel.collection, 'insertOne', async () => {
    throw new Error('Invalid wallet must never reach persistence')
  })
  await assert.rejects(WalletModel.create(wallet({ verificationStatus: 'VERIFIED' })), /Verified wallets require/)
  assert.equal(insert.mock.callCount(), 0)
})
