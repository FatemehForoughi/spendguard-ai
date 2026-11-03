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

  MONGODB_URI: optionalString,
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:')
  console.error(result.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = result.data