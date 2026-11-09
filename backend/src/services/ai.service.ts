import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '../config/env.js'
import { knowledgeService } from './knowledge.service.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ------------------- Schemas -------------------

const extractedDetailsSchema = z.object({
  amount: z.union([z.string(), z.number().transform(String)]).nullable(),
  asset: z.string().nullable(),
  sourceNetwork: z.string().nullable(),
  destinationNetwork: z.string().nullable(),
  recipient: z.string().nullable(),
})

const analysisSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['ALLOW', 'WARN', 'BLOCK']),
  reasons: z.array(z.string()),
  signals: z.array(z.string()).optional().default([]),
  confidence: z.enum(['high', 'medium', 'low']),
})

const explanationSchema = z.object({
  status: z.enum(['ALLOW', 'WARN', 'BLOCK']),
  message: z.string(),
  reasons: z.array(z.string()),
  recommendation: z.string().optional(),
})

// ------------------- Types -------------------

export type ExtractedDetails = z.infer<typeof extractedDetailsSchema>
export type Analysis = z.infer<typeof analysisSchema>
export type Explanation = z.infer<typeof explanationSchema>

export interface TransactionResult {
  request: string
  status: 'ALLOW' | 'WARN' | 'BLOCK'
  message: string
  reasons: string[]
  details: {
    amount: string | null
    asset: string | null
    sourceNetwork: string | null
    destinationNetwork: string | null
    recipient: string | null
  }
  approved: boolean
}

// ------------------- Client -------------------

function createClient(): OpenAI {
  if (!env.NEAR_AI_API_KEY || !env.NEAR_AI_MODEL) {
    throw new Error('NEAR AI is not configured')
  }

  return new OpenAI({
    apiKey: env.NEAR_AI_API_KEY,
    baseURL: env.NEAR_AI_BASE_URL,
    // NEAR AI risk analysis can take longer when the knowledge prompt is large.
    // Keep retries for transient network failures, with a longer per-attempt timeout.
    timeout: 90_000,
    maxRetries: 2,
  })
}

// ------------------- Prompt Loader -------------------

function loadPrompt(name: string): string {
  try {
    return readFileSync(join(__dirname, '..', 'ai-prompts', `${name}.md`), 'utf-8').trim()
  } catch {
    throw new Error(`Prompt file not found: ${name}.md`)
  }
}

// ------------------- Core Functions -------------------

export async function extractTransactionDetails(
  request: string
): Promise<ExtractedDetails> {
  const client = createClient()
  const systemPrompt = loadPrompt('extract')

  const completion = await client.chat.completions.create({
    model: env.NEAR_AI_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('NEAR AI returned empty response (extract)')

  const parsed = JSON.parse(content)
  return extractedDetailsSchema.parse(parsed)
}

export async function analyzeRisk(
  details: ExtractedDetails,
  originalRequest: string
): Promise<Analysis> {
  const client = createClient()
  const systemPrompt = loadPrompt('analyze')
  const knowledge = knowledgeService.getCombinedPrompt()

  const userContent = `
Original request:
${originalRequest}

Extracted details:
${JSON.stringify(details, null, 2)}
`.trim()

  const completion = await client.chat.completions.create({
    model: env.NEAR_AI_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `${systemPrompt}\n\n--- KNOWLEDGE BASE ---\n${knowledge}`,
      },
      { role: 'user', content: userContent },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('NEAR AI returned empty response (analyze)')

  const parsed = JSON.parse(content)
  return analysisSchema.parse(parsed)
}

export async function generateExplanation(
  analysis: Analysis
): Promise<Explanation> {
  const client = createClient()
  const systemPrompt = loadPrompt('explain')

  const completion = await client.chat.completions.create({
    model: env.NEAR_AI_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify(analysis, null, 2),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('NEAR AI returned empty response (explain)')

  const parsed = JSON.parse(content)
  return explanationSchema.parse(parsed)
}

// ------------------- Main Pipeline -------------------

export async function analyzeTransaction(
  request: string
): Promise<TransactionResult> {
  // 1. Extract
  const details = await extractTransactionDetails(request)

  // 2. Analyze
  const analysis = await analyzeRisk(details, request)

  // 3. Explain
  const explanation = await generateExplanation(analysis)

  // 4. ساخت آبجکت نهایی مطابق Schema دیتابیس
  return {
    request,
    status: explanation.status,
    message: explanation.message,
    reasons: explanation.reasons,
    details: {
      amount: details.amount,
      asset: details.asset,
      sourceNetwork: details.sourceNetwork,
      destinationNetwork: details.destinationNetwork,
      recipient: details.recipient,
    },
    approved: false,
  }
}