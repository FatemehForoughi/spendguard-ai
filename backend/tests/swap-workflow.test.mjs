import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, beforeEach, mock, test } from 'node:test'
import { KeyPair } from '@near-js/crypto'
import { grantCommitment } from '@near-intents-agent-api/sdk'
import { memoryDatabase } from './helpers/memory-db.mjs'

process.env.NODE_ENV='test'
process.env.AGENTS_ON_INTENTS_PARTNER_API_KEY='synthetic-partner'
process.env.GRANT_ENCRYPTION_KEY='23'.repeat(32)
process.env.ENABLE_LIVE_EXECUTION='true'
process.env.NEAR_AI_API_KEY='synthetic-ai'
process.env.NEAR_AI_MODEL='test-model'
process.env.NEAR_AI_BASE_URL='https://ai.example.test/v1'
const models=await import('../src/models/index.ts')
const {OwnerIntentModel}=await import('../src/models/owner-intent.model.ts')
const {SecretModel}=await import('../src/models/secret.model.ts')
const {SessionModel}=await import('../src/models/session.model.ts')
const {storeGrantToken}=await import('../src/services/grant-secret.service.ts')
const {providerPolicy,decimalToUnits}=await import('../src/services/spend-contracts.ts')
const {enforceSwapSecurity,riskDecision,approvalDigest}=await import('../src/services/swap-security.service.ts')
const {hashToken}=await import('../src/services/session.service.ts')
const {createSwap,decideSwap,executeSwap,ownedOperation,reconcileSwap,refreshSwap}=await import('../src/services/swap-workflow.service.ts')
const {AgentModel,PolicyModel,GrantModel,UserModel,WalletModel,TransactionModel}=models
let db,context,agent,policy,grant,provider,calls,risk,available,remoteRevoked,quoteOutput,liveStatus,token
let server,baseUrl
const originalFetch=globalThis.fetch
const externalId='a'.repeat(64),correlation='op_'+'X'.repeat(43)
const p={allowedSourceAssets:['usdc'],allowedDestinationAssets:['near'],spendingLimits:[{assetId:'usdc',maxPerOperationBaseUnits:'10000000',dailyLimitBaseUnits:'30000000'}],requiresUserApproval:true,balanceSource:'public'}
before(async()=>{
  db=memoryDatabase([AgentModel,PolicyModel,GrantModel,UserModel,WalletModel,TransactionModel,OwnerIntentModel,SecretModel,SessionModel])
  mock.method(globalThis,'fetch',async(url,opts={})=>{if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,opts);calls.push({url:String(url),...opts});return provider(String(url),opts)})
  const {default:app}=await import('../src/app.ts')
  server=createServer(app)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  baseUrl=`http://127.0.0.1:${server.address().port}`
})
beforeEach(async()=>{
  db.clear();calls=[];available='100000000';remoteRevoked=null;quoteOutput='2000000000000000000000000';liveStatus='SUCCESS';token='ngt_'+'T'.repeat(43)
  const key=KeyPair.fromRandom('ed25519')
  const user=await UserModel.create({authIssuer:'near:mainnet',authSubject:'alice.near'})
  const wallet=await WalletModel.create({ownerUserId:user._id,address:'alice.near',network:'near:mainnet',verificationStatus:'VERIFIED',verifiedPublicKey:key.getPublicKey().toString(),verifiedAt:new Date(),verificationMethod:'NEP413',verificationReference:randomUUID()})
  const session=await SessionModel.create({ownerUserId:user._id,walletId:wallet._id,tokenHash:hashToken('A'.repeat(43)),expiresAt:new Date(Date.now()+3600000)})
  context={user,wallet,session}
  agent=await AgentModel.create({ownerUserId:user._id,walletId:wallet._id,name:'Agent',externalAgentId:externalId,operationType:'SWAP',status:'ACTIVE',providerRevision:1,providerPolicyHash:'b'.repeat(64)})
  policy=await PolicyModel.create({ownerUserId:user._id,agentId:agent._id,version:1,status:'ACTIVE',...p})
  const locator=await storeGrantToken(token)
  grant=await GrantModel.create({ownerUserId:user._id,agentId:agent._id,providerGrantId:'c'.repeat(64),policyId:policy._id,policyVersion:1,status:'ACTIVE',expiresAt:new Date(Date.now()+86400000),tokenSecretRef:{store:'mongodb-aes-gcm',key:locator},scope:{operationType:'SWAP',allowedSourceAssets:['usdc'],allowedDestinationAssets:['near']}})
  risk={status:'ALLOW',score:5,message:'No unusual risks',reasons:[],recommendation:'Review the details',details:{amount:'5',asset:'USDC',sourceNetwork:'NEAR',destinationNetwork:'NEAR',recipient:'agent.near'}}
  provider=async(url,opts)=>{
    if(url.includes('ai.example.test'))return Response.json({id:'test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(risk)}}]})
    if(url.endsWith('/tokens'))return Response.json({data:[{asset_id:'usdc',symbol:'USDC',decimals:6,blockchain:'near'},{asset_id:'near',symbol:'NEAR',decimals:24,blockchain:'near'}]})
    if(url.endsWith('/policy'))return Response.json({status:'APPLIED',provider_policy_synced:true,revision:1,policy_hash:'b'.repeat(64),policy:providerPolicy(p)})
    if(url.includes('/balances'))return Response.json({source:'public',balances:[{asset_id:'usdc',available_raw:available}]})
    if(url.endsWith('/grants'))return Response.json({data:[{grant_id:grant.providerGrantId,agent_id:externalId,expires_at:grant.expiresAt.toISOString(),revoked_at:remoteRevoked,owner_message:{credential:grantCommitment(token),owner:{type:'near',account_id:wallet.address,public_key:wallet.verifiedPublicKey}}}]})
    if(url.endsWith('/swap')){
      const body=JSON.parse(opts.body)
      if(body.dry)return Response.json({dry:true,type:'swap',quote:{amount_out:quoteOutput},spend:{amount_usd:'5'},fee:{amount_usd:'0.01',percent:'0.2'},owner_approval:true,warnings:[]})
      return Response.json(statusResponse(body))
    }
    if(url.includes('/v1/status?')){
      const row=db.stores.get(TransactionModel).find(r=>r.operation.correlationId===correlation)
      return Response.json(statusResponse({origin_asset:row.operation.inputAssetId,destination_asset:row.operation.outputAssetId,amount:row.operation.inputAmountBaseUnits,min_amount_out:row.operation.minimumOutputAmountBaseUnits,confidential:false}))
    }
    throw new Error('Unexpected external call '+url)
  }
})
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));mock.restoreAll()})
function statusResponse(request){return {correlation_id:correlation,agent_id:externalId,type:'swap',status:liveStatus,failure_code:null,details:{action:'swap',request,amount_out:quoteOutput,tx_hash:'confirmedhash'}}}
const request=(overrides={})=>({requestId:randomUUID(),agentId:agent.id,inputAssetId:'usdc',outputAssetId:'near',amount:'5',minimumOutputAmount:'1',...overrides})
async function reviewed(){const dto=await createSwap(context,request());const row=await ownedOperation(context,dto.id);await decideSwap(context,row,row.operation.approval.reference,row.operation.approval.reviewedOperationDigest,'approve');return ownedOperation(context,dto.id)}
test('Phase 6: exact conversions support amounts above JS safe integer range and reject fractional atomic units',()=>{
  assert.equal(decimalToUnits('12345678901234567890.123456',6),'12345678901234567890123456')
  assert.equal(decimalToUnits('0.000000000000000000000001',24),'1')
  for(const v of ['0','-1','1e6','NaN','0.0000001'])assert.throws(()=>decimalToUnits(v,6))
})
test('Phase 6: dry preview checks balances and grants; never sends grant token or idempotency header',async()=>{
  const dto=await createSwap(context,request())
  assert.equal(dto.operation.executionStatus,'PENDING_APPROVAL')
  const dry=calls.find(c=>c.url.endsWith('/swap'))
  assert.equal(JSON.parse(dry.body).dry,true)
  assert.equal(dry.headers.get('X-Grant-Token'),null)
  assert.equal(dry.headers.get('Idempotency-Key'),null)
  assert.doesNotMatch(JSON.stringify(dto),/ngt_|ciphertext|tokenSecretRef/)
})
test('Phase 6: insufficient balance is rejected before requesting a quote',async()=>{
  available='4999999'
  await assert.rejects(createSwap(context,request()),{code:'INSUFFICIENT_BALANCE'})
  assert.equal(calls.filter(c=>c.url.endsWith('/swap')).length,0)
})
test('Phase 6: per-swap and asset limits cannot be bypassed',async()=>{
  await assert.rejects(createSwap(context,request({amount:'11'})),{code:'OPERATION_LIMIT_EXCEEDED'})
  await assert.rejects(createSwap(context,request({inputAssetId:'near',outputAssetId:'usdc',amount:'1'})),{code:'ASSET_NOT_ALLOWED'})
})
test('Phase 6: revoked remote grant is rejected before a quote',async()=>{
  remoteRevoked=new Date().toISOString()
  await assert.rejects(createSwap(context,request()),{code:'GRANT_INVALID'})
})
test('Phase 7: BLOCK, WARN and invalid AI output fail safely',async()=>{
  risk.status='BLOCK';risk.score=90
  assert.equal((await createSwap(context,request())).operation.executionStatus,'BLOCKED')
  risk.status='WARN';risk.score=40
  assert.equal((await createSwap(context,request())).operation.executionStatus,'PENDING_APPROVAL')
  risk={invalid:true}
  assert.equal((await createSwap(context,request())).operation.executionStatus,'NEEDS_REVIEW')
})
test('Phase 8: ALLOW cannot override ownership, scope, grant, spending or balance failures',()=>{
  const c={ownerId:'owner',agentOwnerId:'owner',walletVerified:true,agentActive:true,policyId:'policy',policyVersion:1,policy:p,
    grant:{ownerId:'owner',policyId:'policy',policyVersion:1,status:'ACTIVE',expiresAt:new Date(Date.now()+60000),sources:['usdc'],destinations:['near']},inputAssetId:'usdc',outputAssetId:'near',amount:'5000000',available:'5000000',spent:'0'}
  enforceSwapSecurity(c)
  for(const change of [{walletVerified:false},{agentOwnerId:'foreign'},{agentActive:false},{spent:'26000000'},{available:'4999999'},
    {grant:{...c.grant,status:'REVOKED'}},{grant:{...c.grant,expiresAt:new Date(0)}},{grant:{...c.grant,policyVersion:2}},{grant:{...c.grant,sources:['near']}}])assert.throws(()=>enforceSwapSecurity({...c,...change}))
  assert.equal(riskDecision(undefined,undefined,false),'NEEDS_REVIEW')
  assert.equal(riskDecision('ALLOW',90,false),'BLOCKED')
})
test('Phase 9: altered amount, minimum, pair, policy, or grant changes the approval digest',async()=>{
  const row=await reviewed(),op=row.operation
  for(const change of [{inputAmountBaseUnits:'6000000'},{minimumOutputAmountBaseUnits:'2'},{outputAssetId:'other'},{policyVersion:2},{grantId:'different'}])assert.notEqual(approvalDigest({...op.toObject(),...change}),approvalDigest(op))
})
test('Phase 9: stale reviews and replayed decisions are rejected',async()=>{
  const dto=await createSwap(context,request()),row=await ownedOperation(context,dto.id),approval=row.operation.approval
  await decideSwap(context,row,approval.reference,approval.reviewedOperationDigest,'reject')
  await assert.rejects(decideSwap(context,row,approval.reference,approval.reviewedOperationDigest,'approve'),{code:'APPROVAL_ALREADY_DECIDED'})
  const next=await createSwap(context,request()),expired=await ownedOperation(context,next.id)
  expired.operation.approval.expiresAt=new Date(0)
  await assert.rejects(decideSwap(context,expired,expired.operation.approval.reference,expired.operation.approval.reviewedOperationDigest,'approve'),{code:'APPROVAL_EXPIRED'})
})
test('Phase 10: reviewed request executes once with stable key and backend-only token',async()=>{
  const row=await reviewed(),key=row.operation.idempotencyKey
  const done=await executeSwap(context,row)
  assert.equal(done.operation.executionStatus,'SUCCESS')
  assert.equal(done.operation.actualOutputAmountBaseUnits,quoteOutput)
  await executeSwap(context,await ownedOperation(context,done.id))
  const live=calls.filter(c=>c.url.endsWith('/swap')&&!JSON.parse(c.body).dry)
  assert.equal(live.length,1);assert.equal(live[0].headers.get('Idempotency-Key'),key);assert.equal(live[0].headers.get('X-Grant-Token'),token)
  assert.equal((await AgentModel.findById(agent._id)).busyOperationId,undefined)
})
test('Phase 10: concurrent execute calls send at most one provider mutation',async()=>{
  const row=await reviewed()
  const results=await Promise.allSettled([executeSwap(context,row),executeSwap(context,await ownedOperation(context,row.operation.operationId))])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(calls.filter(c=>c.url.endsWith('/swap')&&!JSON.parse(c.body).dry).length,1)
})
test('Phase 10: changed quote and revoked session prevent dispatch',async()=>{
  const row=await reviewed()
  quoteOutput='2100000000000000000000000'
  await assert.rejects(executeSwap(context,row),{code:'QUOTE_CHANGED'})
  quoteOutput='2000000000000000000000000'
  await SessionModel.updateOne({_id:context.session._id},{$set:{revokedAt:new Date()}})
  await assert.rejects(executeSwap(context,row),{code:'AUTH_REQUIRED'})
  assert.equal(calls.filter(c=>c.url.endsWith('/swap')&&!JSON.parse(c.body).dry).length,0)
})
test('Phase 10: lost dispatch response retains lock and stable identity without blind replay',async()=>{
  const row=await reviewed(),base=provider
  provider=(url,opts)=>url.endsWith('/swap')&&!JSON.parse(opts.body).dry?Promise.reject(new Error('network interrupted')):base(url,opts)
  const dto=await executeSwap(context,row)
  assert.equal(dto.operation.executionStatus,'UNCERTAIN')
  assert.ok((await AgentModel.findById(agent._id)).busyOperationId)
  await executeSwap(context,await ownedOperation(context,dto.id))
  assert.equal(calls.filter(c=>c.url.endsWith('/swap')&&!JSON.parse(c.body).dry).length,1)
})
test('Phase 11: uncertain original operation reconciles to refund, never resubmits',async()=>{
  liveStatus='UNCERTAIN'
  const dto=await executeSwap(context,await reviewed())
  assert.equal(dto.operation.executionStatus,'UNCERTAIN')
  liveStatus='REFUNDED'
  assert.equal((await reconcileSwap(context,await ownedOperation(context,dto.id))).operation.executionStatus,'REFUNDED')
  assert.equal(calls.filter(c=>c.url.endsWith('/swap')&&!JSON.parse(c.body).dry).length,1)
})
test('Phase 11: provider NEEDS_REVIEW stops routine polling and preserves reservation',async()=>{
  liveStatus='NEEDS_REVIEW'
  const dto=await executeSwap(context,await reviewed()),count=calls.length
  await reconcileSwap(context,await ownedOperation(context,dto.id))
  assert.equal(calls.length,count)
  assert.ok((await AgentModel.findById(agent._id)).busyOperationId)
})
test('Phase 12: another owner cannot access or approve an operation',async()=>{
  const dto=await createSwap(context,request())
  const foreign={...context,user:new UserModel({authIssuer:'near:mainnet',authSubject:'bob.near'})}
  await assert.rejects(ownedOperation(foreign,dto.id),{code:'OPERATION_NOT_FOUND'})
})
test('Phase 12: settled usage is counted exactly across quotes for the rolling daily limit',async()=>{
  for(let i=0;i<3;i++){
    const dto=await createSwap(context,request({amount:'10'})),row=await ownedOperation(context,dto.id)
    await decideSwap(context,row,row.operation.approval.reference,row.operation.approval.reviewedOperationDigest,'approve')
    // Give each external execution a unique identity, as the real provider does.
    const base=provider, cid='op_'+String(i).repeat(43)
    provider=async(url,opts)=>{const result=await base(url,opts);if(url.endsWith('/swap')&&!JSON.parse(opts.body).dry){const data=await result.json();data.correlation_id=cid;return Response.json(data)}return result}
    await executeSwap(context,await ownedOperation(context,dto.id));provider=base
  }
  await assert.rejects(createSwap(context,request({amount:'0.000001'})),{code:'DAILY_LIMIT_EXCEEDED'})
})
async function browserRequest(path,body,overrides={}) {
  const response=await fetch(baseUrl+'/api/workspace/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'http://localhost:5173',cookie:'sg_session='+'A'.repeat(43),'content-type':'application/json',...overrides},body:body===undefined?undefined:JSON.stringify(body)})
  return {status:response.status,body:await response.json()}
}
test('Phase 12: HTTP workspace restores owner scope, exact decimal input, approval, and execution',async()=>{
  const created=await browserRequest('operations',request())
  assert.equal(created.status,201)
  const row=created.body.data
  const approved=await browserRequest(`operations/${row.id}/decision`,{reference:row.operation.approval.reference,digest:row.operation.approval.reviewedOperationDigest,verdict:'approve'})
  assert.equal(approved.status,200)
  const executed=await browserRequest(`operations/${row.id}/execute`,{})
  assert.equal(executed.body.data.operation.executionStatus,'SUCCESS')
  const history=await browserRequest('operations')
  assert.equal(history.body.pagination.total,1)
  assert.equal(history.body.data[0].id,row.id)
  const summary=await browserRequest('summary')
  assert.equal(summary.body.data.success,1)
})
test('Phase 12: HTTP routes reject missing session and hostile origins without provider dispatch',async()=>{
  assert.equal((await browserRequest('agents',undefined,{cookie:''})).status,401)
  assert.equal((await browserRequest('operations',request(),{origin:'https://untrusted.example'})).status,403)
  assert.equal(calls.length,0)
})
test('Phase 12: signed-out or foreign records never leak through HTTP details and history',async()=>{
  const row=await reviewed()
  db.stores.get(TransactionModel)[0].ownerUserId=new UserModel({authIssuer:'near:mainnet',authSubject:'bob.near'})._id
  assert.equal((await browserRequest(`operations/${row.operation.operationId}`)).status,404)
  assert.equal((await browserRequest('operations')).body.data.length,0)
})
test('Phase 12: pending provider status without optional request details still preserves its correlation',async()=>{
  const base=provider
  provider=async(url,opts)=>{const response=await base(url,opts);if(url.endsWith('/swap')&&!JSON.parse(opts.body).dry){const data=await response.json();data.status='QUEUED';data.details={action:'swap'};return Response.json(data)}return response}
  const dto=await executeSwap(context,await reviewed())
  assert.equal(dto.operation.executionStatus,'PENDING')
  assert.equal(dto.operation.correlationId,correlation)
})
test('Phase 12: below-minimum provider success is held for review, not counted as completed',async()=>{
  const base=provider
  provider=async(url,opts)=>{const response=await base(url,opts);if(url.endsWith('/swap')&&!JSON.parse(opts.body).dry){const data=await response.json();data.details.amount_out='1';return Response.json(data)}return response}
  const dto=await executeSwap(context,await reviewed())
  assert.equal(dto.operation.executionStatus,'NEEDS_REVIEW')
  assert.ok((await AgentModel.findById(agent._id)).busyOperationId)
})
