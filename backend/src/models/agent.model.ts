import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import { domainOptions, identifier, ownerReference } from './domain-fields.js'

const agentSchema = new Schema({
  ownerUserId: ownerReference(),
  walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, immutable: true },
  externalAgentId: { ...identifier, required: false },
  name: { ...identifier, maxlength: 100 },
  operationType: { type: String, enum: ['SWAP'], required: true },
  status: {
    type: String,
    enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'FAILED', 'ARCHIVED'],
    required: true,
    default: 'PENDING',
  },
}, domainOptions)

agentSchema.pre('validate', function () {
  if (this.status === 'ACTIVE' && !this.externalAgentId) {
    this.invalidate('externalAgentId', 'An active agent requires a provider agent identifier.')
  }
})

agentSchema.index({ ownerUserId: 1, createdAt: -1 })
agentSchema.index({ externalAgentId: 1 }, {
  unique: true,
  partialFilterExpression: { externalAgentId: { $type: 'string' } },
})

export type Agent = InferSchemaType<typeof agentSchema>
export const AgentModel = mongoose.model('Agent', agentSchema)
