import { randomUUID } from 'node:crypto'
import mongoose, { Schema } from 'mongoose'
import { domainOptions, identifier } from './domain-fields.js'

const walletChallengeSchema = new Schema({
  challengeId: { ...identifier, default: randomUUID, immutable: true },
  accountId: { ...identifier, immutable: true },
  networkId: { type: String, enum: ['mainnet', 'testnet'], required: true, immutable: true },
  message: { type: String, required: true, immutable: true },
  recipient: { ...identifier, immutable: true },
  nonce: { type: String, required: true, immutable: true },
  browserBindingHash: { type: String, required: true, select: false, immutable: true },
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
  boundSessionId: { type: Schema.Types.ObjectId, ref: 'Session', immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  consumedAt: { type: Date },
}, domainOptions)

walletChallengeSchema.index({ challengeId: 1 }, { unique: true })
// Expiry is checked on every use. Retain a short audit window before cleanup.
walletChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 })
export const WalletChallengeModel = mongoose.model('WalletChallenge', walletChallengeSchema)
