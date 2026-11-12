import mongoose, { Schema } from 'mongoose'

const assetList = {
  type: [String],
  required: true,
  default: undefined,
  validate: {
    validator: (values: string[]) =>
      values.length > 0 && values.every((value) => value.trim().length > 0),
    message: 'At least one non-empty asset identifier is required.',
  },
}

const policySchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    maxAmountPerOperation: {
      type: String,
      required: true,
      trim: true,
      match: /^[0-9]+$/,
    },
    dailySpendingLimit: {
      type: String,
      required: true,
      trim: true,
      match: /^[0-9]+$/,
    },
    allowedSourceAssets: assetList,
    allowedDestinationAssets: assetList,
    requireUserApproval: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'REVOKED'],
      required: true,
      default: 'ACTIVE',
    },
    version: { type: Number, required: true, min: 1, default: 1 },
  },
  { timestamps: true },
)

policySchema.index({ ownerUserId: 1, agentId: 1, version: 1 }, { unique: true })
policySchema.index({ ownerUserId: 1, status: 1 })

export const PolicyModel =
  mongoose.models.Policy ?? mongoose.model('Policy', policySchema)
