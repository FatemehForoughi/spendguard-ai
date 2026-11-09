export type RiskStatus = 'ALLOW' | 'WARN' | 'BLOCK'

export interface TransactionDetails {
  amount: string | null
  asset: string | null
  sourceNetwork: string | null
  destinationNetwork: string | null
  recipient: string | null
}

export interface TransactionAnalysis {
  id: string
  request: string
  status: RiskStatus
  score: number
  message: string
  reasons: string[]
  details: TransactionDetails
  createdAt: string
}

export interface TransactionRecord {
  _id: string
  request: string
  status: RiskStatus
  score: number
  message: string
  reasons: string[]
  details: TransactionDetails
  approved: boolean
  createdAt: string
  updatedAt: string
}

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface TransactionHistoryResponse {
  success: boolean
  data: TransactionRecord[]
  pagination: Pagination
}
