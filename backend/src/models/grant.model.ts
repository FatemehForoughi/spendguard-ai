import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import {
  agentReference, assetList, domainOptions, embeddedOptions, identifier, ownerReference, positiveVersion,
} from './domain-fields.js'

const grantScopeSchema = new Schema({
  operationType: { type: String, enum: ['SWAP'], required: true },
  allowedSourceAssets: assetList(),
  allowedDestinationAssets: assetList(),
}, embeddedOptions)

// The token itself lives in a secure secret store. This is only its server-side locator.
const secretReferenceSchema = new Schema({
  store: identifier,
  key: identifier,
}, embeddedOptions)

function redactSecretReference(_doc: unknown, result: Record<string, unknown>) {
  delete result.tokenSecretRef
  return result
}

const grantSchema = new Schema({
  ownerUserId: ownerReference(),
  agentId: agentReference(),
  providerGrantId: { ...identifier, immutable: true },
  tokenSecretRef: { type: secretReferenceSchema, required: true, select: false },
  policyId: { type: Schema.Types.ObjectId, ref: 'Policy', required: true, immutable: true },
  policyVersion: { ...positiveVersion, immutable: true },
  scope: { type: grantScopeSchema, required: true, immutable: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
  status: {
    type: String,
    enum: ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED'],
    required: true,
    default: 'PENDING',
  },
}, domainOptions)

grantSchema.set('toJSON', { transform: redactSecretReference })
grantSchema.set('toObject', { transform: redactSecretReference })

grantSchema.pre('validate', function () {
  if (this.status === 'REVOKED' && !this.revokedAt) {
    this.invalidate('revokedAt', 'Revoked grants require a revocation timestamp.')
  }
  if (this.status !== 'REVOKED' && this.revokedAt) {
    this.invalidate('status', 'A revoked grant must retain its revoked status.')
  }
  if (this.status === 'ACTIVE' && this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
    this.invalidate('expiresAt', 'An active grant must not already be expired.')
  }
})

grantSchema.index({ providerGrantId: 1 }, { unique: true })
grantSchema.index({ ownerUserId: 1, agentId: 1, status: 1 })
// No TTL index: expired and revoked grants must remain available for audit history.

export type Grant = InferSchemaType<typeof grantSchema>
export const GrantModel = mongoose.model('Grant', grantSchema)
