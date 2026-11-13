export interface Token { asset_id: string; symbol: string; decimals: number; blockchain: string }
export interface Agent { id: string; name: string; status: string; externalAgentId?: string; walletId: string; busy: boolean; createdAt: string }
export interface PolicyInput { allowedSourceAssets: string[]; allowedDestinationAssets: string[]; spendingLimits: { assetId: string; maxPerOperationBaseUnits: string; dailyLimitBaseUnits: string }[]; requiresUserApproval: boolean; balanceSource: 'public'|'confidential' }
export interface Policy extends PolicyInput { id: string; version: number; status: string }
export interface Grant { id: string; status: string; expiresAt: string; policyVersion: number }
export interface OwnerIntent { id: string; agentId: string; type: string; status: string; expiresAt?: string; failureCode?: string; hasSubmission?: boolean;
  generated?: { type: string; agent_id: string; signer: { type: 'near'; account_id: string; public_key: string }; intent: { standard: 'nep413'; payload: { message: string; recipient: string; nonce: string } }; preview: { summary: string; policy?: Record<string,unknown> } } }
export interface AgentDetail { agent: Agent; policies: Policy[]; grants: Grant[]; intents: OwnerIntent[] }
export interface Balance { asset_id:string;symbol:string|null;decimals:number|null;balance_raw:string;available_raw:string }
export interface SwapOperation { id: string; agentId: string; request: string; createdAt: string; risk: { status: 'ALLOW'|'WARN'|'BLOCK'; score: number; message: string; reasons: string[] } | null;
  operation: { operationId: string; inputAssetId: string; outputAssetId: string; inputAmountBaseUnits: string; minimumOutputAmountBaseUnits: string; actualOutputAmountBaseUnits?: string; balanceSource: 'public'|'confidential';
    quote?: { estimatedOutputAmountBaseUnits?: string; feeUsd?: string; feePercent?: string; warnings: string[]; reviewExpiresAt: string; expiresAt?: string };
    approval: { status: string; reference?: string; reviewedOperationDigest?: string; expiresAt?: string };
    executionStatus: string; decisionReasons: string[]; policyVersion?: number; correlationId?: string; providerStatus?: string; providerApprovalId?: string; transactionHash?: string; submittedAt?: string; providerErrorCode?: string } }
