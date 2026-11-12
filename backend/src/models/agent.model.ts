import mongoose, { Schema } from 'mongoose'

const agentSchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true },
    externalAgentId: { type: String, trim: true, default: null },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    supportedOperationTypes: {
      type: [{ type: String, enum: ['TOKEN_SWAP'] }],
      required: true,
      default: ['TOKEN_SWAP'],
      validate: {
        validator: (values: string[]) => values.length > 0,
        message: 'At least one supported operation type is required.',
      },
    },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'REVOKED', 'FAILED'],
      required: true,
      default: 'DRAFT',
    },
  },
  { timestamps: true },
)

agentSchema.index({ ownerUserId: 1, createdAt: -1 })
agentSchema.index({ externalAgentId: 1 }, { unique: true, sparse: true })

export const AgentModel =
  mongoose.models.Agent ?? mongoose.model('Agent', agentSchema)
