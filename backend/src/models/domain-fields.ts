import { Schema } from 'mongoose'

export const domainOptions = {
  timestamps: true,
  strict: 'throw',
  optimisticConcurrency: true,
} as const

export const embeddedOptions = { _id: false, strict: 'throw' } as const

export const identifier = {
  type: String,
  required: true,
  trim: true,
  minlength: 1,
  maxlength: 512,
  cast: false,
} as const

export function ownerReference() {
  return { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true } as const
}

export function agentReference() {
  return { type: Schema.Types.ObjectId, ref: 'Agent', required: true, immutable: true } as const
}

// Never let Mongoose turn a rounded JavaScript number into a token amount.
// These are canonical base-unit strings, not human-readable decimal amounts.
export function baseUnits(allowZero = false) {
  return {
    type: String,
    required: true,
    cast: false,
    match: allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/,
    maxlength: 256,
  } as const
}

export function assetList() {
  return {
    type: [{ ...identifier }],
    required: true,
    default: undefined,
    castNonArrays: false,
    validate: {
      validator: (values: string[]) => Array.isArray(values) && values.length > 0 &&
        values.every((value) => typeof value === 'string' && value.trim().length > 0) &&
        new Set(values).size === values.length,
      message: 'Provide a non-empty list of distinct asset identifiers.',
    },
  }
}

export const positiveVersion = {
  type: Number,
  required: true,
  min: 1,
  validate: { validator: Number.isSafeInteger, message: 'Version must be a positive safe integer.' },
} as const
