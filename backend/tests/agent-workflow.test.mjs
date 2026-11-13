import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { before, beforeEach, after, mock, test } from 'node:test'
import { KeyPair } from '@near-js/crypto'
import mongoose from 'mongoose'
import { memoryDatabase } from './helpers/memory-db.mjs'

process.env.NODE_ENV = 'test'
process.env.AGENTS_ON_INTENTS_PARTNER_API_KEY = 'synthetic-partner-key'
process.env.NEAR_RPC_URL = 'https://rpc.example.test'
process.env.GRANT_ENCRYPTION_KEY = '12'.repeat(32)
const { AgentModel, PolicyModel, GrantModel, UserModel, WalletModel, TransactionModel } = await import('../src/models/index.ts')
const { OwnerIntentModel } = await import('../src/models/owner-intent.model.ts')
const { SecretModel } = await import('../src/models/secret.model.ts')
const { createAgent, ownedAgent, ownedIntent, submitIntent, cancelIntent, updatePolicy, issueGrant, revokeGrant, retrySubmission } = await import('../src/services/agent-workflow.service.ts')
const { nep413Hash } = await import('../src/services/near-wallet-verifier.ts')
const { encryptSecret, decryptSecret } = await import('../src/services/grant-secret.service.ts')
let db, context, key, provider, calls, appliedPolicy
const externalId = 'a'.repeat(64)
const policy = { allowedSourceAssets: ['usdc'], allowedDestinationAssets: ['near'], spendingLimits: [{ assetId: 'usdc', maxPerOperationBaseUnits: '10000000', dailyLimitBaseUnits: '30000000' }], requiresUserApproval: true, balanceSource: 'public' }
before(() => {
  db = memoryDatabase([AgentModel, PolicyModel, GrantModel, UserModel, WalletModel, TransactionModel, OwnerIntentModel, SecretModel])
  mock.method(globalThis, 'fetch', async (url, options = {}) => { calls.push({ url: String(url), ...options }); return provider(String(url), options) })
})
beforeEach(() => {
  db.clear(); calls = []; appliedPolicy = undefined
  key = KeyPair.fromRandom('ed25519')
  const user = new UserModel({ authIssuer: 'near:mainnet', authSubject: 'alice.near' })
  const wallet = new WalletModel({ ownerUserId: user._id, address: 'alice.near', network: 'near:mainnet', verifiedPublicKey: key.getPublicKey().toString(), verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationMethod: 'NEP413', verificationReference: randomUUID() })
  context = { user, wallet, session: { _id: new mongoose.Types.ObjectId() } }
  provider = async (url, options) => {
    if (url === process.env.NEAR_RPC_URL) return Response.json({ jsonrpc: '2.0', id: 'spendguard-wallet-key', result: { permission: 'FullAccess', block_height: 1, block_hash: 'final' } })
    if (url.endsWith('/v1/tokens')) return Response.json({ data: [{ asset_id: 'usdc', symbol: 'USDC', decimals: 6, blockchain: 'near' }, { asset_id: 'near', symbol: 'NEAR', decimals: 24, blockchain: 'near' }] })
    if (url.endsWith('/v1/generate-intent')) {
      const body = JSON.parse(options.body)
      appliedPolicy = body.policy ?? appliedPolicy
      return Response.json({ type: body.type, agent_id: externalId, correlation_id: 'intent_' + 'A'.repeat(43), status: 'PENDING_SIGNATURE', expires_at: new Date(Date.now() + 300000).toISOString(),
        signer: { type: 'near', account_id: context.wallet.address, public_key: key.getPublicKey().toString() }, intent: { standard: 'nep413', payload: { message: JSON.stringify(body), recipient: 'intents.near', nonce: randomBytes(32).toString('base64') } }, preview: { summary: 'Review the policy', ...(body.policy ? { policy: body.policy } : {}) } })
    }
    if (url.endsWith('/v1/submit-intent')) return Response.json({ correlation_id: 'intent_' + 'A'.repeat(43), agent_id: externalId, type: JSON.parse(options.body).type, status: 'SUCCESS', failure_code: null, details: {} })
    if (url.endsWith('/policy')) return Response.json({ status: 'APPLIED', provider_policy_synced: true, revision: 1, policy_hash: 'b'.repeat(64), policy: appliedPolicy })
    throw new Error('Unexpected external request: ' + url)
  }
})
after(() => mock.restoreAll())
const create = () => createAgent(context, { name: 'Trading agent', requestId: randomUUID(), policy })
function proof(intent) {
  const payload = intent.generated.intent.payload
  return { payload, publicKey: key.getPublicKey().toString(), signature: Buffer.from(key.sign(nep413Hash(payload)).signature).toString('base64') }
}
test('Phase 4: creation stores a pending agent and unchanged owner policy, activates only after settlement', async () => {
  const result = await create()
  assert.equal(result.agent.status, 'PENDING')
  const intent = await ownedIntent(context, result.intent.id)
  assert.deepEqual(intent.generated.preview.policy.assets, ['usdc'])
  assert.deepEqual(intent.generated.preview.policy.actions, ['swap'])
  assert.deepEqual(intent.generated.preview.policy.destinations, { mode: 'only', list: [] })
  const settled = await submitIntent(context, intent, proof(intent))
  assert.equal(settled.status, 'SUCCESS')
  assert.equal((await ownedAgent(context, result.agent.id)).status, 'ACTIVE')
  assert.equal((await PolicyModel.findOne({ agentId: result.agent.id })).status, 'ACTIVE')
})
test('Phase 4: missing provider leaves recoverable pending state without active agent', async () => {
  const base = provider
  provider = (url, opts) => url.endsWith('/generate-intent') ? Promise.reject(new Error('secret raw transport')) : base(url,opts)
  const result = await create()
  assert.equal(result.intent.status, 'UNCERTAIN')
  assert.equal((await ownedAgent(context,result.agent.id)).status, 'PENDING')
  assert.ok((await ownedIntent(context,result.intent.id)).idempotencyKey)
  assert.doesNotMatch(JSON.stringify(result), /secret raw transport/)
})
test('Phase 4: another wallet or owner cannot access agent or authorization', async () => {
  const result = await create()
  const foreign = { ...context, user: new UserModel({ authIssuer: 'near:mainnet', authSubject: 'bob.near' }) }
  await assert.rejects(ownedAgent(foreign,result.agent.id), { code: 'AGENT_NOT_FOUND' })
  await assert.rejects(ownedIntent(foreign,result.intent.id), { code: 'INTENT_NOT_FOUND' })
})
test('Phase 4: retries reuse creation identity, reject different request body', async () => {
  const request = { name: 'Agent', requestId: randomUUID(), policy }
  const first = await createAgent(context,request)
  const second = await createAgent(context,request)
  assert.equal(first.agent.id,second.agent.id)
  assert.equal(calls.filter(c => c.url.endsWith('/generate-intent')).length,1)
  await assert.rejects(createAgent(context,{...request,name:'Changed'}),{code:'REQUEST_CONFLICT'})
})
test('Phase 4: payload changes and another signing key are rejected before submission', async () => {
  const { intent: dto } = await create()
  const intent = await ownedIntent(context,dto.id)
  const valid = proof(intent)
  await assert.rejects(submitIntent(context,intent,{...valid,payload:{...valid.payload,message:'Altered'}}),{code:'INVALID_OWNER_SIGNATURE'})
  await assert.rejects(submitIntent(context,intent,{...valid,publicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString()}),{code:'INVALID_OWNER_SIGNATURE'})
  assert.equal(calls.filter(c => c.url.endsWith('/submit-intent')).length,0)
})
test('Phase 4: cancellation cannot race a submitted intent and clear its guard', async () => {
  const { intent: dto } = await create()
  const stale = await ownedIntent(context,dto.id)
  await OwnerIntentModel.updateOne({_id:stale._id},{$set:{status:'SUBMITTING'}})
  await assert.rejects(cancelIntent(stale),{code:'INTENT_CANNOT_CANCEL'})
  assert.equal((await ownedAgent(context,dto.agentId)).pendingIntentId,dto.id)
})
test('Phase 5: grant tokens are encrypted with authenticated record identity', () => {
  const token = 'ngt_' + randomBytes(32).toString('base64url')
  const record = {locator:randomUUID()}
  Object.assign(record,encryptSecret(token,record.locator))
  assert.equal(decryptSecret(record),token)
  assert.doesNotMatch(JSON.stringify(record),new RegExp(token))
  assert.throws(() => decryptSecret({...record,locator:randomUUID()}),{code:'GRANT_STORAGE_UNAVAILABLE'})
})
test('Phase 5: policy revisions remain draft until signed; pending work fences a second update', async () => {
  const result = await create()
  const intent = await ownedIntent(context,result.intent.id)
  await submitIntent(context,intent,proof(intent))
  const agent = await ownedAgent(context,result.agent.id)
  const revised = await updatePolicy(context,agent,{...policy,requiresUserApproval:false})
  assert.equal(revised.status,'PENDING_SIGNATURE')
  assert.equal((await PolicyModel.findOne({agentId:agent._id,version:2})).status,'DRAFT')
  await assert.rejects(issueGrant(context,await ownedAgent(context,agent.id),'assistant',new Date(Date.now()+86400000).toISOString()),{code:'AGENT_BUSY'})
})
test('Phase 5: issued grant confirms owner commitment and stores no plaintext credential',async()=>{
  const result=await create(),creation=await ownedIntent(context,result.intent.id)
  await submitIntent(context,creation,proof(creation))
  const expiry=new Date(Date.now()+86400000).toISOString()
  const dto=await issueGrant(context,await ownedAgent(context,result.agent.id),'assistant',expiry),intent=await ownedIntent(context,dto.id)
  const base=provider
  provider=async(url,opts)=>{
    if(url.endsWith('/submit-intent'))return Response.json({type:'grant_issue',agent_id:externalId,correlation_id:intent.correlationId,status:'SUCCESS',failure_code:null,
      details:{grant:{grant_id:'c'.repeat(64),agent_id:externalId,expires_at:expiry,revoked_at:null,owner_message:{credential:intent.request.credential,owner:{type:'near',account_id:context.wallet.address,public_key:key.getPublicKey().toString()}}}}})
    return base(url,opts)
  }
  assert.equal((await submitIntent(context,intent,proof(intent))).status,'SUCCESS')
  const grant=await GrantModel.findOne({agentId:result.agent.id}).select('+tokenSecretRef')
  assert.equal(grant.status,'ACTIVE')
  assert.doesNotMatch(JSON.stringify(grant),/ngt_|tokenSecretRef/)
  const secret=await SecretModel.findOne({locator:grant.tokenSecretRef.key}).select('+ciphertext')
  assert.ok(secret.ciphertext);assert.doesNotMatch(secret.ciphertext,/ngt_/)
  const revocation=await revokeGrant(context,await ownedAgent(context,result.agent.id),grant.id)
  assert.equal(revocation.type,'grant_revoke')
  assert.equal((await GrantModel.findById(grant._id)).status,'REVOKED')
})
test('Phase 5: expired grant is rejected before preparing authorization',async()=>{
  const result=await create(),creation=await ownedIntent(context,result.intent.id)
  await submitIntent(context,creation,proof(creation))
  await assert.rejects(issueGrant(context,await ownedAgent(context,result.agent.id),'assistant',new Date(0).toISOString()),{code:'INVALID_GRANT_EXPIRY'})
})
test('Phase 10: lost owner submission reconciles first and recovery uses the identical stored signature',async()=>{
  const result=await create(),intent=await ownedIntent(context,result.intent.id),signed=proof(intent),base=provider
  let submissions=0
  provider=async(url,opts)=>{
    if(url.endsWith('/submit-intent')){submissions++;if(submissions===1)throw new Error('lost reply');return base(url,opts)}
    if(url.includes('/v1/status?'))return Response.json({type:'agent_create',agent_id:externalId,correlation_id:intent.correlationId,status:'PENDING_SIGNATURE',failure_code:null,details:{}})
    return base(url,opts)
  }
  assert.equal((await submitIntent(context,intent,signed)).status,'UNCERTAIN')
  assert.equal((await retrySubmission(context,await ownedIntent(context,intent.id))).status,'SUCCESS')
  const requests=calls.filter(c=>c.url.endsWith('/submit-intent'))
  assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body)
})
