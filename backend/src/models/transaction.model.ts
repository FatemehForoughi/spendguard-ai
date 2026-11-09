import mongoose, { Schema } from 'mongoose'

const transactionSchema = new Schema(
  {
    request: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['ALLOW', 'WARN', 'BLOCK'],
      required: true,
    },
    score: { type: Number, min: 1, max: 100, required: true, default: 1 },
    message: { type: String, required: true },
    reasons: { type: [String], default: [] },
    details: {
      amount: { type: String, default: null },
      asset: { type: String, default: null },
      sourceNetwork: { type: String, default: null },
      destinationNetwork: { type: String, default: null },
      recipient: { type: String, default: null },
    },
    approved: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export const TransactionModel =
  mongoose.model('Transaction', transactionSchema)
