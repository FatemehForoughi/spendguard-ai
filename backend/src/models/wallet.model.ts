import mongoose, { Schema } from 'mongoose'

const walletSchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    network: { type: String, required: true, trim: true, lowercase: true },
    address: { type: String, required: true, trim: true },
    isVerified: { type: Boolean, required: true, default: false },
    verifiedAt: { type: Date, default: null },
    verificationMethod: {
      type: String,
      enum: ['SIGNATURE', 'PROVIDER_ATTESTATION'],
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

walletSchema.index({ network: 1, address: 1 }, { unique: true })
walletSchema.index({ ownerUserId: 1, createdAt: -1 })

walletSchema.pre('validate', function () {
  if (this.isVerified && !this.verifiedAt) {
    this.invalidate('verifiedAt', 'A verified wallet must have a verification timestamp.')
  }
  if (this.isVerified && !this.verificationMethod) {
    this.invalidate('verificationMethod', 'A verified wallet must record how it was verified.')
  }
})

export const WalletModel =
  mongoose.models.Wallet ?? mongoose.model('Wallet', walletSchema)
