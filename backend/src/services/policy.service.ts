import crypto from 'node:crypto'
import type {
  RiskStatus,
  TransactionAnalysis,
  TransactionDetails,
} from '../types/transaction.js'
import {
  extractTransactionDetails,
  analyzeRisk,
  generateExplanation,
} from './ai.service.js'
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
    message: analysis.message,
    reasons: analysis.reasons,
    details: analysis.details,
  })

  return {
    ...analysis,
    id: saved._id.toString(),
  }
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
    return [
      'The request contains an attempt to expose secrets or bypass security controls.',
    ]
  }

  return []
}

function evaluatePolicy(
  details: TransactionDetails,
): { status: RiskStatus; reasons: string[] } {
  const reasons: string[] = []

  if (
    !details.amount ||
    !details.asset ||
    !details.sourceNetwork ||
    !details.destinationNetwork ||
    !details.recipient
  ) {
    reasons.push('Some required transaction details are missing.')
    return { status: 'WARN', reasons }
  }

  const amount = Number(details.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    reasons.push('The transaction amount is invalid or unclear.')
    return { status: 'WARN', reasons }
  }

  if (amount > HIGH_VALUE_THRESHOLD) {
    reasons.push(
      `The transaction amount exceeds the demo threshold of ${HIGH_VALUE_THRESHOLD}.`,
    )
    return { status: 'WARN', reasons }
  }

  return { status: 'ALLOW', reasons }
}

function toRiskStatus(analysis: Analysis): RiskStatus {
  return analysis.status
}

export async function analyzeTransaction(
  request: string
): Promise<TransactionAnalysis> {
  // 1. Apply hard security checks before sending user content to an AI model.
  const securityReasons = inspectRequest(request)

  if (securityReasons.length > 0) {
    return saveAnalysis({
      id: crypto.randomUUID(),
      request,
      status: 'BLOCK',
      message: 'The request contains an attempt to expose secrets or bypass security controls.',
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

  // 2. Agent 1: extract structured transaction details.
  const extracted = await extractTransactionDetails(request)

  const details: TransactionDetails = {
    amount: extracted.amount,
    asset: extracted.asset,
    sourceNetwork: extracted.sourceNetwork,
    destinationNetwork: extracted.destinationNetwork,
    recipient: extracted.recipient,
  }

  // 3. Deterministic policy checks establish a minimum risk status.
  const policy = evaluatePolicy(details)

  // 4. Agent 2: analyze risk using the configured knowledge base.
  const riskAnalysis = await analyzeRisk(extracted, request)

  // 5. Policy rules may raise risk, but the AI cannot override them.
  const finalStatus = stricterStatus(policy.status, toRiskStatus(riskAnalysis))
  const finalReasons = [...new Set([...policy.reasons, ...riskAnalysis.reasons])]

  const analysisForExplanation: Analysis = {
    ...riskAnalysis,
    status: finalStatus,
    reasons: finalReasons,
  }

  // 6. Agent 3: produce a human-readable explanation.
  const explanation = await generateExplanation(analysisForExplanation)

  // Keep the authoritative status and all detected reasons regardless of AI wording.
  return saveAnalysis({
    id: crypto.randomUUID(),
    request,
    status: finalStatus,
    message: [explanation.message, explanation.recommendation].filter(Boolean).join(' '),
    reasons: [...new Set([...finalReasons, ...explanation.reasons])],
    details,
    createdAt: new Date().toISOString(),
  })
}
