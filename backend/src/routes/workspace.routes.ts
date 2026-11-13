import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { walletOriginGuard, walletRateLimit } from '../middleware/wallet-security.js'
import { AgentModel, PolicyModel, GrantModel } from '../models/index.js'
import { OwnerIntentModel } from '../models/owner-intent.model.js'
import { requireSession } from '../services/session.service.js'
import { agentDto, cancelIntent, createAgent, generateIntent, intentDto, issueGrant, ownedAgent, ownedIntent, reconcileIntent, revokeGrant, retrySubmission, submitIntent, tokenCatalog, updatePolicy } from '../services/agent-workflow.service.js'
import { createAgentInput, objectId, policyInput } from '../services/spend-contracts.js'
import { nonnegativeUnits, parsed } from '../services/spend-contracts.js'
import { agentsOnIntentsClient } from '../services/agents-on-intents.client.js'
import { swapInput } from '../services/spend-contracts.js'
import { TransactionModel } from '../models/index.js'
import { createSwap, decideSwap, executeSwap, operationDto, ownedOperation, providerApproval, reconcileSwap, refreshSwap } from '../services/swap-workflow.service.js'

export const workspaceRoutes = Router()
workspaceRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
workspaceRoutes.use(walletRateLimit(120))
workspaceRoutes.use((req, res, next) => req.method === 'GET' ? next() : walletOriginGuard(req, res, next))
const route = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next) } catch (error) {
    if (error instanceof AppError) return next(error)
    if (error instanceof Error && (error.name === 'VersionError' || ('code' in error && error.code === 11000))) {
      return next(new AppError(409, 'WORKSPACE_CONFLICT', 'This record changed during your request. Refresh the workspace before continuing.'))
    }
    next(new AppError(503, 'WORKSPACE_UNAVAILABLE', 'The workspace is unavailable right now. Please try again.'))
  }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'INVALID_WORKSPACE_REQUEST', result.error.issues[0]?.message ?? 'Check the request fields.')
  return result.data
}
workspaceRoutes.get('/config', (_req, res) => res.json({ success: true, data: { liveExecutionEnabled: env.ENABLE_LIVE_EXECUTION } }))
workspaceRoutes.get('/summary', route(async(req,res)=>{
  const context=await requireSession(req)
  const agents=await AgentModel.find({ownerUserId:context.user._id,walletId:context.wallet._id}).select('_id')
  const filter={ownerUserId:context.user._id,agentId:{$in:agents.map(a=>a._id)},operation:{$exists:true}}
  const [total,success,blocked,pendingApproval,uncertain]=await Promise.all([
    TransactionModel.countDocuments(filter),TransactionModel.countDocuments({...filter,'operation.executionStatus':'SUCCESS'}),
    TransactionModel.countDocuments({...filter,'operation.executionStatus':'BLOCKED'}),TransactionModel.countDocuments({...filter,'operation.executionStatus':'PENDING_APPROVAL'}),
    TransactionModel.countDocuments({...filter,'operation.executionStatus':'UNCERTAIN'}),
  ])
  res.json({success:true,data:{agents:agents.length,total,success,blocked,pendingApproval,uncertain}})
}))
workspaceRoutes.get('/tokens', route(async (req, res) => { await requireSession(req); res.json({ success: true, data: await tokenCatalog() }) }))
workspaceRoutes.get('/agents', route(async (req, res) => {
  const context = await requireSession(req)
  const agents = await AgentModel.find({ ownerUserId: context.user._id, walletId: context.wallet._id }).sort({ createdAt: -1 }).limit(100)
  res.json({ success: true, data: agents.map(agentDto) })
}))
workspaceRoutes.post('/agents', route(async (req, res) => {
  const context = await requireSession(req)
  res.status(201).json({ success: true, data: await createAgent(context, input(createAgentInput, req.body)) })
}))
workspaceRoutes.get('/agents/:id', route(async (req, res) => {
  const context = await requireSession(req)
  const agent = await ownedAgent(context, input(objectId, req.params.id))
  const [policies, grants, intents] = await Promise.all([
    PolicyModel.find({ agentId: agent._id, ownerUserId: context.user._id }).sort({ version: -1 }).limit(50),
    GrantModel.find({ agentId: agent._id, ownerUserId: context.user._id }).sort({ createdAt: -1 }).limit(50),
    OwnerIntentModel.find({ agentId: agent._id, ownerUserId: context.user._id }).sort({ createdAt: -1 }).limit(50),
  ])
  res.json({ success: true, data: { agent: agentDto(agent), policies: policies.map(p => ({ id: p.id, version: p.version, status: p.status,
    allowedSourceAssets: p.allowedSourceAssets, allowedDestinationAssets: p.allowedDestinationAssets, spendingLimits: p.spendingLimits,
    requiresUserApproval: p.requiresUserApproval, balanceSource: p.balanceSource })), grants: grants.map(g => ({ id: g.id,
    status: g.status === 'ACTIVE' && g.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : g.status, expiresAt: g.expiresAt, revokedAt: g.revokedAt,
    policyVersion: g.policyVersion })), intents: intents.map(intentDto) } })
}))
workspaceRoutes.post('/agents/:id/policies', route(async (req, res) => {
  const context = await requireSession(req)
  res.status(201).json({ success: true, data: await updatePolicy(context, await ownedAgent(context, input(objectId, req.params.id)), input(policyInput, req.body)) })
}))
workspaceRoutes.get('/agents/:id/balances',route(async(req,res)=>{
  const context=await requireSession(req)
  const agent=await ownedAgent(context,input(objectId,req.params.id))
  const policy=await PolicyModel.findOne({agentId:agent._id,status:'ACTIVE'})
  if (agent.status!=='ACTIVE'||!policy) {res.json({success:true,data:{source:'public',balances:[]}});return}
  const balances=parsed(z.object({source:z.enum(['public','confidential']),balances:z.array(z.object({asset_id:z.string(),
    symbol:z.string().nullable(),decimals:z.number().int().min(0).max(36).nullable(),balance_raw:nonnegativeUnits,available_raw:nonnegativeUnits})).max(4096)}),
    await agentsOnIntentsClient.get(`/v1/agents/${agent.externalAgentId}/balances`,{query:{source:policy.balanceSource}}))
  if (balances.source!==policy.balanceSource)throw new AppError(502,'BALANCE_INVALID','The provider returned a different balance source.')
  res.json({success:true,data:balances})
}))
workspaceRoutes.post('/agents/:id/grants', route(async (req, res) => {
  const context = await requireSession(req)
  const body = input(z.strictObject({ label: z.string().min(1).max(64).regex(/^[\x20-\x7e]+$/), expiresAt: z.iso.datetime() }), req.body)
  res.status(201).json({ success: true, data: await issueGrant(context, await ownedAgent(context, input(objectId, req.params.id)), body.label, body.expiresAt) })
}))
workspaceRoutes.post('/agents/:id/grants/:grantId/revoke', route(async (req, res) => {
  const context = await requireSession(req)
  res.json({ success: true, data: await revokeGrant(context, await ownedAgent(context, input(objectId, req.params.id)), input(objectId, req.params.grantId)) })
}))
workspaceRoutes.post('/intents/:id/submit', route(async (req, res) => {
  const context = await requireSession(req)
  const proof = input(z.strictObject({ publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/), signature: z.string().max(256),
    payload: z.strictObject({ message: z.string().max(100_000), recipient: z.string(), nonce: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) }) }), req.body)
  res.json({ success: true, data: await submitIntent(context, await ownedIntent(context, input(objectId, req.params.id)), proof) })
}))
workspaceRoutes.post('/intents/:id/reconcile', route(async (req, res) => {
  const context = await requireSession(req)
  const body = input(z.strictObject({ refresh: z.boolean().default(false) }), req.body)
  res.json({ success: true, data: await reconcileIntent(context, await ownedIntent(context, input(objectId, req.params.id)), body.refresh) })
}))
workspaceRoutes.post('/intents/:id/retry-generation', route(async (req, res) => {
  const context = await requireSession(req)
  const intent = await ownedIntent(context, input(objectId, req.params.id))
  if (intent.status !== 'UNCERTAIN' || intent.correlationId) throw new AppError(409, 'INTENT_CANNOT_REGENERATE', 'Reconcile the existing authorization instead.')
  res.json({ success: true, data: intentDto(await generateIntent(context, intent)) })
}))
workspaceRoutes.post('/intents/:id/cancel', route(async (req, res) => {
  const context = await requireSession(req)
  await cancelIntent(await ownedIntent(context, input(objectId, req.params.id)))
  res.json({ success: true, data: null })
}))
workspaceRoutes.post('/intents/:id/retry-submission',route(async(req,res)=>{
  const context=await requireSession(req)
  res.json({success:true,data:await retrySubmission(context,await ownedIntent(context,input(objectId,req.params.id)))})
}))

