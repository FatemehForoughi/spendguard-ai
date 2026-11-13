import { randomUUID } from 'node:crypto'
import { grantCommitment } from '@near-intents-agent-api/sdk'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { AgentModel, PolicyModel, GrantModel, TransactionModel } from '../models/index.js'
import type { AuthContext } from './session.service.js'
import { agentsOnIntentsClient as api } from './agents-on-intents.client.js'
import { analyzeRisk } from './ai.service.js'
import { ownedAgent, policyProjection, prepareProviderVote, tokenCatalog, type AgentDocument } from './agent-workflow.service.js'
import { readGrantToken } from './grant-secret.service.js'
import { decimalToUnits, digest, nonnegativeUnits, parsed, providerPolicy, statusSchema, swapInput, units, type ProviderStatus } from './spend-contracts.js'
import { approvalDigest, enforceSwapSecurity, riskDecision } from './swap-security.service.js'

export type OperationDocument = InstanceType<typeof TransactionModel>
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : undefined
export async function ownedOperation(context: AuthContext, id: string) {
  const row = await TransactionModel.findOne({ ownerUserId: context.user._id, 'operation.operationId': id })
  if (!row?.operation) throw new AppError(404, 'OPERATION_NOT_FOUND', 'That swap could not be found.')
  await ownedAgent(context, String(row.agentId))
  return row
}
export function operationDto(row: OperationDocument) {
  return { id: row.operation!.operationId, agentId: String(row.agentId), request: row.request, operation: row.toObject().operation,
    risk: row.status ? { status: row.status, score: row.score, message: row.message, reasons: row.reasons } : null, createdAt: row.createdAt }
}
export async function currentControls(context: AuthContext, agent: AgentDocument, inputAssetId: string, outputAssetId: string, amount: string, excludeOperationId?: string) {
  const policy = await PolicyModel.findOne({ agentId: agent._id, ownerUserId: context.user._id, status: 'ACTIVE' })
  if (!policy) throw new AppError(409, 'POLICY_REQUIRED', 'An active spending policy is required.')
  const grant = await GrantModel.findOne({ agentId: agent._id, ownerUserId: context.user._id, policyId: policy._id,
    policyVersion: policy.version, status: 'ACTIVE', expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } }).sort({ createdAt: -1 }).select('+tokenSecretRef')
  if (!grant?.tokenSecretRef) throw new AppError(409, 'GRANT_INVALID', 'Authorize this agent under its current policy before continuing.')
  const token = await readGrantToken(grant.tokenSecretRef.key)
  const [view, balances, grants, rows] = await Promise.all([
    api.get(`/v1/agents/${agent.externalAgentId}/policy`),
    api.get(`/v1/agents/${agent.externalAgentId}/balances`, { query: { source: policy.balanceSource } }),
    api.get(`/v1/agents/${agent.externalAgentId}/grants`),
    TransactionModel.find({ ownerUserId: context.user._id, agentId: agent._id, 'operation.inputAssetId': inputAssetId }),
  ])
  const applied = parsed(z.object({ status: z.literal('APPLIED'), provider_policy_synced: z.literal(true), revision: z.number().int(),
    policy_hash: z.string(), policy: z.record(z.string(), z.unknown()) }), view)
  if (applied.revision !== agent.providerRevision || applied.policy_hash !== agent.providerPolicyHash || digest(applied.policy) !== digest(providerPolicy(policyProjection(policy)))) {
    throw new AppError(409, 'POLICY_CHANGED', 'The provider policy has changed or is not ready. Review this agent before continuing.')
  }
  const available = parsed(z.object({ source: z.enum(['public', 'confidential']), balances: z.array(z.object({ asset_id: z.string(), available_raw: nonnegativeUnits })).max(4096) }), balances)
  if (available.source !== policy.balanceSource || new Set(available.balances.map(b => b.asset_id)).size !== available.balances.length) throw new AppError(502, 'BALANCE_INVALID', 'The provider returned an inconsistent balance.')
  const remoteGrants = parsed(z.object({ data: z.array(z.object({ grant_id: z.string(), agent_id: z.string(), expires_at: z.iso.datetime(), revoked_at: z.string().nullable(),
    owner_message: z.object({ credential: z.string(), owner: z.object({ type: z.literal('near'), account_id: z.string(), public_key: z.string() }) }) })) }), grants)
  const remote = remoteGrants.data.find(g => g.grant_id === grant.providerGrantId)
  if (!remote || remote.agent_id !== agent.externalAgentId || remote.revoked_at || Date.parse(remote.expires_at) <= Date.now() ||
    remote.owner_message.credential !== grantCommitment(token) || remote.owner_message.owner.account_id !== context.wallet.address ||
    remote.owner_message.owner.public_key !== context.wallet.verifiedPublicKey) throw new AppError(409, 'GRANT_INVALID', 'The provider authorization is revoked, expired, or belongs to a different owner.')
  const now = Date.now()
  let spent = 0n
  for (const row of rows) {
    const op = row.operation
    if (!op || op.operationId === excludeOperationId || !op.submittedAt || op.neverExecuted === true) continue
    // Pending/unknown work stays reserved indefinitely. Settled money movement
    // remains counted for 24 hours from observation, including partial refunds.
    if (!op.completedAt || op.completedAt.getTime() > now - 86_400_000) spent += BigInt(op.inputAmountBaseUnits)
  }
  enforceSwapSecurity({ ownerId: context.user.id, agentOwnerId: String(agent.ownerUserId), walletVerified: context.wallet.verificationStatus === 'VERIFIED' && !context.wallet.revokedAt,
    agentActive: agent.status === 'ACTIVE', policyId: policy.id, policyVersion: policy.version, policy: policyProjection(policy),
    grant: { ownerId: String(grant.ownerUserId), policyId: String(grant.policyId), policyVersion: grant.policyVersion, status: grant.status,
      expiresAt: grant.expiresAt, revokedAt: grant.revokedAt, sources: [...grant.scope.allowedSourceAssets], destinations: [...grant.scope.allowedDestinationAssets] },
    inputAssetId, outputAssetId, amount, available: available.balances.find(b => b.asset_id === inputAssetId)?.available_raw ?? '0', spent: spent.toString() })
  return { policy, grant, token }
}
export function executionRequest(row: OperationDocument) {
  const op = row.operation!
  if (!op.minimumOutputAmountBaseUnits) throw new AppError(409, 'OUTPUT_LIMIT_REQUIRED', 'Choose a positive minimum output before executing.')
  return { origin_asset: op.inputAssetId, destination_asset: op.outputAssetId, amount: op.inputAmountBaseUnits,
    min_amount_out: op.minimumOutputAmountBaseUnits, confidential: op.balanceSource === 'confidential' }
}
const drySchema = z.object({ dry: z.literal(true), type: z.literal('swap'), quote: z.record(z.string(), z.unknown()),
  owner_approval: z.boolean(), spend: z.object({ amount_usd: z.string().nullable() }), fee: z.object({ amount_usd: z.string(), percent: z.string() }).nullable(),
  warnings: z.array(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/), detail: z.string().max(2000) })).max(32) })
