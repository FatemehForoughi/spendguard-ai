import mongoose, { Schema } from 'mongoose'
import { domainOptions, ownerReference } from './domain-fields.js'

const sessionSchema = new Schema({
  ownerUserId: ownerReference(),
  walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, immutable: true },
  tokenHash: { type: String, required: true, select: false, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  revokedAt: { type: Date },
}, domainOptions)

sessionSchema.index({ tokenHash: 1 }, { unique: true })
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionSchema.index({ ownerUserId: 1 })
export const SessionModel = mongoose.model('Session', sessionSchema)