workspaceRoutes.get('/operations', route(async (req,res) => {
  const context=await requireSession(req)
  const page=input(z.coerce.number().int().min(1).max(100000),req.query.page ?? 1)
  const limit=input(z.coerce.number().int().min(1).max(100),req.query.limit ?? 20)
  const owned=await AgentModel.find({ownerUserId:context.user._id,walletId:context.wallet._id}).select('_id')
  const filter={ownerUserId:context.user._id,agentId:{$in:owned.map(a=>a._id)},operation:{$exists:true}}
  const [rows,total]=await Promise.all([TransactionModel.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit),TransactionModel.countDocuments(filter)])
  res.json({success:true,data:rows.map(operationDto),pagination:{page,limit,total,hasNextPage:page*limit<total}})
}))
workspaceRoutes.post('/operations',route(async(req,res)=>{
  const context=await requireSession(req)
  res.status(201).json({success:true,data:await createSwap(context,input(swapInput,req.body))})
}))
workspaceRoutes.get('/operations/:id',route(async(req,res)=>{
  const context=await requireSession(req)
  res.json({success:true,data:operationDto(await ownedOperation(context,input(z.uuid(),req.params.id)))})
}))
workspaceRoutes.post('/operations/:id/decision',route(async(req,res)=>{
  const context=await requireSession(req)
  const body=input(z.strictObject({reference:z.uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.enum(['approve','reject'])}),req.body)
  res.json({success:true,data:await decideSwap(context,await ownedOperation(context,input(z.uuid(),req.params.id)),body.reference,body.digest,body.verdict)})
}))
workspaceRoutes.post('/operations/:id/refresh',route(async(req,res)=>{
  const context=await requireSession(req)
  res.json({success:true,data:await refreshSwap(context,await ownedOperation(context,input(z.uuid(),req.params.id)))})
}))
workspaceRoutes.post('/operations/:id/execute',route(async(req,res)=>{
  const context=await requireSession(req)
  res.json({success:true,data:await executeSwap(context,await ownedOperation(context,input(z.uuid(),req.params.id)))})
}))
workspaceRoutes.post('/operations/:id/reconcile',route(async(req,res)=>{
  const context=await requireSession(req)
  const body=input(z.strictObject({refresh:z.boolean().default(false)}),req.body)
  res.json({success:true,data:await reconcileSwap(context,await ownedOperation(context,input(z.uuid(),req.params.id)),body.refresh)})
}))
workspaceRoutes.post('/operations/:id/provider-approval',route(async(req,res)=>{
  const context=await requireSession(req)
  const body=input(z.strictObject({verdict:z.enum(['approve','reject'])}),req.body)
  res.json({success:true,data:await providerApproval(context,await ownedOperation(context,input(z.uuid(),req.params.id)),body.verdict)})
}))
export default workspaceRoutes
