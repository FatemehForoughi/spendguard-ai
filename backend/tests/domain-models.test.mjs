import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { test } from 'node:test'
import mongoose from 'mongoose'
import {
  UserModel, WalletModel, AgentModel, PolicyModel, GrantModel, TransactionModel,
} from '../src/models/index.ts'

const ownerUserId = new mongoose.Types.ObjectId()
const agentId = new mongoose.Types.ObjectId()
const walletId = new mongoose.Types.ObjectId()
const policyId = new mongoose.Types.ObjectId()
const past = new Date('2025-01-01T00:00:00Z')
const future = new Date('2099-01-01T00:00:00Z')
const source = 'nep141:usdc.near'
const destination = 'nep141:wrap.near'

function policy(overrides = {}) {
  return {
    ownerUserId, agentId, version: 1, allowedSourceAssets: [source],
    allowedDestinationAssets: [destination], requiresUserApproval: true,
    spendingLimits: [{ assetId: source, maxPerOperationBaseUnits: '10000000', dailyLimitBaseUnits: '30000000' }],
    ...overrides,
  }
}

function grant(overrides = {}) {
  return {
    ownerUserId, agentId, policyId, policyVersion: 1, providerGrantId: 'provider-grant-1',
    tokenSecretRef: { store: 'test-vault', key: 'grants/one' },
    scope: { operationType: 'SWAP', allowedSourceAssets: [source], allowedDestinationAssets: [destination] },
    expiresAt: future, ...overrides,
  }
}

function operation(overrides = {}) {
  return {
    type: 'SWAP', inputAssetId: source, outputAssetId: destination,
    inputAmountBaseUnits: '5000000', ...overrides,
  }
}

function transaction(operationOverrides = {}, overrides = {}) {
  return { ownerUserId, agentId, request: 'Swap 5 USDC to NEAR.', operation: operation(operationOverrides), ...overrides }
}

function quote(overrides = {}) {
  return {
    inputAssetId: source, outputAssetId: destination, inputAmountBaseUnits: '5000000',
    estimatedOutputAmountBaseUnits: '1500000000000000000000000', receivedAt: past, expiresAt: future,
    fees: [{ assetId: source, amountBaseUnits: '0' }], ...overrides,
  }
}

function approval(overrides = {}) {
  return {
    status: 'APPROVED', reference: 'approval-one', reviewedOperationDigest: 'a'.repeat(64),
    decidedByUserId: ownerUserId, decidedAt: past, expiresAt: future, ...overrides,
  }
}

async function invalid(Model, data, path) {
  await assert.rejects(async () => new Model(data).validate(), (error) => {
    assert.equal(error.name, 'ValidationError')
    assert.ok(Object.keys(error.errors).some((key) => key === path || key.startsWith(`${path}.`)),
      `Expected an error for ${path}; got ${Object.keys(error.errors).join(', ')}`)
    return true
  })
}

test('an identity requires issuer and subject, without introducing passwords', async () => {
  await new UserModel({ authIssuer: 'test-issuer', authSubject: 'user-1' }).validate()
  await invalid(UserModel, { authSubject: 'user-1' }, 'authIssuer')
  await invalid(UserModel, { authIssuer: ' ' }, 'authSubject')
  assert.throws(() => new UserModel({ authIssuer: 'test', authSubject: 'one', password: 'secret' }), /strict mode/)
})

test('an address alone remains unverified and verified wallets require proof metadata', async () => {
  const data = { ownerUserId, network: 'near:mainnet', address: 'user.near' }
  const wallet = new WalletModel(data)
  await wallet.validate()
  assert.equal(wallet.verificationStatus, 'UNVERIFIED')
  assert.equal(wallet.verifiedAt, undefined)
  await invalid(WalletModel, { ...data, verificationStatus: 'VERIFIED' }, 'verifiedAt')
  await invalid(WalletModel, { ...data, verificationStatus: 'VERIFIED', verifiedAt: past }, 'verificationReference')
  await new WalletModel({
    ...data, verificationStatus: 'VERIFIED', verifiedAt: past,
    verificationMethod: 'documented-signature-method', verificationReference: 'verified-challenge-1',
  }).validate()
  await invalid(WalletModel, { ...data, verifiedAt: past }, 'verificationStatus')
  await invalid(WalletModel, { ...data, verificationStatus: 'REVOKED' }, 'revokedAt')
})

