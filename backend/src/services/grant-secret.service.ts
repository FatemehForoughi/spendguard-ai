import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'

const ALGORITHM = 'aes-256-gcm'

function encryptionKey(): Buffer {
  const encodedKey = env.GRANT_TOKEN_ENCRYPTION_KEY
  if (!encodedKey) {
    throw new AppError(
      503,
      'GRANT_ENCRYPTION_NOT_CONFIGURED',
      'Grant-token encryption is not configured on this server.',
    )
  }
  return Buffer.from(encodedKey, 'base64')
}

export interface EncryptedGrantToken {
  tokenCiphertext: string
  tokenIv: string
  tokenAuthTag: string
  tokenEncryptionVersion: 1
}

export function encryptGrantToken(token: string): EncryptedGrantToken {
  if (typeof token !== 'string' || token.length === 0) {
    throw new AppError(400, 'GRANT_TOKEN_INVALID', 'A valid grant token is required.')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])

  return {
    tokenCiphertext: ciphertext.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: cipher.getAuthTag().toString('base64'),
    tokenEncryptionVersion: 1,
  }
}

export function decryptGrantToken(
  encrypted: EncryptedGrantToken,
): string {
  if (encrypted.tokenEncryptionVersion !== 1) {
    throw new AppError(500, 'GRANT_ENCRYPTION_VERSION_UNSUPPORTED', 'The stored grant token cannot be decrypted.')
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(encrypted.tokenIv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(encrypted.tokenAuthTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.tokenCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new AppError(500, 'GRANT_DECRYPTION_FAILED', 'The stored grant token could not be decrypted.')
  }
}
