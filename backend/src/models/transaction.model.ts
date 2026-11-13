import { randomUUID } from 'node:crypto'
import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import { operationSchema } from './operation.schema.js'

function requiresAnalysis(this: { operation?: unknown; status?: string | null }) {
  return !this.operation || this.status != null
}

const transactionSchema = new Schema(
  {
    // Reserve the existing correlation ID before analysis, keeping the current unique index intact.
    analysisId: { type: String, required: true, unique: true, index: true, default: randomUUID },
    request: { type: String, required: true, trim: true },
    ownerUserId: {
      type: Schema.Types.ObjectId, ref: 'User', immutable: true,
      required: function (this: { operation?: unknown }) { return Boolean(this.operation) },
    },
    agentId: {
      type: Schema.Types.ObjectId, ref: 'Agent', immutable: true,
      required: function (this: { operation?: unknown }) { return Boolean(this.operation) },
    },
    operation: { type: operationSchema },
    status: {
      type: String,
      enum: ['ALLOW', 'WARN', 'BLOCK'],
      required: requiresAnalysis,
    },
    score: {
      type: Number, min: 1, max: 100, required: requiresAnalysis,
      default: function (this: { operation?: unknown }) { return this.operation ? undefined : 1 },
    },
    message: { type: String, required: requiresAnalysis },
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
  { timestamps: true, optimisticConcurrency: true }
)

transactionSchema.pre('validate', function () {
  // Also cover replacement of the whole embedded operation, which could bypass child setters.
  if (!this.isNew) {
    for (const field of ['operationId', 'idempotencyKey', 'type', 'inputAssetId', 'outputAssetId', 'inputAmountBaseUnits', 'minimumOutputAmountBaseUnits', 'balanceSource']) {
      if (this.isModified(`operation.${field}`)) {
        this.invalidate(`operation.${field}`, 'Operation identity and requested amounts cannot change after creation.')
      }
    }
  }
  if (this.agentId && !this.ownerUserId) {
    this.invalidate('ownerUserId', 'An agent-linked transaction requires an owner.')
  }
  if (this.operation && this.status == null && (this.score != null || this.message != null)) {
    this.invalidate('status', 'Analysis details require an explicit risk decision.')
  }
  const approver = this.operation?.approval?.decidedByUserId
  if (approver && !approver.equals(this.ownerUserId)) {
    this.invalidate('operation.approval.decidedByUserId', 'The approval decision must belong to the transaction owner.')
  }
})

transactionSchema.index({ ownerUserId: 1, createdAt: -1 })
transactionSchema.index({ ownerUserId: 1, agentId: 1, 'operation.executionStatus': 1, createdAt: -1 })
for (const field of ['operationId', 'idempotencyKey', 'providerOperationId'] as const) {
  transactionSchema.index({ [`operation.${field}`]: 1 }, {
    unique: true,
    partialFilterExpression: { [`operation.${field}`]: { $type: 'string' } },
  })
}

export type Transaction = InferSchemaType<typeof transactionSchema>
export const TransactionModel =
  mongoose.model('Transaction', transactionSchema)
