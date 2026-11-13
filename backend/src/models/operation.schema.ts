import { randomUUID } from 'node:crypto'
import { Schema, type InferSchemaType } from 'mongoose'
import { baseUnits, embeddedOptions, identifier, positiveVersion } from './domain-fields.js'

const feeSchema = new Schema({
  assetId: identifier,
  amountBaseUnits: baseUnits(true),
}, embeddedOptions)

const quoteSchema = new Schema({
  providerQuoteId: { ...identifier, required: false },
  inputAssetId: identifier,
  outputAssetId: identifier,
  inputAmountBaseUnits: baseUnits(),
  estimatedOutputAmountBaseUnits: baseUnits(),
  fees: { type: [feeSchema], default: [] },
  warnings: { type: [{ ...identifier, maxlength: 1000 }], default: [] },
  receivedAt: { type: Date, required: true },
  // Providers may omit expiry. Absence is not evidence that a quote is fresh.
  expiresAt: { type: Date },
}, embeddedOptions)

const approvalSchema = new Schema({
  status: {
    type: String,
    enum: ['NOT_REQUESTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'NOT_REQUIRED'],
    required: true,
    default: 'NOT_REQUESTED',
  },
  reference: { ...identifier, required: false },
  reviewedOperationDigest: { type: String, match: /^[a-f0-9]{64}$/, cast: false },
  decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: { type: Date },
  expiresAt: { type: Date },
}, embeddedOptions)

export const operationSchema = new Schema({
  operationId: { ...identifier, default: randomUUID, immutable: true },
  type: { type: String, enum: ['SWAP'], required: true, immutable: true },
  idempotencyKey: { ...identifier, default: randomUUID, immutable: true },
  providerOperationId: { ...identifier, required: false },
  inputAssetId: { ...identifier, immutable: true },
  outputAssetId: { ...identifier, immutable: true },
  inputAmountBaseUnits: { ...baseUnits(), immutable: true },
  quote: { type: quoteSchema },
  policyId: { type: Schema.Types.ObjectId, ref: 'Policy' },
  policyVersion: { ...positiveVersion, required: false },
  grantId: { type: Schema.Types.ObjectId, ref: 'Grant' },
  approval: { type: approvalSchema, required: true, default: () => ({}) },
  executionStatus: {
    type: String,
    enum: [
      'DRAFT', 'PENDING_APPROVAL', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED',
      'NEEDS_REVIEW', 'UNCERTAIN', 'BLOCKED', 'REJECTED',
    ],
    required: true,
    default: 'DRAFT',
  },
  transactionHash: { ...identifier, required: false },
  correlationId: { ...identifier, required: false },
  // Only a sanitized machine code, never a raw response, message, token, or payload.
  providerErrorCode: { type: String, match: /^[A-Z][A-Z0-9_]{0,63}$/, cast: false },
  submittedAt: { type: Date },
  completedAt: { type: Date },
  lastReconciledAt: { type: Date },
}, embeddedOptions)

operationSchema.pre('validate', function () {
  if (this.inputAssetId === this.outputAssetId) {
    this.invalidate('outputAssetId', 'A swap requires different source and destination assets.')
  }
  if (Boolean(this.policyId) !== (this.policyVersion != null)) {
    this.invalidate('policyVersion', 'Policy reference and version must be recorded together.')
  }
  if (this.quote) {
    if (this.quote.inputAssetId !== this.inputAssetId || this.quote.outputAssetId !== this.outputAssetId ||
      this.quote.inputAmountBaseUnits !== this.inputAmountBaseUnits) {
      this.invalidate('quote', 'The quote must describe the requested amount and assets.')
    }
    if (this.quote.expiresAt && this.quote.receivedAt && this.quote.expiresAt <= this.quote.receivedAt) {
      this.invalidate('quote.expiresAt', 'Quote expiry must follow receipt of the quote.')
    }
  }
  const approval = this.approval
  if (approval && ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].includes(approval.status)) {
    if (!approval.reference) this.invalidate('approval.reference', 'A review requires an approval reference.')
    if (!approval.reviewedOperationDigest) this.invalidate('approval.reviewedOperationDigest', 'A review requires the operation digest.')
    if (!approval.expiresAt) this.invalidate('approval.expiresAt', 'A review requires an expiry timestamp.')
    if (!this.quote) this.invalidate('quote', 'A review requires a quote snapshot.')
  }
  if (approval && ['APPROVED', 'REJECTED'].includes(approval.status)) {
    if (!approval.decidedByUserId) this.invalidate('approval.decidedByUserId', 'An approval decision requires its owner.')
    if (!approval.decidedAt) this.invalidate('approval.decidedAt', 'An approval decision requires a timestamp.')
  }
  if (approval?.status === 'APPROVED' && approval.decidedAt && approval.expiresAt &&
    approval.decidedAt >= approval.expiresAt) {
    this.invalidate('approval.decidedAt', 'An approval must be made before it expires.')
  }
})

export type Operation = InferSchemaType<typeof operationSchema>
