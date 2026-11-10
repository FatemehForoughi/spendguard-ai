import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../config/env.js'
import { knowledgeService } from './knowledge.service.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ------------------- Schema -------------------

const transactionDetailsSchema = z.object({
  amount: z.union([z.string(), z.number().transform(String)]).nullable(),
  asset: z.string().nullable(),
  sourceNetwork: z.string().nullable(),
  destinationNetwork: z.string().nullable(),
  recipient: z.string().nullable(),
})

const analysisSchema = z.object({
  details: transactionDetailsSchema,
  score: z.number().int().min(1).max(100),
  status: z.enum(['ALLOW', 'WARN', 'BLOCK']),
  message: z.string(),
  reasons: z.array(z.string()).max(4).default([]),
  recommendation: z.string(),
})

export type Analysis = z.infer<typeof analysisSchema>
export type ExtractedDetails = z.infer<typeof transactionDetailsSchema>

// ------------------- Client -------------------

function createClient(): OpenAI {
  if (!env.NEAR_AI_API_KEY || !env.NEAR_AI_MODEL) {
    throw new Error('NEAR AI is not configured')
  }

  return new OpenAI({
    apiKey: env.NEAR_AI_API_KEY,
    baseURL: env.NEAR_AI_BASE_URL,
    timeout: 90_000,
    maxRetries: 1,
  })
}

// One model call extracts details, scores risk, and writes a short result.
function loadPrompt(): string {
  return readFileSync(join(__dirname, '..', 'ai-prompts', 'analyze.md'), 'utf-8').trim()
}

export async function analyzeRisk(request: string): Promise<Analysis> {
  const client = createClient()
  const systemPrompt = loadPrompt()
  const knowledge = knowledgeService.getCombinedPrompt().slice(0, 4000)

  const completion = await client.chat.completions.create({
    model: env.NEAR_AI_MODEL,
    temperature: 0,
    max_tokens: 300,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `${systemPrompt}\n\nSecurity knowledge:\n${knowledge}`,
      },
      { role: 'user', content: request },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('NEAR AI returned an empty analysis')

  return analysisSchema.parse(JSON.parse(content))
}
