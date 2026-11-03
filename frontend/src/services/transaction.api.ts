
import type { TransactionAnalysis, TransactionHistoryResponse, TransactionRecord } from '../types/transaction'

interface AnalyzeResponse {
  success: boolean
  data?: TransactionAnalysis
  message?: string
}

export async function analyzeTransaction(
  request: string
): Promise<TransactionAnalysis> {
  const response = await fetch('/api/transactions/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ request })
  })

  const result = await response.json() as AnalyzeResponse

  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.message || 'Transaction analysis failed')
  }

  return result.data
}

export async function getTransactions(
  page = 1,
  limit = 10,
): Promise<TransactionHistoryResponse> {
  const response = await fetch(
    `/api/transactions?page=${page}&limit=${limit}`
  )

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(
      result.message || 'Failed to fetch transactions'
    )
  }

  return result
}

export async function getTransactionById(
  id: string,
): Promise<TransactionRecord> {
  const response = await fetch(
    `/api/transactions/${encodeURIComponent(id)}`
  )

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(
      result.message || 'Failed to fetch transaction details'
    )
  }

  return result.data
}
