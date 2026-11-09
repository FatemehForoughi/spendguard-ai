import crypto from 'node:crypto'
import type {
  RiskStatus,
  TransactionAnalysis,
  TransactionDetails,
} from '../types/transaction.js'
import { analyzeRisk } from './ai.service.js'
import type { Analysis } from './ai.service.js'
import { TransactionModel } from '../models/transaction.model.js'

const HIGH_VALUE_THRESHOLD = 1000

const statusRank: Record<RiskStatus, number> = {
  ALLOW: 0,
  WARN: 1,
  BLOCK: 2,
}

function stricterStatus(first: RiskStatus, second: RiskStatus): RiskStatus {
  return statusRank[first] >= statusRank[second] ? first : second
}

async function saveAnalysis(
  analysis: TransactionAnalysis
): Promise<TransactionAnalysis> {
  const saved = await TransactionModel.create({
    request: analysis.request,
    status: analysis.status,
    score: analysis.score,
    message: analysis.message,
    reasons: analysis.reasons,
    details: analysis.details,
  })

  return { ...analysis, id: saved._id.toString() }
}

const dangerousPatterns = [
  /reveal.*(private key|seed phrase)/i,
  /share.*(private key|seed phrase)/i,
  /send.*(private key|seed phrase)/i,
  /ignore all previous instructions/i,
  /reveal.*system prompt/i,
  /bypass.*security/i,
]

function inspectRequest(request: string): string[] {
  if (dangerousPatterns.some((pattern) => pattern.test(request))) {
    return ['The request attempts to expose secrets or bypass security controls.']
  }
  return []
}

function evaluatePolicy(details: TransactionDetails): {
  status: RiskStatus
  scoreFloor: number
  reasons: string[]
} {
  const reasons: string[] = []

  if (
    !details.amount ||
    !details.asset ||
    !details.sourceNetwork ||
    !details.destinationNetwork ||
    !details.recipient
  ) {
    reasons.push('Some required transaction details are missing.')
    return { status: 'WARN', scoreFloor: 21, reasons }
  }

  const amount = Number(details.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    reasons.push('The transaction amount is invalid or unclear.')
    return { status: 'WARN', scoreFloor: 21, reasons }
  }

  if (amount > HIGH_VALUE_THRESHOLD) {
    reasons.push(`The amount exceeds the demo threshold of ${HIGH_VALUE_THRESHOLD}.`)
    return { status: 'WARN', scoreFloor: 21, reasons }
  }

  return { status: 'ALLOW', scoreFloor: 1, reasons }
}

export async function analyzeTransaction(
  request: string
): Promise<TransactionAnalysis> {
  // Deterministic security checks run before any AI call.
  const securityReasons = inspectRequest(request)
  if (securityReasons.length > 0) {
    return saveAnalysis({
      id: crypto.randomUUID(),
      request,
      status: 'BLOCK',
      score: 100,
      message: 'This request contains an attempt to expose secrets or bypass security.',
      reasons: securityReasons,
      details: {
        amount: null,
        asset: null,
        sourceNetwork: null,
        destinationNetwork: null,
        recipient: null,
      },
      createdAt: new Date().toISOString(),
    })
  }

  // A single AI call extracts transaction data and assesses risk.
  const ai: Analysis = await analyzeRisk(request)
  const details: TransactionDetails = ai.details
  const policy = evaluatePolicy(details)

  const scoreStatus: RiskStatus = ai.score >= 80 ? 'BLOCK' : ai.score >= 21 ? 'WARN' : 'ALLOW'
  const finalStatus = stricterStatus(stricterStatus(policy.status, ai.status), scoreStatus)
  let score = Math.max(ai.score, policy.scoreFloor)
  if (finalStatus === 'BLOCK') score = Math.max(score, 80)
  if (finalStatus === 'WARN') score = Math.max(score, 21)

  const reasons = [...new Set([...policy.reasons, ...ai.reasons])].slice(0, 4)
  const message = [ai.message, ai.recommendation].filter(Boolean).join(' ')

  return saveAnalysis({
    id: crypto.randomUUID(),
    request,
    status: finalStatus,
    score,
    message,
    reasons,
    details,
    createdAt: new Date().toISOString(),
  })
}
