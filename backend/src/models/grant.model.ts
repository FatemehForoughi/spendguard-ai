import mongoose, { Schema } from 'mongoose'

const grantSchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    providerGrantReference: { type: String, trim: true, required: true },
    scopes: {
      type: [String],
      required: true,
      validate: {
        validator: (values: string[]) =>
          values.length > 0 && values.every((value) => value.trim().length > 0),
        message: 'At least one non-empty grant scope is required.',
      },
    },
    tokenCiphertext: { type: String, required: true, select: false },
    tokenIv: { type: String, required: true, select: false },
    tokenAuthTag: { type: String, required: true, select: false },
    tokenEncryptionVersion: { type: Number, required: true, default: 1, select: false },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'FAILED'],
      required: true,
      default: 'PENDING',
    },
  },
  { timestamps: true },
)

grantSchema.index({ ownerUserId: 1, agentId: 1, status: 1 })
grantSchema.index({ providerGrantReference: 1 }, { unique: true })

grantSchema.pre('validate', function () {
  if (this.status === 'REVOKED' && !this.revokedAt) {
    this.invalidate('revokedAt', 'A revoked grant must have a revocation timestamp.')
  }
})

grantSchema.set('toJSON', {
  transform(_document, returnedObject) {
    delete returnedObject.tokenCiphertext
    delete returnedObject.tokenIv
    delete returnedObject.tokenAuthTag
    delete returnedObject.tokenEncryptionVersion
    return returnedObject
  },
})

export const GrantModel =
  mongoose.models.Grant ?? mongoose.model('Grant', grantSchema)
