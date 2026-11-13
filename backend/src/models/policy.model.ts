import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import {
  agentReference, assetList, baseUnits, domainOptions, embeddedOptions,
  identifier, ownerReference, positiveVersion,
} from './domain-fields.js'

const spendingLimitSchema = new Schema({
  assetId: identifier,
  maxPerOperationBaseUnits: baseUnits(),
  dailyLimitBaseUnits: baseUnits(),
}, embeddedOptions)

const policySchema = new Schema({
  ownerUserId: ownerReference(),
  agentId: agentReference(),
  version: { ...positiveVersion, immutable: true },
  allowedSourceAssets: { ...assetList(), immutable: true },
  allowedDestinationAssets: { ...assetList(), immutable: true },
  // Limits are per source asset: base units of unrelated assets must never be added together.
  spendingLimits: { type: [spendingLimitSchema], required: true, default: undefined, immutable: true },
  requiresUserApproval: { type: Boolean, required: true, immutable: true },
  status: {
    type: String,
    enum: ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'DISABLED'],
    required: true,
    default: 'DRAFT',
  },
}, domainOptions)

policySchema.pre('validate', function () {
  // Mongoose's immutable path setter does not cover edits inside an existing array.
  if (!this.isNew) {
    for (const field of ['version', 'allowedSourceAssets', 'allowedDestinationAssets', 'spendingLimits', 'requiresUserApproval']) {
      if (this.isModified(field)) this.invalidate(field, 'Policy changes require a new versioned record.')
    }
  }
  const limits = this.spendingLimits ?? []
  const sourceAssets = this.allowedSourceAssets ?? []
  const limitAssets = limits.map((limit) => limit.assetId)
  if (limits.length === 0 || new Set(limitAssets).size !== limits.length ||
    limitAssets.length !== sourceAssets.length || sourceAssets.some((asset) => !limitAssets.includes(asset))) {
    this.invalidate('spendingLimits', 'Every allowed source asset must have exactly one spending limit.')
  }
  for (const [index, limit] of limits.entries()) {
    if (/^[1-9][0-9]*$/.test(limit.maxPerOperationBaseUnits ?? '') &&
      /^[1-9][0-9]*$/.test(limit.dailyLimitBaseUnits ?? '') &&
      BigInt(limit.maxPerOperationBaseUnits) > BigInt(limit.dailyLimitBaseUnits)) {
      this.invalidate(`spendingLimits.${index}.dailyLimitBaseUnits`, 'The daily limit must cover the per-operation limit.')
    }
  }
})

policySchema.index({ agentId: 1, version: 1 }, { unique: true })
policySchema.index({ agentId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } })
policySchema.index({ ownerUserId: 1, agentId: 1, status: 1 })

export type Policy = InferSchemaType<typeof policySchema>
export const PolicyModel = mongoose.model('Policy', policySchema)
