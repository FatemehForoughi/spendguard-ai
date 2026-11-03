
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
  message: string
  reasons: string[]
  details: TransactionDetails
  createdAt: string
}
