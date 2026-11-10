import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../config/env.js'
import { knowledgeService } from './knowledge.service.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ANALYSIS_TIMEOUT_MS = 90_000
const OUTPUT_TOKEN_LIMITS = [1024, 2048] as const

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
  message: z.string().trim().min(1),
  reasons: z.array(z.string().trim().min(1)).max(4).default([]),
  recommendation: z.string().trim().min(1),
})

export type Analysis = z.infer<typeof analysisSchema>
export type ExtractedDetails = z.infer<typeof transactionDetailsSchema>

// ------------------- Client -------------------

function createClient(): OpenAI {
  if (!env.NEAR_AI_API_KEY) {
    throw new Error('NEAR AI is not configured')
  }

  return new OpenAI({
    apiKey: env.NEAR_AI_API_KEY,
    baseURL: env.NEAR_AI_BASE_URL,
    timeout: ANALYSIS_TIMEOUT_MS,
    maxRetries: 1,
  })
}

// Each analysis call extracts details, scores risk, and writes a short result.
function loadPrompt(): string {
  return readFileSync(join(__dirname, '..', 'ai-prompts', 'analyze.md'), 'utf-8').trim()
}

function parseCompletion(
  completion: OpenAI.Chat.Completions.ChatCompletion,
): Analysis | undefined {
  const choice = completion?.choices?.[0]
  if (!choice?.message) return undefined

  if (choice.message.refusal || choice.finish_reason === 'content_filter') {
    throw new Error('NEAR AI declined to analyze this request')
  }
  if (choice.finish_reason === 'length' || !choice.finish_reason) return undefined
  if (choice.finish_reason !== 'stop') {
    throw new Error('NEAR AI returned an unexpected completion type')
  }

  if (typeof choice.message.content !== 'string') return undefined
  const content = choice.message.content.trim()
  if (!content) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }

  const validation = analysisSchema.safeParse(parsed)
  return validation.success ? validation.data : undefined
}

export async function analyzeRisk(request: string): Promise<Analysis> {
  const model = env.NEAR_AI_MODEL
  if (!model) {
    throw new Error('NEAR AI is not configured')
  }

  const client = createClient()
  const systemPrompt = loadPrompt()
  const knowledge = knowledgeService.getCombinedPrompt()
  const signal = AbortSignal.timeout(ANALYSIS_TIMEOUT_MS)

  for (const [attempt, maxTokens] of OUTPUT_TOKEN_LIMITS.entries()) {
    signal.throwIfAborted()
    const retryInstruction = attempt === 0 ? '' :
      '\n\nThe previous response was incomplete or invalid. Re-analyze the original request and return one complete JSON object matching the schema above. Include every required field, use null for unknown transaction details, and keep explanations concise. Do not include Markdown.'

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${systemPrompt}\n\nSecurity knowledge:\n${knowledge}${retryInstruction}`,
          },
          { role: 'user', content: request },
        ],
      },
      { signal },
    )

    signal.throwIfAborted()
    const analysis = parseCompletion(completion)
    if (analysis) return analysis
  }

  throw new Error('NEAR AI did not return a complete, valid analysis')
}
