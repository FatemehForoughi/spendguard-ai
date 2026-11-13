import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { SecretModel } from '../models/secret.model.js'

function key() {
  if (!env.GRANT_ENCRYPTION_KEY) throw new AppError(503, 'GRANT_STORAGE_NOT_CONFIGURED', 'Secure agent authorization storage is not configured.')
  return Buffer.from(env.GRANT_ENCRYPTION_KEY, 'hex')
}
export function encryptSecret(token: string, locator: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(locator))
  const ciphertext=Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]).toString('base64')
  return { iv: iv.toString('base64'), ciphertext, tag: cipher.getAuthTag().toString('base64') }
}
export function decryptSecret(record: { locator: string; iv: string; ciphertext: string; tag: string }) {
  try {
    const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(record.iv, 'base64'))
    cipher.setAAD(Buffer.from(record.locator))
    cipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    return Buffer.concat([cipher.update(Buffer.from(record.ciphertext, 'base64')), cipher.final()]).toString('utf8')
  } catch { throw new AppError(503, 'GRANT_STORAGE_UNAVAILABLE', 'Agent authorization could not be read securely.') }
}
export async function storeGrantToken(token: string) {
  const locator = randomUUID()
  await SecretModel.create({ locator, ...encryptSecret(token, locator) })
  return locator
}
export async function readGrantToken(locator: string) {
  const record = await SecretModel.findOne({ locator }).select('+iv +tag +ciphertext')
  if (!record) throw new AppError(503, 'GRANT_STORAGE_UNAVAILABLE', 'Agent authorization could not be read securely.')
  return decryptSecret(record)
}