test('agents start pending and cannot be active without a provider identifier', async () => {
  const data = { ownerUserId, walletId, name: 'My Trading Agent', operationType: 'SWAP' }
  const agent = new AgentModel(data)
  await agent.validate()
  assert.equal(agent.status, 'PENDING')
  await invalid(AgentModel, { ...data, status: 'ACTIVE' }, 'externalAgentId')
  await invalid(AgentModel, { ...data, walletId: undefined }, 'walletId')
  await invalid(AgentModel, { ...data, operationType: 'ARBITRARY_TRANSFER' }, 'operationType')
  await new AgentModel({ ...data, status: 'ACTIVE', externalAgentId: 'provider-agent-1' }).validate()
})

test('each workflow record requires an owner and linked records require an agent', async () => {
  for (const [Model, data] of [
    [WalletModel, { ownerUserId, network: 'near:mainnet', address: 'user.near' }],
    [AgentModel, { ownerUserId, walletId, name: 'Agent', operationType: 'SWAP' }],
    [PolicyModel, policy()], [GrantModel, grant()], [TransactionModel, transaction()],
  ]) {
    await invalid(Model, { ...data, ownerUserId: undefined }, 'ownerUserId')
    await invalid(Model, { ...data, ownerUserId: 'invalid-object-id' }, 'ownerUserId')
  }
  for (const [Model, data] of [[PolicyModel, policy()], [GrantModel, grant()], [TransactionModel, transaction()]]) {
    await invalid(Model, { ...data, agentId: undefined }, 'agentId')
  }
})

test('policy limits preserve integers above the safe JavaScript number range', async () => {
  const amount = '900719925474099312345678901234567890'
  const record = new PolicyModel(policy({ spendingLimits: [
    { assetId: source, maxPerOperationBaseUnits: amount, dailyLimitBaseUnits: amount },
  ] }))
  await record.validate()
  assert.equal(record.spendingLimits[0].maxPerOperationBaseUnits, amount)
  assert.equal(record.requiresUserApproval, true)
  assert.equal(record.status, 'DRAFT')
})

test('policy requires explicit approval preference, version and limits for every source', async () => {
  await invalid(PolicyModel, policy({ requiresUserApproval: undefined }), 'requiresUserApproval')
  await invalid(PolicyModel, policy({ version: undefined }), 'version')
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await invalid(PolicyModel, policy({ version }), 'version')
  }
  await invalid(PolicyModel, policy({ spendingLimits: [] }), 'spendingLimits')
  await invalid(PolicyModel, policy({ allowedSourceAssets: [source, 'another-asset'] }), 'spendingLimits')
  await invalid(PolicyModel, policy({ spendingLimits: [...policy().spendingLimits, ...policy().spendingLimits] }), 'spendingLimits')
  await invalid(PolicyModel, policy({ spendingLimits: [
    { assetId: source, maxPerOperationBaseUnits: '9007199254740993', dailyLimitBaseUnits: '9007199254740992' },
  ] }), 'spendingLimits')
  await new PolicyModel(policy({ requiresUserApproval: false })).validate()
})

test('asset allowlists reject missing, duplicate, empty and scalar values', async () => {
  for (const value of [undefined, [], [''], [' '], [source, source], source, [null]]) {
    await invalid(PolicyModel, policy({ allowedSourceAssets: value }), 'allowedSourceAssets')
    await invalid(PolicyModel, policy({ allowedDestinationAssets: value }), 'allowedDestinationAssets')
  }
})

