import { ApiError, requestJson } from './http'
import type { Agent, AgentDetail, Balance, OwnerIntent, PolicyInput, SwapOperation, Token } from '../types/workspace'
const base = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/,'')
export async function workspaceRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await requestJson<{success:true;data:T}>(`${base}/api/workspace/${path}`, { credentials:'include',
    ...(body!==undefined ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {}) })
  if (!('data' in response)) throw new ApiError('SpendGuard returned an incomplete workspace response.','INVALID_RESPONSE')
  return response.data
}
export const getAgents=()=>workspaceRequest<Agent[]>('agents')
export const getTokens=()=>workspaceRequest<Token[]>('tokens')
export const getAgent=(id:string)=>workspaceRequest<AgentDetail>(`agents/${id}`)
export const getBalances=(id:string)=>workspaceRequest<{source:string;balances:Balance[]}>(`agents/${id}/balances`)
export const createAgent=(body:{requestId:string;name:string;policy:PolicyInput})=>workspaceRequest<{agent:Agent;intent:OwnerIntent}>('agents',body)
export const updatePolicy=(id:string,policy:PolicyInput)=>workspaceRequest<OwnerIntent>(`agents/${id}/policies`,policy)
export const createGrant=(id:string,label:string,expiresAt:string)=>workspaceRequest<OwnerIntent>(`agents/${id}/grants`,{label,expiresAt})
export const revokeGrant=(id:string,grantId:string)=>workspaceRequest<OwnerIntent>(`agents/${id}/grants/${grantId}/revoke`,{})
export const submitIntent=(id:string,proof:{payload:unknown;publicKey:string;signature:string})=>workspaceRequest<OwnerIntent>(`intents/${id}/submit`,proof)
export const reconcileIntent=(id:string,refresh=false)=>workspaceRequest<OwnerIntent>(`intents/${id}/reconcile`,{refresh})
export const cancelIntent=(id:string)=>workspaceRequest<null>(`intents/${id}/cancel`,{})
export const retryIntent=(id:string)=>workspaceRequest<OwnerIntent>(`intents/${id}/retry-generation`,{})
export const retrySubmission=(id:string)=>workspaceRequest<OwnerIntent>(`intents/${id}/retry-submission`,{})
export const getOperations=()=>workspaceRequest<SwapOperation[]>('operations?limit=100')
export const createSwap=(body:{requestId:string;agentId:string;inputAssetId:string;outputAssetId:string;amount:string;minimumOutputAmount:string})=>workspaceRequest<SwapOperation>('operations',body)
export const decideSwap=(row:SwapOperation,verdict:'approve'|'reject')=>workspaceRequest<SwapOperation>(`operations/${row.id}/decision`,{reference:row.operation.approval.reference,digest:row.operation.approval.reviewedOperationDigest,verdict})
export const executeSwap=(id:string)=>workspaceRequest<SwapOperation>(`operations/${id}/execute`,{})
export const refreshSwap=(id:string)=>workspaceRequest<SwapOperation>(`operations/${id}/refresh`,{})
export const reconcileSwap=(id:string,refresh=false)=>workspaceRequest<SwapOperation>(`operations/${id}/reconcile`,{refresh})
export const providerVote=(id:string,verdict:'approve'|'reject')=>workspaceRequest<OwnerIntent>(`operations/${id}/provider-approval`,{verdict})
