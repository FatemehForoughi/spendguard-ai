import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import mongoose from 'mongoose'

process.env.NODE_ENV = 'test'
process.env.GRANT_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { WalletModel } = await import('../src/models/wallet.model.ts')
const { AgentModel } = await import('../src/models/agent.model.ts')
const { PolicyModel } = await import('../src/models/policy.model.ts')
const { GrantModel } = await import('../src/models/grant.model.ts')
const { TransactionModel } = await import('../src/models/transaction.model.ts')
const { encryptGrantToken, decryptGrantToken } = await import('../src/services/grant-secret.service.ts')

const ownerUserId = new mongoose.Types.ObjectId()
const agentId = new mongoose.Types.ObjectId()
const walletId = new mongoose.Types.ObjectId()

after(async () => {
  await mongoose.disconnect()
})

test('wallet records require an owner and verified wallets require verification evidence', async () => {
  const missingOwner = new WalletModel({ network: 'near', address: 'alice.near' })
  await assert.rejects(missingOwner.validate(), /ownerUserId/)

  const unproven = new WalletModel({
    ownerUserId, network: 'near', address: 'alice.near', isVerified: true,
  })
  await assert.rejects(unproven.validate(), /verifiedAt|verificationMethod/)

  const verified = new WalletModel({
    ownerUserId, network: 'near', address: 'alice.near', isVerified: true,
    verifiedAt: new Date(), verificationMethod: 'SIGNATURE',
  })
  await assert.doesNotReject(verified.validate())
})

test('agent records require owner and wallet association and reject invalid states', async () => {
  const missingOwner = new AgentModel({ walletId, name: 'Trading agent' })
  await assert.rejects(missingOwner.validate(), /ownerUserId/)

  const invalidStatus = new AgentModel({
    ownerUserId, walletId, name: 'Trading agent', status: 'RUNNING',
  })
  await assert.rejects(invalidStatus.validate(), /status/)

  const valid = new AgentModel({ ownerUserId, walletId, name: 'Trading agent' })
  await assert.doesNotReject(valid.validate())
})

test('policy records enforce owner, positive integer base-unit strings, assets and version', async () => {
  const missingOwner = new PolicyModel({
    agentId, maxAmountPerOperation: '100', dailySpendingLimit: '1000',
    allowedSourceAssets: ['USDC'], allowedDestinationAssets: ['NEAR'],
    requireUserApproval: true,
  })
  await assert.rejects(missingOwner.validate(), /ownerUserId/)

  const invalid = new PolicyModel({
    ownerUserId, agentId, maxAmountPerOperation: '-1', dailySpendingLimit: '1.5',
    allowedSourceAssets: [], allowedDestinationAssets: ['NEAR'],
    requireUserApproval: true, version: 0,
  })
  await assert.rejects(invalid.validate())

  const valid = new PolicyModel({
    ownerUserId, agentId, maxAmountPerOperation: '1000000',
    dailySpendingLimit: '5000000', allowedSourceAssets: ['USDC'],
    allowedDestinationAssets: ['NEAR'], requireUserApproval: true,
  })
  await assert.doesNotReject(valid.validate())
})

test('grant records require an owner, scope and encrypted token fields', async () => {
  const missingOwner = new GrantModel({
    agentId, providerGrantReference: 'grant-1', scopes: ['swap'],
    tokenCiphertext: 'cipher', tokenIv: 'iv', tokenAuthTag: 'tag',
  })
  await assert.rejects(missingOwner.validate(), /ownerUserId/)

  const missingCiphertext = new GrantModel({
    ownerUserId, agentId, providerGrantReference: 'grant-2', scopes: ['swap'],
    tokenIv: 'iv', tokenAuthTag: 'tag',
  })
  await assert.rejects(missingCiphertext.validate(), /tokenCiphertext/)
})

test('grant token encryption uses authenticated encryption and round-trips without storing plaintext', () => {
  const secret = 'test-only-grant-token'
  const encrypted = encryptGrantToken(secret)
  assert.notEqual(encrypted.tokenCiphertext, secret)
  assert.equal(decryptGrantToken(encrypted), secret)
  assert.equal(encrypted.tokenEncryptionVersion, 1)

  const tampered = { ...encrypted, tokenCiphertext: Buffer.from('tampered').toString('base64') }
  assert.throws(() => decryptGrantToken(tampered), { code: 'GRANT_DECRYPTION_FAILED' })
})

test('legacy AI-analysis transactions remain valid while operation records require ownership and exact units', async () => {
  const analysis = new TransactionModel({
    analysisId: 'analysis-test-1', request: 'Review a transfer', status: 'ALLOW',
    score: 10, message: 'Low risk', reasons: [],
  })
  await assert.doesNotReject(analysis.validate())

  const ownerlessOperation = new TransactionModel({
    recordType: 'OPERATION', operationId: 'operation-test-1',
    executionStatus: 'NEEDS_REVIEW',
  })
  await assert.rejects(ownerlessOperation.validate())

  const invalidUnits = new TransactionModel({
    recordType: 'OPERATION', operationId: 'operation-test-2',
    ownerUserId, agentId, idempotencyKey: 'logical-op-0002',
    inputAssetId: 'USDC', outputAssetId: 'NEAR', inputAmountBaseUnits: '1.25',
    executionStatus: 'PENDING',
  })
  await assert.rejects(invalidUnits.validate())

  const operation = new TransactionModel({
    recordType: 'OPERATION', operationId: 'operation-test-3',
    ownerUserId, agentId, idempotencyKey: 'logical-op-0003',
    inputAssetId: 'USDC', outputAssetId: 'NEAR', inputAmountBaseUnits: '1250000',
    executionStatus: 'PENDING',
  })
  await assert.doesNotReject(operation.validate())
})
