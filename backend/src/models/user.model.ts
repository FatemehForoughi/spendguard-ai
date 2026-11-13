import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import { domainOptions, identifier } from './domain-fields.js'

// An identity association only. Authentication/session verification is a later phase.
// Issuer and subject are opaque values supplied by a verified identity provider.
// Trimming them could associate two distinct identities with the same local user.
const authIdentity = {
  ...identifier,
  trim: false,
  validate: {
    validator: (value: string) => value.trim().length > 0,
    message: 'An authenticated identity must not be blank.',
  },
} as const

const userSchema = new Schema({
  authIssuer: { ...authIdentity, immutable: true },
  authSubject: { ...authIdentity, immutable: true },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], required: true, default: 'ACTIVE' },
}, domainOptions)

userSchema.index({ authIssuer: 1, authSubject: 1 }, { unique: true })

export type User = InferSchemaType<typeof userSchema>
export const UserModel = mongoose.model('User', userSchema)