for (const amount of [0, 5, 9007199254740992, '0', '-1', '01', '1.5', '1e6', ' 10', '10 ', '', null]) {
  test(`base-unit fields reject lossy or noncanonical input: ${JSON.stringify(amount)}`, async () => {
    await invalid(TransactionModel, transaction({ inputAmountBaseUnits: amount }), 'operation.inputAmountBaseUnits')
    await invalid(PolicyModel, policy({ spendingLimits: [
      { assetId: source, maxPerOperationBaseUnits: amount, dailyLimitBaseUnits: '100000000000000000000' },
    ] }), 'spendingLimits')
  })
}

test('grant material is limited to a hidden secret-store reference', async (t) => {
  const document = new GrantModel(grant())
  await document.validate()
  assert.equal(document.status, 'PENDING')
  assert.equal(document.tokenSecretRef.key, 'grants/one')
  for (const output of [document.toJSON(), document.toObject(), JSON.stringify(document), inspect(document)]) {
    assert.doesNotMatch(typeof output === 'string' ? output : JSON.stringify(output), /tokenSecretRef|test-vault|grants\/one/)
  }
  await invalid(GrantModel, grant({ tokenSecretRef: undefined }), 'tokenSecretRef')
  assert.throws(() => new GrantModel(grant({ grantToken: 'do-not-store' })), /strict mode/)
  await invalid(GrantModel, grant({ tokenSecretRef: { store: 'test-vault', key: 'key', token: 'do-not-store' } }), 'tokenSecretRef')
  await invalid(GrantModel, grant({ scope: { ...grant().scope, token: 'do-not-store' } }), 'scope')

  // Exercise Mongoose's real query projection, including lean queries, without a database.
  const projections = []
  t.mock.method(GrantModel.collection, 'findOne', async (_filter, options) => {
    projections.push(options.projection)
    return null
  })
  await GrantModel.findOne({ ownerUserId }).lean()
  await GrantModel.findOne({ ownerUserId })
  assert.deepEqual(projections, [{ tokenSecretRef: 0 }, { tokenSecretRef: 0 }])
})

test('grant expiry and revocation cannot be represented as active authorization', async () => {
  await invalid(GrantModel, grant({ expiresAt: undefined }), 'expiresAt')
  await invalid(GrantModel, grant({ status: 'ACTIVE', expiresAt: past }), 'expiresAt')
  await invalid(GrantModel, grant({ status: 'REVOKED' }), 'revokedAt')
  await invalid(GrantModel, grant({ status: 'ACTIVE', revokedAt: past }), 'status')
  await invalid(GrantModel, grant({ scope: { ...grant().scope, operationType: 'TRANSFER' } }), 'scope.operationType')
  await new GrantModel(grant({ status: 'ACTIVE' })).validate()
  await new GrantModel(grant({ status: 'REVOKED', revokedAt: past })).validate()
  await new GrantModel(grant({ status: 'EXPIRED', expiresAt: past })).validate()
})

test('legacy analysis documents retain their existing shape and validation', async () => {
  const data = { analysisId: 'legacy-analysis', request: 'Transfer 1 NEAR', status: 'ALLOW', message: 'Low risk.' }
  const record = new TransactionModel(data)
  await record.validate()
  assert.equal(record.score, 1)
  assert.equal(record.approved, false)
  assert.equal(record.details.amount, null)
  assert.equal(record.ownerUserId, undefined)
  assert.equal(record.operation, undefined)
  await invalid(TransactionModel, { ...data, status: undefined }, 'status')
  await invalid(TransactionModel, { ...data, message: undefined }, 'message')
  await invalid(TransactionModel, { ...data, status: 'SUCCESS' }, 'status')
})

