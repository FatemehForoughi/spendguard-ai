import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import { domainOptions, identifier, ownerReference } from './domain-fields.js'

// Canonicalization belongs to the chain-specific verification service. Reject
// whitespace rather than silently rewriting the wallet the user presented.
const walletIdentifier = { ...identifier, trim: false, match: /^\S+$/ } as const

const walletSchema = new Schema({
  ownerUserId: ownerReference(),
  network: { ...walletIdentifier, immutable: true },
  // Store the chain-canonical address after provider-specific validation; do not lowercase blindly.
  address: { ...walletIdentifier, immutable: true },
  verificationStatus: {
    type: String,
    enum: ['UNVERIFIED', 'VERIFIED', 'REVOKED'],
    required: true,
    default: 'UNVERIFIED',
  },
  verifiedAt: { type: Date },
  verificationMethod: { ...identifier, required: false },
  verificationReference: { ...identifier, required: false },
  verifiedPublicKey: { type: String, match: /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/, cast: false },
  revokedAt: { type: Date },
}, domainOptions)

walletSchema.pre('validate', function () {
  const hasProofMetadata = [this.verifiedAt, this.verificationMethod, this.verificationReference]
    .some((value) => value !== undefined)
  // Revocation retains a complete proof trail if this wallet was verified.
  if (this.verificationStatus === 'VERIFIED' ||
    (this.verificationStatus === 'REVOKED' && hasProofMetadata)) {
    if (!this.verifiedAt) this.invalidate('verifiedAt', 'Verified wallets require a verification timestamp.')
    if (!this.verificationMethod) this.invalidate('verificationMethod', 'Verified wallets require a proof method.')
    if (!this.verificationReference) this.invalidate('verificationReference', 'Verified wallets require a proof reference.')
  }
  if (this.verificationStatus === 'VERIFIED' && this.revokedAt !== undefined) {
    this.invalidate('revokedAt', 'A revoked wallet cannot be verified.')
  }
  if (this.verificationStatus === 'UNVERIFIED' &&
    (hasProofMetadata || this.revokedAt !== undefined)) {
    this.invalidate('verificationStatus', 'An unverified wallet cannot have verification or revocation metadata.')
  }
  if (this.verificationStatus === 'REVOKED' && !this.revokedAt) {
    this.invalidate('revokedAt', 'Revoked wallets require a revocation timestamp.')
  }
  if (this.verifiedAt && this.revokedAt && this.revokedAt < this.verifiedAt) {
    this.invalidate('revokedAt', 'Revocation cannot precede wallet verification.')
  }
})

// Only successful verification claims an address across users. Unverified
// submissions must not prevent the real owner from proving control later.
// A revoked, previously verified wallet retains its ownership claim for audit.
walletSchema.index({ network: 1, address: 1 }, {
  unique: true,
  partialFilterExpression: { verifiedAt: { $type: 'date' } },
})
walletSchema.index({ ownerUserId: 1, network: 1, address: 1 }, { unique: true })
walletSchema.index({ ownerUserId: 1, verificationStatus: 1 })

export type Wallet = InferSchemaType<typeof walletSchema>
export const WalletModel = mongoose.model('Wallet', walletSchema)
