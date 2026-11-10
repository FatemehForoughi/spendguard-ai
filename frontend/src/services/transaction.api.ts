import type { TransactionAnalysis, TransactionHistoryResponse, TransactionRecord } from '../types/transaction'
import { ApiError, requestJson } from './http'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

interface ApiResponse<T> {
  success: boolean
  data?: T
}

export async function analyzeTransaction(
  request: string
): Promise<TransactionAnalysis> {
  const result = await requestJson<ApiResponse<TransactionAnalysis>>(`${API_BASE_URL}/api/transactions/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ request })
  })

  if (!result.data) {
    throw new ApiError('We could not read the analysis result. Please try again.', 'INVALID_RESPONSE')
  }

  return result.data
}

export async function getTransactions(
  page = 1,
  limit = 10,
): Promise<TransactionHistoryResponse> {
  const result = await requestJson<TransactionHistoryResponse>(
    `${API_BASE_URL}/api/transactions?page=${page}&limit=${limit}`
  )

  if (!Array.isArray(result.data) || !result.pagination) {
    throw new ApiError('We could not read your transaction history. Please try again.', 'INVALID_RESPONSE')
  }

  return result
}

export async function getTransactionById(
  id: string,
): Promise<TransactionRecord> {
  const result = await requestJson<ApiResponse<TransactionRecord>>(
    `${API_BASE_URL}/api/transactions/${encodeURIComponent(id)}`
  )

  if (!result.data) {
    throw new ApiError('We could not read the transaction details. Please try again.', 'INVALID_RESPONSE')
  }

  return result.data
}