test('an unanalysed operation starts as a draft, without inventing an ALLOW result', async () => {
  const first = new TransactionModel(transaction())
  const second = new TransactionModel(transaction())
  await first.validate()
  await second.validate()
  assert.equal(first.operation.executionStatus, 'DRAFT')
  assert.equal(first.operation.approval.status, 'NOT_REQUESTED')
  assert.equal(first.status, undefined)
  assert.equal(first.score, undefined)
  assert.equal(first.message, undefined)
  assert.notEqual(first.analysisId, second.analysisId)
  assert.notEqual(first.operation.operationId, second.operation.operationId)
  assert.notEqual(first.operation.idempotencyKey, second.operation.idempotencyKey)
  const persisted = first.toObject()
  const reloaded = TransactionModel.hydrate(persisted)
  assert.equal(reloaded.operation.idempotencyKey, first.operation.idempotencyKey)
  assert.equal(reloaded.operation.operationId, first.operation.operationId)
  await invalid(TransactionModel, transaction({}, { score: 10 }), 'status')
  await invalid(TransactionModel, transaction({}, { status: 'ALLOW' }), 'message')
})

test('operation quote snapshots retain exact output amounts and reject mismatched requests', async () => {
  const record = new TransactionModel(transaction({ quote: quote() }))
  await record.validate()
  assert.equal(record.operation.quote.estimatedOutputAmountBaseUnits, '1500000000000000000000000')
  assert.equal(record.operation.executionStatus, 'DRAFT')
  assert.equal(record.operation.quote.fees[0].amountBaseUnits, '0')
  for (const mismatch of [{ inputAssetId: 'another' }, { outputAssetId: 'another' }, { inputAmountBaseUnits: '6000000' }]) {
    await invalid(TransactionModel, transaction({ quote: quote(mismatch) }), 'operation.quote')
  }
  await invalid(TransactionModel, transaction({ quote: quote({ receivedAt: future, expiresAt: past }) }), 'operation.quote.expiresAt')
  const noExpiry = new TransactionModel(transaction({ quote: quote({ expiresAt: undefined }) }))
  await noExpiry.validate()
  assert.equal(noExpiry.operation.quote.expiresAt, undefined)
})

test('policy decisions and approval metadata are associated with their exact record and owner', async () => {
  await invalid(TransactionModel, transaction({ policyId }), 'operation.policyVersion')
  await invalid(TransactionModel, transaction({ policyVersion: 1 }), 'operation.policyVersion')
  await invalid(TransactionModel, transaction({ approval: { status: 'APPROVED' } }), 'operation.approval.reference')
  await invalid(TransactionModel, transaction({ quote: quote(), approval: approval({ decidedByUserId: new mongoose.Types.ObjectId() }) }), 'operation.approval.decidedByUserId')
  await invalid(TransactionModel, transaction({ quote: quote(), approval: approval({ decidedAt: future }) }), 'operation.approval.decidedAt')
  await invalid(TransactionModel, transaction({ quote: quote(), approval: approval({ reviewedOperationDigest: 'invalid' }) }), 'operation.approval.reviewedOperationDigest')
  const record = new TransactionModel(transaction({ policyId, policyVersion: 1, quote: quote(), approval: approval() }))
  await record.validate()
  assert.equal(record.operation.executionStatus, 'DRAFT')
  assert.equal(record.approved, false, 'Legacy UI approval remains separate from an operation approval')
})

test('models reject unrecognized states and raw provider errors', async () => {
  for (const [Model, data, field] of [
    [UserModel, { authIssuer: 'test', authSubject: 'one' }, 'status'],
    [WalletModel, { ownerUserId, network: 'near', address: 'user.near' }, 'verificationStatus'],
    [AgentModel, { ownerUserId, walletId, name: 'Agent', operationType: 'SWAP' }, 'status'],
    [PolicyModel, policy(), 'status'], [GrantModel, grant(), 'status'],
  ]) await invalid(Model, { ...data, [field]: 'INVALID' }, field)
  await invalid(TransactionModel, transaction({ executionStatus: 'ALLOW' }), 'operation.executionStatus')
  await invalid(TransactionModel, transaction({ approval: { status: 'INVALID' } }), 'operation.approval.status')
  await invalid(TransactionModel, transaction({ providerErrorCode: 'Server failed with secret token' }), 'operation.providerErrorCode')
  await invalid(TransactionModel, transaction({ quote: { ...quote(), rawResponse: { token: 'secret' } } }), 'operation.quote')
})

