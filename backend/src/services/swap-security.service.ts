import { AppError } from '../errors/app-error.js'
import { type PolicyInput, digest } from './spend-contracts.js'

export interface SecurityContext {
  ownerId: string; agentOwnerId: string; walletVerified: boolean; agentActive: boolean
  policyId: string; policyVersion: number; policy: PolicyInput
  grant: { ownerId: string; policyId: string; policyVersion: number; status: string; expiresAt: Date; revokedAt?: Date | null;
    sources: string[]; destinations: string[] }
  inputAssetId: string; outputAssetId: string; amount: string; available: string; spent: string
}
export function enforceSwapSecurity(c: SecurityContext, now = new Date()) {
  const fail = (code: string, message: string): never => { throw new AppError(409, code, message) }
  if (c.ownerId !== c.agentOwnerId || !c.walletVerified) fail('OWNERSHIP_REQUIRED', 'A verified wallet owned by this user is required.')
  if (!c.agentActive) fail('AGENT_NOT_ACTIVE', 'This agent is not active.')
  const grant = c.grant
  if (grant.ownerId !== c.ownerId || grant.status !== 'ACTIVE' || grant.revokedAt || grant.expiresAt <= now ||
    grant.policyId !== c.policyId || grant.policyVersion !== c.policyVersion) fail('GRANT_INVALID', 'Authorize this agent under its current policy before continuing.')
  if (c.inputAssetId === c.outputAssetId || !c.policy.allowedSourceAssets.includes(c.inputAssetId) ||
    !c.policy.allowedDestinationAssets.includes(c.outputAssetId) || !grant.sources.includes(c.inputAssetId) || !grant.destinations.includes(c.outputAssetId)) {
    fail('ASSET_NOT_ALLOWED', 'This asset pair is outside the policy or authorization scope.')
  }
  const limit = c.policy.spendingLimits.find(l => l.assetId === c.inputAssetId)
  if (!limit) return fail('OPERATION_LIMIT_EXCEEDED', 'This source asset has no spending limit.')
  if (BigInt(c.amount) > BigInt(limit.maxPerOperationBaseUnits)) fail('OPERATION_LIMIT_EXCEEDED', 'The amount exceeds the per-swap spending limit.')
  if (BigInt(c.spent) + BigInt(c.amount) > BigInt(limit.dailyLimitBaseUnits)) fail('DAILY_LIMIT_EXCEEDED', 'The amount exceeds the remaining spending limit for the past 24 hours.')
  if (BigInt(c.amount) > BigInt(c.available)) fail('INSUFFICIENT_BALANCE', 'The agent does not have enough available balance for this swap.')
}
export function riskDecision(status: string | undefined, score: number | undefined, requiresApproval: boolean): 'BLOCKED' | 'NEEDS_REVIEW' | 'PENDING_APPROVAL' | 'DRAFT' {
  if (status === 'BLOCK' || (score != null && score >= 80)) return 'BLOCKED'
  if (!status || score == null) return 'NEEDS_REVIEW'
  if (status === 'WARN' || score >= 21 || requiresApproval) return 'PENDING_APPROVAL'
  return 'DRAFT'
}
export function approvalDigest(operation: { operationId: string; inputAssetId: string; outputAssetId: string; inputAmountBaseUnits: string;
  minimumOutputAmountBaseUnits?: string | null; balanceSource: string; policyId?: unknown; policyVersion?: number | null; grantId?: unknown;
  quote?: { snapshotDigest?: string | null } | null; riskAnalysisDigest?: string | null }) {
  return digest({ id: operation.operationId, input: operation.inputAssetId, output: operation.outputAssetId, amount: operation.inputAmountBaseUnits,
    minimum: operation.minimumOutputAmountBaseUnits, source: operation.balanceSource, policyId: String(operation.policyId), version: operation.policyVersion,
    grantId: String(operation.grantId), quote: operation.quote?.snapshotDigest, risk: operation.riskAnalysisDigest })
}
