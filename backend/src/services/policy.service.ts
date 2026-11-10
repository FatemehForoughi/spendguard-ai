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
    analysisId: analysis.id,
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
  /\b(?:reveal|share|send)\b(?:(?!\b(?:reveal|share|send)\b)[^.!?;])*?\b(?:private\s+key|seed\s+phrase)\b/gi,
  /\bignore\s+all\s+previous\s+instructions\b/gi,
  /\breveal\b(?:(?!\b(?:reveal|share|send)\b)[^.!?;])*?\bsystem\s+prompt\b/gi,
  /\bbypass\b(?:(?!\bbypass\b)[^.!?;])*?\bsecurity\b/gi,
]

// Only an explicit negation immediately before the action makes it protective.
// A later, unnegated action must still be checked independently.
const protectivePrefixPattern = /\b(?:never|(?:do|does|did|should|must|can|could|will|would)\s+not|(?:don|doesn|didn|shouldn|mustn|can|couldn|wouldn)['’]t|won['’]t|cannot|avoid)\s+(?:(?:ever|please)\s+|under\s+any\s+circumstances\s+)*(?:(?:reveal|share|send)\s+(?:and|or)\s+)*$/i

function inspectRequest(request: string): string[] {
  const normalizedRequest = request.replace(/\s+/g, ' ')
  for (const pattern of dangerousPatterns) {
    for (const match of normalizedRequest.matchAll(pattern)) {
      const prefix = normalizedRequest.slice(0, match.index)
      if (!protectivePrefixPattern.test(prefix)) {
        return ['The request attempts to expose secrets or bypass security controls.']
      }
    }
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
  let message = [ai.message, ai.recommendation].filter(Boolean).join(' ')
  if (finalStatus === 'WARN') {
    message = [
      'This transaction requires review.',
      ...reasons,
      'Verify the details and resolve the concerns before proceeding.',
    ].join(' ')
  }
  if (finalStatus === 'BLOCK') {
    message = [
      'This transaction has high-risk indicators.',
      ...reasons,
      'Do not proceed with this transaction.',
    ].join(' ')
  }

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
