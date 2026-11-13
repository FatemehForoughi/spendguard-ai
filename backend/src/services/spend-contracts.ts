import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../errors/app-error.js'

export const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/)
export const assetId = z.string().min(1).max(256).regex(/^\S+$/)
export const units = z.string().regex(/^[1-9][0-9]{0,77}$/)
export const nonnegativeUnits = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
const assetList = z.array(assetId).min(1).max(32).refine(list => new Set(list).size === list.length)
export const policyInput = z.strictObject({
  allowedSourceAssets: assetList, allowedDestinationAssets: assetList,
  spendingLimits: z.array(z.strictObject({ assetId, maxPerOperationBaseUnits: units, dailyLimitBaseUnits: units })).min(1).max(32),
  requiresUserApproval: z.boolean(), balanceSource: z.enum(['public', 'confidential']).default('public'),
}).superRefine((p, ctx) => {
  const ids = p.spendingLimits.map(l => l.assetId)
  if (new Set(ids).size !== ids.length || ids.length !== p.allowedSourceAssets.length || p.allowedSourceAssets.some(a => !ids.includes(a))) {
    ctx.addIssue({ code: 'custom', message: 'Every source asset needs exactly one limit.' })
  }
  if (p.spendingLimits.some(l => BigInt(l.maxPerOperationBaseUnits) > BigInt(l.dailyLimitBaseUnits))) {
    ctx.addIssue({ code: 'custom', message: 'Daily limits must cover the per-swap limits.' })
  }
})
export type PolicyInput = z.infer<typeof policyInput>
export const createAgentInput = z.strictObject({ requestId: z.uuid(), name: z.string().trim().min(1).max(100), policy: policyInput })
export const swapInput = z.strictObject({ requestId: z.uuid(), agentId: objectId, inputAssetId: assetId, outputAssetId: assetId,
  amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(115), minimumOutputAmount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(115) })
export const tokenSchema = z.object({ asset_id: assetId, symbol: z.string().min(1).max(64), decimals: z.number().int().min(0).max(36), blockchain: z.string().min(1) })
export const tokensSchema = z.object({ data: z.array(tokenSchema).max(4096) }).refine(r => new Set(r.data.map(t => t.asset_id)).size === r.data.length)
export const generatedSchema = z.object({
  correlation_id: z.string().regex(/^intent_[A-Za-z0-9_-]{43}$/), agent_id: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.string(), status: z.literal('PENDING_SIGNATURE'), expires_at: z.iso.datetime(),
  signer: z.object({ type: z.literal('near'), account_id: z.string(), public_key: z.string() }),
  intent: z.strictObject({ standard: z.literal('nep413'), payload: z.strictObject({ message: z.string().max(100_000), recipient: z.string().min(1), nonce: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) }) }),
  preview: z.object({ summary: z.string(), policy: z.record(z.string(), z.unknown()).optional(), revision: z.number().int().optional() }),
})
export const statusSchema = z.object({ correlation_id: z.string(), agent_id: z.string().nullable(), type: z.string(),
  status: z.enum(['PENDING_SIGNATURE', 'QUEUED', 'PENDING_APPROVAL', 'PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED', 'UNCERTAIN', 'NEEDS_REVIEW']),
  failure_code: z.string().nullable(), details: z.record(z.string(), z.unknown()),
})
export type ProviderStatus = z.infer<typeof statusSchema>
export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(502, 'INTENTS_RESPONSE_INVALID', 'The provider returned information that SpendGuard could not verify.')
  return result.data
}
export function decimalToUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || value.length > 115) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Enter a positive amount in token units.')
  }
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw new AppError(400, 'AMOUNT_PRECISION', `This token supports ${decimals} decimal places.`)
  const result = BigInt(whole + fraction.padEnd(decimals, '0')).toString()
  if (!units.safeParse(result).success) throw new AppError(400, 'INVALID_AMOUNT', 'Enter a positive amount within the supported range.')
  return result
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
export function providerPolicy(p: PolicyInput) {
  return { frozen: false, actions: ['swap'], confidential: p.balanceSource === 'confidential', owner_approval: p.requiresUserApproval,
    assets: p.allowedSourceAssets, limits: { per_transaction: Object.fromEntries(p.spendingLimits.map(l => [l.assetId, l.maxPerOperationBaseUnits])),
      daily: Object.fromEntries(p.spendingLimits.map(l => [l.assetId, l.dailyLimitBaseUnits])) },
    max_actions_per_hour: null, destinations: { mode: 'only', list: [] },
    budget: { daily_usd: null, weekly_usd: null, monthly_usd: null }, timelock_ms: 0 }
}
