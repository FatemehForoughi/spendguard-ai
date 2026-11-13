import { randomUUID } from 'node:crypto'
import { createGrantCredential } from '@near-intents-agent-api/sdk'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { AgentModel, PolicyModel, GrantModel, TransactionModel } from '../models/index.js'
import { OwnerIntentModel } from '../models/owner-intent.model.js'
import { agentsOnIntentsClient as api } from './agents-on-intents.client.js'
import type { AuthContext } from './session.service.js'
import { verifyFullAccessKey, verifyNep413Signature } from './near-wallet-verifier.js'
import { storeGrantToken } from './grant-secret.service.js'
import { createAgentInput, digest, generatedSchema, parsed, policyInput, providerPolicy, statusSchema, tokensSchema, type PolicyInput } from './spend-contracts.js'

export type AgentDocument = InstanceType<typeof AgentModel>
export type IntentDocument = InstanceType<typeof OwnerIntentModel>
export async function ownedAgent(context: AuthContext, id: string) {
  const agent = await AgentModel.findOne({ _id: id, ownerUserId: context.user._id, walletId: context.wallet._id })
  if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'That agent could not be found for this wallet.')
  return agent
}
export async function tokenCatalog() { return parsed(tokensSchema, await api.get('/v1/tokens')).data }
export async function validatePolicyAssets(p: PolicyInput) {
  const tokens = await tokenCatalog()
  const ids = new Set(tokens.map(t => t.asset_id))
  if ([...p.allowedSourceAssets, ...p.allowedDestinationAssets].some(id => !ids.has(id))) {
    throw new AppError(400, 'UNSUPPORTED_ASSET', 'Choose assets from the current token catalog.')
  }
}
function owner(context: AuthContext) {
  if (env.NEAR_NETWORK_ID !== 'mainnet') throw new AppError(409, 'INTENTS_MAINNET_REQUIRED', 'Agents on Intents requires a verified Mainnet wallet.')
  if (!context.wallet.verifiedPublicKey) throw new AppError(409, 'WALLET_REVERIFICATION_REQUIRED', 'Verify your wallet again to register its signing key.')
  return { type: 'near' as const, account_id: context.wallet.address, public_key: context.wallet.verifiedPublicKey }
}
export function intentDto(intent: IntentDocument) {
  return { id: intent.id, agentId: String(intent.agentId), type: intent.type, status: intent.status,
    expiresAt: intent.expiresAt, generated: intent.generated, failureCode: intent.failureCode, hasSubmission: Boolean(intent.submittedAt || intent.signature) }
}
export function agentDto(agent: AgentDocument) {
  return { id: agent.id, name: agent.name, status: agent.status, externalAgentId: agent.externalAgentId,
    walletId: String(agent.walletId), busy: Boolean(agent.busyOperationId || agent.pendingIntentId), createdAt: agent.createdAt }
}
export async function createAgent(context: AuthContext, input: z.infer<typeof createAgentInput>) {
  owner(context)
  const existing = await AgentModel.findOne({ ownerUserId: context.user._id, creationRequestId: input.requestId })
  if (existing) {
    const policy = await PolicyModel.findOne({ agentId: existing._id, version: 1 })
    if (existing.name !== input.name || !policy || digest(policyProjection(policy)) !== digest(input.policy)) {
      throw new AppError(409, 'REQUEST_CONFLICT', 'This request identifier already belongs to a different agent configuration.')
    }
    return { agent: agentDto(existing), intent: await latestIntent(existing.id) }
  }
  await validatePolicyAssets(input.policy)
  const agent = await AgentModel.create({ ownerUserId: context.user._id, walletId: context.wallet._id,
    creationRequestId: input.requestId, name: input.name, operationType: 'SWAP' })
  const policy = await PolicyModel.create({ ownerUserId: context.user._id, agentId: agent._id, version: 1, ...input.policy })
  const intent = await prepareIntent(context, agent, 'agent_create', { type: 'agent_create', name: input.name,
    external_user_id: context.user.id, owner: owner(context), policy: providerPolicy(input.policy) }, { policyId: policy._id })
  return { agent: agentDto(agent), intent: intentDto(intent) }
}
export function policyProjection(p: InstanceType<typeof PolicyModel>): PolicyInput {
  return { allowedSourceAssets: [...p.allowedSourceAssets], allowedDestinationAssets: [...p.allowedDestinationAssets],
    spendingLimits: p.spendingLimits.map(l => ({ assetId: l.assetId, maxPerOperationBaseUnits: l.maxPerOperationBaseUnits, dailyLimitBaseUnits: l.dailyLimitBaseUnits })),
    requiresUserApproval: p.requiresUserApproval, balanceSource: p.balanceSource as PolicyInput['balanceSource'] }
}
export async function latestIntent(agentId: string) {
  const intent = await OwnerIntentModel.findOne({ agentId }).sort({ createdAt: -1 })
  return intent ? intentDto(intent) : null
}
async function prepareIntent(context: AuthContext, agent: AgentDocument, type: IntentDocument['type'], request: Record<string, unknown>,
  extra: Record<string, unknown> = {}, operationId?: string) {
  owner(context)
  const intent = new OwnerIntentModel({ ownerUserId: context.user._id, walletId: context.wallet._id,
    agentId: agent._id, type, request, idempotencyKey: randomUUID(), ...extra })
  const locked = await AgentModel.findOneAndUpdate({ _id: agent._id, ownerUserId: context.user._id,
    pendingIntentId: { $exists: false }, ...(operationId ? { busyOperationId: operationId } : { busyOperationId: { $exists: false } }) },
    { $set: { pendingIntentId: intent.id } }, { returnDocument: 'after' })
  if (!locked) throw new AppError(409, 'AGENT_BUSY', 'Finish or reconcile the current agent operation first.')
  try { await intent.save() } catch (error) {
    await AgentModel.updateOne({ _id: agent._id, pendingIntentId: intent.id }, { $unset: { pendingIntentId: 1 } })
    throw error
  }
  return generateIntent(context, intent)
}
export async function generateIntent(context: AuthContext, intent: IntentDocument) {
  if (intent.generated) return intent
  if (!intent.ownerUserId.equals(context.user._id)) throw new AppError(404, 'INTENT_NOT_FOUND', 'That authorization could not be found.')
  const signer = owner(context)
  try {
    const generated = parsed(generatedSchema, await api.post('/v1/generate-intent', intent.request, { idempotencyKey: intent.idempotencyKey }))
    if (generated.type !== intent.type || generated.signer.account_id !== signer.account_id || generated.signer.public_key !== signer.public_key ||
      Date.parse(generated.expires_at) <= Date.now() ||
      (intent.request.agent_id && generated.agent_id !== intent.request.agent_id) ||
      (intent.request.policy && digest(generated.preview.policy) !== digest(intent.request.policy))) {
      throw new AppError(502, 'INTENTS_OWNER_MISMATCH', 'The generated authorization does not match the reviewed owner or policy.')
    }
    intent.generated = generated
    intent.correlationId = generated.correlation_id
    intent.expiresAt = new Date(generated.expires_at)
    intent.status = 'PENDING_SIGNATURE'
    await intent.save()
    if (intent.type === 'agent_create') await AgentModel.updateOne({ _id: intent.agentId }, { $set: { externalAgentId: generated.agent_id } })
  } catch (error) {
    intent.status = 'UNCERTAIN'
    intent.failureCode = error instanceof AppError ? error.code : 'INTENTS_UNAVAILABLE'
    await intent.save()
    // Retain the exact generation key/body for explicit recovery; never claim an agent is active.
  }
  return intent
}
export async function ownedIntent(context: AuthContext, id: string) {
  const intent = await OwnerIntentModel.findOne({ _id: id, ownerUserId: context.user._id, walletId: context.wallet._id }).select('+request +signature +tokenSecretRef')
  if (!intent) throw new AppError(404, 'INTENT_NOT_FOUND', 'That authorization could not be found.')
  await ownedAgent(context, String(intent.agentId))
  return intent
}
export async function submitIntent(context: AuthContext, intent: IntentDocument, proof: { publicKey: string; signature: string; payload: unknown }) {
  if (!intent.generated) throw new AppError(409, 'INTENT_NOT_READY', 'This authorization has not been prepared.')
  const generated = parsed(generatedSchema, intent.generated)
  if (digest(proof.payload) !== digest(generated.intent.payload) || proof.publicKey !== generated.signer.public_key ||
    generated.signer.account_id !== context.wallet.address || !verifyNep413Signature(generated.intent.payload, proof.publicKey, proof.signature)) {
    throw new AppError(401, 'INVALID_OWNER_SIGNATURE', 'The signature must cover this exact authorization with its registered owner key.')
  }
  if (intent.signature) {
    if (digest(intent.signature) !== digest(proof)) throw new AppError(409, 'SIGNATURE_CONFLICT', 'This authorization already has a different submission.')
    return reconcileIntent(context, intent)
  }
  if (intent.expiresAt && intent.expiresAt.getTime() <= Date.now()) throw new AppError(409, 'INTENT_EXPIRED', 'This authorization has expired. Cancel it and prepare a new one.')
  await verifyFullAccessKey(context.wallet.address, proof.publicKey)
  const claimed = await OwnerIntentModel.findOneAndUpdate({ _id: intent._id, status: 'PENDING_SIGNATURE', signature: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { signature: proof, status: 'SUBMITTING', submittedAt: new Date() } }, { returnDocument: 'after' })
  if (!claimed) throw new AppError(409, 'INTENT_ALREADY_SUBMITTED', 'This authorization is already being submitted or has expired.')
  try {
    const status = parsed(statusSchema, await api.post('/v1/submit-intent', { type: intent.type, correlation_id: intent.correlationId,
      signed_data: { standard: 'nep413', payload: generated.intent.payload, public_key: proof.publicKey, signature: proof.signature } }))
    await applyIntentStatus(context, intent, status)
  } catch (error) {
    await OwnerIntentModel.updateOne({ _id: intent._id, status: { $nin: ['SUCCESS', 'FAILED'] } },
      { $set: { status: 'UNCERTAIN', failureCode: error instanceof AppError ? error.code : 'INTENTS_UNAVAILABLE' } })
  }
  return intentDto(await ownedIntent(context, intent.id))
}
export async function reconcileIntent(context: AuthContext, intent: IntentDocument, refresh = false) {
  if (['SUCCESS', 'FAILED'].includes(intent.status ?? '')) return intentDto(intent)
  if (intent.status === 'NEEDS_REVIEW' && !refresh) return intentDto(intent)
  if (!intent.correlationId) return intentDto(intent)
  const status = parsed(statusSchema, await api.get('/v1/status', { query: { correlation_id: intent.correlationId, wait_ms: 0, refresh } }))
  await applyIntentStatus(context, intent, status)
  return intentDto(await ownedIntent(context, intent.id))
}
async function applyIntentStatus(context: AuthContext, intent: IntentDocument, status: z.infer<typeof statusSchema>) {
  const generated = parsed(generatedSchema, intent.generated)
  if (status.correlation_id !== intent.correlationId || status.agent_id !== generated.agent_id || status.type !== intent.type) {
    throw new AppError(502, 'INTENTS_RESPONSE_MISMATCH', 'The provider returned a different authorization.')
  }
  if (status.status === 'SUCCESS') {
    const agent = await ownedAgent(context, String(intent.agentId))
    if (['agent_create', 'policy_update'].includes(intent.type)) {
      const view = parsed(z.object({ status: z.literal('APPLIED'), provider_policy_synced: z.literal(true), revision: z.number().int().nonnegative(),
        policy_hash: z.string().regex(/^[a-f0-9]{64}$/), policy: z.record(z.string(), z.unknown()) }), await api.get(`/v1/agents/${generated.agent_id}/policy`))
      if (digest(view.policy) !== digest(intent.request.policy)) throw new AppError(409, 'PROVIDER_POLICY_MISMATCH', 'The applied policy differs from the signed policy. Review the agent before continuing.')
      const policy = await PolicyModel.findOne({ _id: intent.policyId, agentId: agent._id, ownerUserId: context.user._id })
      if (!policy) throw new AppError(409, 'POLICY_NOT_FOUND', 'The local policy could not be found.')
      await PolicyModel.updateMany({ agentId: agent._id, status: 'ACTIVE', _id: { $ne: policy._id } }, { $set: { status: 'SUPERSEDED' } })
      await PolicyModel.updateOne({ _id: policy._id }, { $set: { status: 'ACTIVE' } })
      await AgentModel.updateOne({ _id: agent._id }, { $set: { status: 'ACTIVE', externalAgentId: generated.agent_id, providerRevision: view.revision, providerPolicyHash: view.policy_hash } })
    }
    if (intent.type === 'grant_issue') {
      const grant = parsed(z.object({ grant_id: z.string().regex(/^[a-f0-9]{64}$/), agent_id: z.string(), expires_at: z.iso.datetime(), revoked_at: z.null(),
        owner_message: z.object({ credential: z.string(), owner: z.object({ type: z.literal('near'), account_id: z.string(), public_key: z.string() }) }) }), status.details.grant)
      if (grant.agent_id !== generated.agent_id || grant.owner_message.credential !== intent.request.credential ||
        Date.parse(grant.expires_at) !== Date.parse(intent.request.expires_at) || grant.owner_message.owner.account_id !== context.wallet.address ||
        grant.owner_message.owner.public_key !== generated.signer.public_key || !intent.tokenSecretRef) throw new AppError(502, 'INVALID_GRANT', 'The provider grant differs from the signed authorization.')
      const policy = await PolicyModel.findOne({ _id: intent.policyId, agentId: agent._id, status: 'ACTIVE' })
      if (!policy) throw new AppError(409, 'POLICY_CHANGED', 'The policy changed before authorization completed.')
      const existing = await GrantModel.findOne({ providerGrantId: grant.grant_id })
      if (!existing) await GrantModel.create({ ownerUserId: context.user._id, agentId: agent._id, providerGrantId: grant.grant_id,
        tokenSecretRef: { store: 'mongodb-aes-gcm', key: intent.tokenSecretRef }, policyId: policy._id, policyVersion: policy.version,
        scope: { operationType: 'SWAP', allowedSourceAssets: policy.allowedSourceAssets, allowedDestinationAssets: policy.allowedDestinationAssets },
        expiresAt: new Date(grant.expires_at), status: Date.parse(grant.expires_at) > Date.now() ? 'ACTIVE' : 'EXPIRED' })
    }
    if (intent.type === 'approval_vote') {
      await TransactionModel.updateOne({ ownerUserId: context.user._id, 'operation.operationId': intent.operationId }, { $set: { 'operation.lastReconciledAt': new Date() } })
    }
  }
  const local = status.status === 'SUCCESS' ? 'SUCCESS' : ['FAILED','REFUNDED'].includes(status.status) ? 'FAILED' :
    status.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : status.status === 'UNCERTAIN' ? 'UNCERTAIN' : status.status === 'PENDING_SIGNATURE' ? 'PENDING_SIGNATURE' : 'PENDING'
  await OwnerIntentModel.updateOne({ _id: intent._id }, { $set: { status: local } })
  if (['SUCCESS', 'FAILED'].includes(local)) {
    await AgentModel.updateOne({ _id: intent.agentId, pendingIntentId: intent.id }, { $unset: { pendingIntentId: 1 } })
    if (local === 'FAILED' && intent.type === 'agent_create') await AgentModel.updateOne({ _id: intent.agentId }, { $set: { status: 'FAILED' } })
  }
}
export async function cancelIntent(intent: IntentDocument) {
  if (!intent.generated || intent.signature || intent.status !== 'PENDING_SIGNATURE') throw new AppError(409, 'INTENT_CANNOT_CANCEL', 'Reconcile submitted or uncertain authorization instead of cancelling it.')
  const cancelled = await OwnerIntentModel.updateOne({ _id: intent._id, status: 'PENDING_SIGNATURE', signature: { $exists: false } }, { $set: { status: 'FAILED', failureCode: 'USER_CANCELLED' } })
  if (cancelled.modifiedCount !== 1) throw new AppError(409, 'INTENT_CANNOT_CANCEL', 'This authorization is already being submitted.')
  await AgentModel.updateOne({ _id: intent.agentId, pendingIntentId: intent.id }, { $unset: { pendingIntentId: 1 } })
}
export async function retrySubmission(context:AuthContext,intent:IntentDocument) {
  if (!intent.signature || !intent.generated || !['SUBMITTING','UNCERTAIN','PENDING_SIGNATURE'].includes(intent.status ?? '')) throw new AppError(409,'INTENT_CANNOT_RESUBMIT','This authorization is not awaiting submission recovery.')
  const current=await reconcileIntent(context,intent)
  if (current.status!=='PENDING_SIGNATURE') return current
  if (!intent.expiresAt || intent.expiresAt.getTime()<=Date.now()) throw new AppError(409,'INTENT_EXPIRED','This authorization expired before submission recovery. Reconcile its final provider status.')
  const generated=parsed(generatedSchema,intent.generated)
  const proof=intent.signature as {publicKey:string;signature:string;payload:unknown}
  if (generated.signer.account_id!==context.wallet.address || proof.publicKey!==generated.signer.public_key || digest(proof.payload)!==digest(generated.intent.payload) ||
    !verifyNep413Signature(generated.intent.payload,proof.publicKey,proof.signature)) throw new AppError(401,'INVALID_OWNER_SIGNATURE','The stored owner signature could not be verified.')
  await verifyFullAccessKey(context.wallet.address,proof.publicKey)
  try {
    const status=parsed(statusSchema,await api.post('/v1/submit-intent',{type:intent.type,correlation_id:intent.correlationId,
      signed_data:{standard:'nep413',payload:generated.intent.payload,public_key:proof.publicKey,signature:proof.signature}}))
    await applyIntentStatus(context,intent,status)
  } catch(error) {
    await OwnerIntentModel.updateOne({_id:intent._id,status:{$nin:['SUCCESS','FAILED']}},{$set:{status:'UNCERTAIN',failureCode:error instanceof AppError?error.code:'INTENTS_UNAVAILABLE'}})
  }
  return intentDto(await ownedIntent(context,intent.id))
}
export async function updatePolicy(context: AuthContext, agent: AgentDocument, p: PolicyInput) {
  if (agent.status !== 'ACTIVE' || agent.providerRevision == null) throw new AppError(409, 'AGENT_NOT_ACTIVE', 'Activate this agent before updating its policy.')
  if (agent.pendingIntentId || agent.busyOperationId) throw new AppError(409, 'AGENT_BUSY', 'Finish the current agent operation first.')
  await validatePolicyAssets(p)
  const previous = await PolicyModel.findOne({ agentId: agent._id }).sort({ version: -1 })
  const policy = await PolicyModel.create({ ownerUserId: context.user._id, agentId: agent._id, version: (previous?.version ?? 0) + 1, ...p })
  return intentDto(await prepareIntent(context, agent, 'policy_update', { type: 'policy_update', agent_id: agent.externalAgentId,
    expected_revision: agent.providerRevision, policy: providerPolicy(p) }, { policyId: policy._id }))
}
export async function issueGrant(context: AuthContext, agent: AgentDocument, label: string, expiresAt: string) {
  if (agent.status !== 'ACTIVE') throw new AppError(409, 'AGENT_NOT_ACTIVE', 'Activate this agent first.')
  const policy = await PolicyModel.findOne({ agentId: agent._id, ownerUserId: context.user._id, status: 'ACTIVE' })
  if (!policy) throw new AppError(409, 'POLICY_REQUIRED', 'An active spending policy is required.')
  if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 365 * 86_400_000) throw new AppError(400, 'INVALID_GRANT_EXPIRY', 'Choose an expiry within the next 365 days.')
  const credential = createGrantCredential()
  const tokenSecretRef = await storeGrantToken(credential.token)
  return intentDto(await prepareIntent(context, agent, 'grant_issue', { type: 'grant_issue', agent_id: agent.externalAgentId,
    label, credential: credential.commitment, expires_at: expiresAt }, { policyId: policy._id, tokenSecretRef }))
}
export async function revokeGrant(context: AuthContext, agent: AgentDocument, grantId: string) {
  const grant = await GrantModel.findOne({ _id: grantId, agentId: agent._id, ownerUserId: context.user._id })
  if (!grant) throw new AppError(404, 'GRANT_NOT_FOUND', 'That authorization could not be found.')
  // Local revocation takes effect even if generating the provider revocation fails.
  await GrantModel.updateOne({ _id: grant._id }, { $set: { status: 'REVOKED', revokedAt: new Date() } })
  return intentDto(await prepareIntent(context, agent, 'grant_revoke', { type: 'grant_revoke', agent_id: agent.externalAgentId,
    grant_id: grant.providerGrantId }, { grantId: grant._id }))
}
export async function prepareProviderVote(context: AuthContext, agent: AgentDocument, operationId: string, approvalId: string, verdict: 'approve'|'reject') {
  return intentDto(await prepareIntent(context, agent, 'approval_vote', { type: 'approval_vote', agent_id: agent.externalAgentId,
    approval_id: approvalId, verdict }, { operationId }, operationId))
}