export async function dryQuote(agent: AgentDocument, row: OperationDocument) {
  const result = parsed(drySchema, await api.post(`/v1/agents/${agent.externalAgentId}/swap`, { ...executionRequest(row), dry: true }))
  const receivedAt = new Date()
  const estimated = units.safeParse(result.quote.amount_out)
  const providerExpiry = date(result.quote.expires_at)
  if (providerExpiry && providerExpiry <= receivedAt) throw new AppError(409, 'QUOTE_EXPIRED', 'The provider quote has already expired.')
  if (estimated.success && BigInt(estimated.data) < BigInt(row.operation!.minimumOutputAmountBaseUnits!)) throw new AppError(409, 'MINIMUM_OUTPUT_UNAVAILABLE', 'The quoted output is below your required minimum.')
  const reviewExpiresAt = new Date(Math.min(receivedAt.getTime() + 120_000, providerExpiry?.getTime() ?? Infinity))
  const snapshotDigest = digest({ request: executionRequest(row), output: estimated.success ? estimated.data : null,
    spend: result.spend.amount_usd, fee: result.fee, ownerApproval: result.owner_approval, warnings: result.warnings })
  return { quote: { inputAssetId: row.operation!.inputAssetId, outputAssetId: row.operation!.outputAssetId, inputAmountBaseUnits: row.operation!.inputAmountBaseUnits,
    ...(estimated.success ? { estimatedOutputAmountBaseUnits: estimated.data } : {}), receivedAt, expiresAt: providerExpiry, reviewExpiresAt,
    amountUsd: result.spend.amount_usd ?? undefined, feeUsd: result.fee?.amount_usd, feePercent: result.fee?.percent,
    warnings: result.warnings.map(w => w.code + ': ' + w.detail).map(w => w.slice(0,1000)), fees: [], snapshotDigest },
    blockedWarnings: result.warnings.filter(w => w.code !== 'high_fee' && w.code !== 'asset_delivered_as_is'),
    reviewWarning: result.warnings.length > 0, ownerApproval: result.owner_approval }
}
export async function createSwap(context: AuthContext, input: z.infer<typeof swapInput>) {
  const agent = await ownedAgent(context,input.agentId)
  const tokens = await tokenCatalog()
  const source = tokens.find(t => t.asset_id === input.inputAssetId), destination = tokens.find(t => t.asset_id === input.outputAssetId)
  if (!source || !destination) throw new AppError(400,'UNSUPPORTED_ASSET','Choose assets from the current token catalog.')
  const amount = decimalToUnits(input.amount,source.decimals), minimum = decimalToUnits(input.minimumOutputAmount,destination.decimals)
  const existing = await TransactionModel.findOne({ 'operation.operationId': input.requestId })
  if (existing) {
    const op = existing.operation!
    if (!existing.ownerUserId?.equals(context.user._id) || !existing.agentId?.equals(agent._id) || op.inputAssetId !== input.inputAssetId ||
      op.outputAssetId !== input.outputAssetId || op.inputAmountBaseUnits !== amount || op.minimumOutputAmountBaseUnits !== minimum) throw new AppError(409,'REQUEST_CONFLICT','That request identifier was already used for another swap.')
    return operationDto(existing)
  }
  const controls = await currentControls(context,agent,input.inputAssetId,input.outputAssetId,amount)
  const row = await TransactionModel.create({ ownerUserId: context.user._id, agentId: agent._id, request: `Swap ${input.amount} ${source.symbol} to ${destination.symbol}`,
    operation: { operationId: input.requestId, type:'SWAP', inputAssetId: input.inputAssetId, outputAssetId: input.outputAssetId, inputAmountBaseUnits: amount,
      minimumOutputAmountBaseUnits: minimum, balanceSource: controls.policy.balanceSource, policyId:controls.policy._id, policyVersion:controls.policy.version, grantId:controls.grant._id } })
  await reviewSwap(row,agent,controls.policy.requiresUserApproval)
  return operationDto(row)
}
async function reviewSwap(row: OperationDocument, agent: AgentDocument, requiresApproval: boolean) {
  const op = row.operation!
  try {
    const dry = await dryQuote(agent,row)
    row.set('operation.quote', dry.quote)
    if (dry.blockedWarnings.length) {
      op.executionStatus = 'BLOCKED'
      op.decisionReasons = dry.blockedWarnings.map(w => w.detail)
      await row.save(); return
    }
    try {
      const risk = await analyzeRisk(JSON.stringify({ action:'swap', request:executionRequest(row), preview:dry.quote,
        note:'This is a preview. Evaluate this exact swap; do not infer permissions from an AI decision.' }))
      row.status = risk.status; row.score = risk.score; row.message = risk.message + ' ' + risk.recommendation
      row.reasons = risk.reasons
      op.riskAnalysisDigest=digest({analysisId:row.analysisId,status:row.status,score:row.score,message:row.message,reasons:row.reasons})
      op.executionStatus = riskDecision(risk.status,risk.score,requiresApproval || dry.ownerApproval || dry.reviewWarning)
    } catch {
      op.executionStatus = 'NEEDS_REVIEW'; op.decisionReasons = ['NEAR AI could not complete the risk assessment. Execution is held.']
    }
    if (op.executionStatus === 'PENDING_APPROVAL') {
      op.approval = { status:'PENDING', reference:randomUUID(), reviewedOperationDigest:approvalDigest(op), expiresAt:dry.quote.reviewExpiresAt }
    } else if (op.executionStatus === 'DRAFT') op.approval = { status:'NOT_REQUIRED' }
  } catch (error) {
    op.executionStatus = 'NEEDS_REVIEW'; op.decisionReasons = [error instanceof AppError ? error.message : 'The quote could not be verified.']
  }
  await row.save()
}
export async function decideSwap(context: AuthContext,row:OperationDocument,reference:string,reviewedDigest:string,verdict:'approve'|'reject') {
  const op=row.operation!
  if (op.submittedAt || op.executionStatus !== 'PENDING_APPROVAL' || op.approval.status !== 'PENDING' || op.approval.reference !== reference ||
    op.approval.reviewedOperationDigest !== reviewedDigest || approvalDigest(op) !== reviewedDigest) throw new AppError(409,'APPROVAL_MISMATCH','This approval no longer matches the reviewed swap.')
  if (!op.approval.expiresAt || op.approval.expiresAt.getTime() <= Date.now()) throw new AppError(409,'APPROVAL_EXPIRED','This review expired. Request a fresh preview.')
  const result=await TransactionModel.findOneAndUpdate({ _id:row._id, ownerUserId:context.user._id, __v:row.__v,
    'operation.executionStatus':'PENDING_APPROVAL','operation.approval.status':'PENDING','operation.approval.expiresAt':{$gt:new Date()} },
    {$set:{'operation.approval.status':verdict==='approve'?'APPROVED':'REJECTED','operation.approval.decidedByUserId':context.user._id,
      'operation.approval.decidedAt':new Date(),'operation.executionStatus':verdict==='approve'?'DRAFT':'REJECTED'},$inc:{__v:1}}, {returnDocument:'after'})
  if (!result) throw new AppError(409,'APPROVAL_ALREADY_DECIDED','This review has already been decided.')
  return operationDto(result)
}
export async function refreshSwap(context: AuthContext,row:OperationDocument) {
  const op=row.operation!
  if (op.submittedAt || ['REJECTED','SUCCESS','REFUNDED','FAILED','BLOCKED'].includes(op.executionStatus)) throw new AppError(409,'SWAP_CANNOT_REFRESH','Create a new request after reviewing this result.')
  const agent=await ownedAgent(context,String(row.agentId))
  const controls=await currentControls(context,agent,op.inputAssetId,op.outputAssetId,op.inputAmountBaseUnits,op.operationId)
  if (op.policyVersion!==controls.policy.version || !op.grantId?.equals(controls.grant._id)) throw new AppError(409,'POLICY_CHANGED','Create a new swap under the current policy and grant.')
  row.set('status',undefined); row.set('score',undefined); row.set('message',undefined); row.reasons=[]; op.decisionReasons=[]; op.approval={status:'NOT_REQUESTED'}
  await reviewSwap(row,agent,controls.policy.requiresUserApproval)
  return operationDto(row)
}
export async function executeSwap(context: AuthContext,row:OperationDocument) {
  const op=row.operation!
  if (!env.ENABLE_LIVE_EXECUTION) throw new AppError(409,'LIVE_EXECUTION_DISABLED','Live execution is disabled. Review the preview and enable execution only for controlled validation.')
  if (op.submittedAt) return reconcileSwap(context,row)
  if (op.executionStatus !== 'DRAFT' || !row.status || ['BLOCKED','NEEDS_REVIEW'].includes(riskDecision(row.status,row.score,false))) throw new AppError(409,'SWAP_NOT_APPROVED','This swap is held or has not been approved.')
  if (op.riskAnalysisDigest!==digest({analysisId:row.analysisId,status:row.status,score:row.score,message:row.message,reasons:row.reasons})) throw new AppError(409,'RISK_ANALYSIS_CHANGED','The risk assessment changed after review. Request a fresh preview.')
  if (!op.quote?.reviewExpiresAt || op.quote.reviewExpiresAt.getTime() <= Date.now() || (op.quote.expiresAt && op.quote.expiresAt.getTime() <= Date.now())) throw new AppError(409,'QUOTE_EXPIRED','Request a fresh preview before executing.')
  if (op.approval.status === 'APPROVED') {
    if (!op.approval.decidedByUserId?.equals(context.user._id) || op.approval.reviewedOperationDigest !== approvalDigest(op) ||
      !op.approval.expiresAt || op.approval.expiresAt.getTime() <= Date.now()) throw new AppError(409,'APPROVAL_MISMATCH','The approval does not match this current swap.')
  } else if (op.approval.status !== 'NOT_REQUIRED' || row.status !== 'ALLOW' || (row.score ?? 100) >= 21) throw new AppError(409,'APPROVAL_REQUIRED','Review and approve this exact swap first.')
  const locked=await AgentModel.findOneAndUpdate({_id:row.agentId,ownerUserId:context.user._id,status:'ACTIVE',busyOperationId:{$exists:false},pendingIntentId:{$exists:false}},
    {$set:{busyOperationId:op.operationId}},{returnDocument:'after'})
  if (!locked) throw new AppError(409,'AGENT_BUSY','This agent already has work awaiting settlement. Reconcile it first.')
  let dispatchCommitted=false
  try {
    const controls=await currentControls(context,locked,op.inputAssetId,op.outputAssetId,op.inputAmountBaseUnits,op.operationId)
    if (op.policyVersion!==controls.policy.version || !op.grantId?.equals(controls.grant._id) || controls.policy.balanceSource!==op.balanceSource) throw new AppError(409,'POLICY_CHANGED','The policy or authorization changed after review.')
    if (controls.policy.requiresUserApproval && op.approval.status!=='APPROVED') throw new AppError(409,'APPROVAL_REQUIRED','This policy requires your explicit approval.')
    const quote=await dryQuote(locked,row)
    if (quote.blockedWarnings.length || quote.quote.snapshotDigest!==op.quote.snapshotDigest || (quote.ownerApproval && op.approval.status!=='APPROVED')) throw new AppError(409,'QUOTE_CHANGED','The preview changed. Request and review a fresh preview.')
    // Recheck the local session immediately before committing dispatch.
    const { SessionModel }=await import('../models/session.model.js')
    if (!await SessionModel.exists({_id:context.session._id,ownerUserId:context.user._id,expiresAt:{$gt:new Date()},revokedAt:{$exists:false}})) throw new AppError(401,'AUTH_REQUIRED','Verify your wallet again before executing.')
    const { UserModel, WalletModel }=await import('../models/index.js')
    const stillValid=await Promise.all([
      UserModel.exists({_id:context.user._id,status:'ACTIVE'}),
      WalletModel.exists({_id:context.wallet._id,ownerUserId:context.user._id,verificationStatus:'VERIFIED',revokedAt:{$exists:false}}),
      GrantModel.exists({_id:controls.grant._id,status:'ACTIVE',expiresAt:{$gt:new Date()},revokedAt:{$exists:false}}),
    ])
    if (stillValid.some(value=>!value)) throw new AppError(409,'AUTHORIZATION_CHANGED','Wallet ownership or agent authorization changed before dispatch.')
    if (op.quote.reviewExpiresAt.getTime()<=Date.now() || (op.approval.status==='APPROVED' && (!op.approval.expiresAt || op.approval.expiresAt.getTime()<=Date.now()))) throw new AppError(409,'QUOTE_EXPIRED','The review expired before dispatch. Refresh the preview.')
    const claimed=await TransactionModel.findOneAndUpdate({_id:row._id,ownerUserId:context.user._id,__v:row.__v,'operation.submittedAt':{$exists:false},'operation.executionStatus':'DRAFT'},
      {$set:{'operation.submittedAt':new Date(),'operation.executionStatus':'UNCERTAIN'},$inc:{__v:1}},{returnDocument:'after'})
    if (!claimed) throw new AppError(409,'OPERATION_CHANGED','This swap changed or is already submitted. Refresh it.')
    dispatchCommitted=true
    // Once committed, a crash/lost response retains the lock and reservation.
    try {
      const status=parsed(statusSchema,await api.post(`/v1/agents/${locked.externalAgentId}/swap`,executionRequest(claimed),{idempotencyKey:op.idempotencyKey,grantToken:controls.token}))
      await applySwapStatus(context,claimed,locked,status)
    } catch (error) {
      await TransactionModel.updateOne({_id:row._id,'operation.executionStatus':{$nin:['SUCCESS','FAILED','REFUNDED']}},{$set:{'operation.executionStatus':'UNCERTAIN',
        'operation.providerErrorCode':error instanceof AppError ? error.code : 'INTENTS_UNAVAILABLE'}})
    }
  } finally {
    if (!dispatchCommitted) await AgentModel.updateOne({_id:row.agentId,busyOperationId:op.operationId},{$unset:{busyOperationId:1}})
  }
  return operationDto(await ownedOperation(context,op.operationId))
}
async function applySwapStatus(context:AuthContext,row:OperationDocument,agent:AgentDocument,status:ProviderStatus) {
  const op=row.operation!
  if (!/^op_[A-Za-z0-9_-]{43}$/.test(status.correlation_id) || (op.correlationId && status.correlation_id!==op.correlationId) ||
    status.agent_id!==agent.externalAgentId || status.type!=='swap') throw new AppError(502,'OPERATION_RESPONSE_MISMATCH','The provider returned a different swap.')
  const request=status.details.request
  // Preserve the original correlation even when later response checks fail,
  // so a partially invalid reply still has a reconciliation path.
  await TransactionModel.updateOne({_id:row._id,'operation.correlationId':{$exists:false}},{$set:{'operation.correlationId':status.correlation_id,'operation.providerOperationId':status.correlation_id}})
  if (request!==undefined && digest(request)!==digest(executionRequest(row))) throw new AppError(502,'OPERATION_RESPONSE_MISMATCH','The provider execution does not match the approved request.')
  let state = ['SUCCESS','FAILED','REFUNDED','NEEDS_REVIEW','UNCERTAIN'].includes(status.status) ? status.status : 'PENDING'
  if (status.status==='PENDING_APPROVAL') state='PENDING_APPROVAL'
  const amount=nonnegativeUnits.safeParse(status.details.amount_out)
  if (status.status==='SUCCESS' && (!amount.success || BigInt(amount.data)<BigInt(op.minimumOutputAmountBaseUnits!))) state='NEEDS_REVIEW'
  const terminal=['SUCCESS','FAILED','REFUNDED'].includes(state)
  const update:Record<string,unknown>={'operation.executionStatus':state,'operation.providerStatus':status.status,'operation.correlationId':status.correlation_id,
    'operation.providerOperationId':status.correlation_id,'operation.lastReconciledAt':new Date()}
  if (terminal) update['operation.completedAt']=new Date()
  if (terminal && amount.success) update['operation.actualOutputAmountBaseUnits']=amount.data
  if (state==='FAILED' && (status.details.never_executed===true || status.details.never_submitted===true)) update['operation.neverExecuted']=true
  if (typeof status.details.tx_hash==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(status.details.tx_hash)) update['operation.transactionHash']=status.details.tx_hash
  if (typeof status.details.approval_id==='string' && z.uuid().safeParse(status.details.approval_id).success) update['operation.providerApprovalId']=status.details.approval_id
  if (status.failure_code && /^[a-z][a-z0-9_]{0,63}$/.test(status.failure_code)) update['operation.providerErrorCode']=status.failure_code.toUpperCase()
  await TransactionModel.updateOne({_id:row._id,ownerUserId:context.user._id,'operation.executionStatus':{$nin:['SUCCESS','FAILED','REFUNDED']}},{$set:update})
  if (terminal) await AgentModel.updateOne({_id:agent._id,busyOperationId:op.operationId},{$unset:{busyOperationId:1}})
}
export async function reconcileSwap(context:AuthContext,row:OperationDocument,refresh=false) {
  const op=row.operation!
  if (!op.submittedAt || ['SUCCESS','FAILED','REFUNDED'].includes(op.executionStatus) || (op.executionStatus==='NEEDS_REVIEW' && !refresh)) return operationDto(row)
  if (!op.correlationId) return operationDto(row) // unknown dispatch: no blind replay
  const agent=await ownedAgent(context,String(row.agentId))
  const status=parsed(statusSchema,await api.get('/v1/status',{query:{correlation_id:op.correlationId,wait_ms:0,refresh}}))
  await applySwapStatus(context,row,agent,status)
  return operationDto(await ownedOperation(context,op.operationId))
}
export async function providerApproval(context:AuthContext,row:OperationDocument,verdict:'approve'|'reject') {
  const op=row.operation!
  if (!op.submittedAt || op.executionStatus!=='PENDING_APPROVAL' || !op.providerApprovalId || !op.correlationId) throw new AppError(409,'PROVIDER_APPROVAL_NOT_READY','This swap is not waiting for a provider approval.')
  const agent=await ownedAgent(context,String(row.agentId))
  if (verdict==='approve') {
    const controls=await currentControls(context,agent,op.inputAssetId,op.outputAssetId,op.inputAmountBaseUnits,op.operationId)
    if (controls.policy.version!==op.policyVersion || !op.grantId?.equals(controls.grant._id)) throw new AppError(409,'POLICY_CHANGED','Reject the held swap; its authorization changed.')
  }
  const approval=parsed(z.object({approval_id:z.uuid(),status:z.string(),request_type:z.string(),request_data:z.record(z.string(),z.unknown()),expires_at:z.string()}),
    await api.get(`/v1/agents/${agent.externalAgentId}/approvals/${op.providerApprovalId}`))
  if (approval.approval_id!==op.providerApprovalId || approval.request_type!=='swap' || digest(approval.request_data)!==digest(executionRequest(row)) ||
    Date.parse(approval.expires_at)<=Date.now()) throw new AppError(409,'PROVIDER_APPROVAL_MISMATCH','The provider approval differs from the reviewed swap or has expired.')
  return prepareProviderVote(context,agent,op.operationId,op.providerApprovalId,verdict)
}
