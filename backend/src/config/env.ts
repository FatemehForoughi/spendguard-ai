import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const optionalString = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional()
)

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),

  CLIENT_URL: z
    .string()
    .url()
    .default('http://localhost:5173'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  NEAR_AI_API_KEY: optionalString,

  NEAR_AI_BASE_URL: z
    .string()
    .url()
    .default('https://cloud-api.near.ai/v1'),

  NEAR_AI_MODEL: optionalString,

  AGENTS_ON_INTENTS_PARTNER_API_KEY: z.preprocess(
    (value) => typeof value === 'string' ? value.trim() || undefined : value,
    z.string().regex(/^[\x21-\x7e]+$/, 'The partner API key must be a single ASCII token.').optional(),
  ),

  AGENTS_ON_INTENTS_BASE_URL: z
    .string()
    .url()
    .default('https://api.agentsonintents.com')
    .refine((value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password &&
          url.pathname === '/' && !url.search && !url.hash
      } catch {
        return false
      }
    }, 'The Agents on Intents base URL must be an HTTPS origin without credentials, a path, query, or fragment.'),

  AGENTS_ON_INTENTS_TIMEOUT_MS: z.coerce.number().int().min(1).max(120_000).default(35_000),

  MONGODB_URI: optionalString,

  NEAR_NETWORK_ID: z.enum(['mainnet', 'testnet']).default('mainnet'),
  NEAR_RPC_URL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().url().refine((value) => {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    }, 'The NEAR RPC URL must use HTTPS without credentials, query parameters, or fragments.').optional(),
  ),
  NEAR_RPC_TIMEOUT_MS: z.coerce.number().int().min(1).max(30_000).default(8_000),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')
  console.error(result.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = result.data
