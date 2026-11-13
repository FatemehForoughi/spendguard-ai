import mongoose, { Schema } from 'mongoose'
import { domainOptions, ownerReference } from './domain-fields.js'

// Retained for recovery and audit; never expire uncertain external work via TTL.
const schema = new Schema({
  ownerUserId: ownerReference(),
  walletId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, immutable: true },
  policyId: { type: Schema.Types.ObjectId, ref: 'Policy' },
  operationId: { type: String },
  grantId: { type: Schema.Types.ObjectId, ref: 'Grant' },
  type: { type: String, enum: ['agent_create', 'policy_update', 'grant_issue', 'grant_revoke', 'approval_vote'], required: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  request: { type: Schema.Types.Mixed, required: true, select: false },
  generated: { type: Schema.Types.Mixed },
  signature: { type: Schema.Types.Mixed, select: false },
  submittedAt: { type: Date },
  correlationId: { type: String, index: true },
  expiresAt: { type: Date },
  status: { type: String, enum: ['GENERATING', 'PENDING_SIGNATURE', 'SUBMITTING', 'PENDING', 'SUCCESS', 'FAILED', 'UNCERTAIN', 'NEEDS_REVIEW'], default: 'GENERATING' },
  tokenSecretRef: { type: String, select: false },
  failureCode: { type: String },
}, domainOptions)
schema.index({ ownerUserId: 1, agentId: 1, createdAt: -1 })
export const OwnerIntentModel = mongoose.model('OwnerIntent', schema)