test('owner links, operation identity and policy contents stay immutable after hydration', async () => {
  const original = new TransactionModel(transaction()).toObject()
  const record = TransactionModel.hydrate(original)
  record.ownerUserId = new mongoose.Types.ObjectId()
  record.agentId = new mongoose.Types.ObjectId()
  record.operation.idempotencyKey = 'different-key'
  record.operation.inputAmountBaseUnits = '1'
  assert.equal(record.ownerUserId.toString(), ownerUserId.toString())
  assert.equal(record.agentId.toString(), agentId.toString())
  assert.equal(record.operation.idempotencyKey, original.operation.idempotencyKey)
  assert.equal(record.operation.inputAmountBaseUnits, '5000000')

  const existingPolicy = PolicyModel.hydrate(new PolicyModel(policy()).toObject())
  existingPolicy.version = 2
  existingPolicy.requiresUserApproval = false
  existingPolicy.allowedSourceAssets = ['other']
  assert.equal(existingPolicy.version, 1)
  assert.equal(existingPolicy.requiresUserApproval, true)
  assert.deepEqual([...existingPolicy.allowedSourceAssets], [source])
})

test('database index declarations protect identity, policy versions and execution retries', () => {
  function index(Model, keys) {
    const found = Model.schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys))
    assert.ok(found, `${Model.modelName} index ${JSON.stringify(keys)} must exist`)
    return found[1]
  }
  assert.equal(index(UserModel, { authIssuer: 1, authSubject: 1 }).unique, true)
  assert.equal(index(WalletModel, { network: 1, address: 1 }).unique, true)
  assert.equal(index(PolicyModel, { agentId: 1, version: 1 }).unique, true)
  assert.deepEqual(index(PolicyModel, { agentId: 1 }).partialFilterExpression, { status: 'ACTIVE' })
  assert.equal(index(GrantModel, { providerGrantId: 1 }).unique, true)
  // The existing analysisId index is unchanged; legacy records need no rewrite.
  assert.equal(index(TransactionModel, { analysisId: 1 }).unique, true)
  for (const path of ['operation.operationId', 'operation.idempotencyKey', 'operation.providerOperationId']) {
    const options = index(TransactionModel, { [path]: 1 })
    assert.equal(options.unique, true)
    assert.deepEqual(options.partialFilterExpression, { [path]: { $type: 'string' } })
  }
  for (const Model of [UserModel, WalletModel, AgentModel, PolicyModel, GrantModel, TransactionModel]) {
    assert.equal(Model.schema.options.timestamps, true)
    assert.equal(Model.schema.options.optimisticConcurrency, true)
    assert.equal(Model.schema.indexes().some(([, options]) => options.expireAfterSeconds != null), false)
  }
})

test('nested edits cannot rewrite a saved policy version or replace an operation identity', async () => {
  const existingPolicy = PolicyModel.hydrate(new PolicyModel(policy()).toObject())
  existingPolicy.spendingLimits[0].dailyLimitBaseUnits = '40000000'
  await assert.rejects(existingPolicy.validate(), /Policy changes require a new versioned record/)

  const changedAllowlist = PolicyModel.hydrate(new PolicyModel(policy()).toObject())
  changedAllowlist.allowedDestinationAssets.push('another-asset')
  await assert.rejects(changedAllowlist.validate(), /Policy changes require a new versioned record/)

  const existingOperation = TransactionModel.hydrate(new TransactionModel(transaction()).toObject())
  existingOperation.operation = operation({ idempotencyKey: 'replacement', inputAmountBaseUnits: '6000000' })
  await assert.rejects(existingOperation.validate(), /immutable|Operation identity and requested amounts cannot change/)

  const quotedOperation = TransactionModel.hydrate(new TransactionModel(transaction()).toObject())
  quotedOperation.operation.quote = quote()
  await quotedOperation.validate()
})
