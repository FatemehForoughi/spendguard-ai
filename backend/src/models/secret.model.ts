import mongoose, { Schema } from 'mongoose'

const schema = new Schema({
  locator: { type: String, required: true, unique: true, immutable: true },
  ciphertext: { type: String, required: true, select: false },
  iv: { type: String, required: true, select: false },
  tag: { type: String, required: true, select: false },
}, { timestamps: true })
export const SecretModel = mongoose.model('Secret', schema)
