import crypto from 'node:crypto'
import type {
  RiskStatus,
  TransactionAnalysis,
  TransactionDetails,
} from '../types/transaction.js'
import { extractTransactionDetails } from './ai.service.js'
import { TransactionModel } from '../models/transaction.model.js'

const HIGH_VALUE_THRESHOLD = 1000

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
  const reasons: string[] = []

  if (dangerousPatterns.some((pattern) => pattern.test(request))) {
    reasons.push(
      'The request contains an attempt to expose secrets or bypass security controls.',
    )
  }

  return reasons
}

function evaluatePolicy(
  request: string,
  details: TransactionDetails,
): { status: RiskStatus; reasons: string[] } {
  const reasons = inspectRequest(request)

  if (reasons.length > 0) {
    return { status: 'BLOCK', reasons }
  }

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

  reasons.push(
    'Basic policy checks passed. Network, token, recipient, and contract verification are still required.',
  )

  return { status: 'ALLOW', reasons }
}

export async function analyzeTransaction(
  request: string
): Promise<TransactionAnalysis> {

  // 1. Check malicious patterns before calling AI
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

  // 2. Only safe-looking requests reach AI
  const extracted = await extractTransactionDetails(request)

  const details: TransactionDetails = {
    amount: extracted.amount,
    asset: extracted.asset,
    sourceNetwork: extracted.sourceNetwork,
    destinationNetwork: extracted.destinationNetwork,
    recipient: extracted.recipient,
  }

  // 3. Apply deterministic policy
  const policy = evaluatePolicy(request, details)

  return saveAnalysis({
    id: crypto.randomUUID(),
    request,
    status: policy.status,
    message: policy.status === 'ALLOW'
      ? 'Basic policy checks passed. Human approval is still required.'
      : 'The transaction needs further security review.',
    reasons: policy.reasons,
    details,
    createdAt: new Date().toISOString(),
  })
}