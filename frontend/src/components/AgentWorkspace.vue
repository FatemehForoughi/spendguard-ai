<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Bot, Plus, RefreshCw, ShieldCheck, ArrowLeftRight, LoaderCircle } from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet'
import * as api from '../services/workspace.api'
import { signOwnerIntent } from '../services/meteor-wallet'
import { fromBaseUnits, toBaseUnits } from '../services/token-amounts'
import type { Agent, AgentDetail, Balance, OwnerIntent, PolicyInput, SwapOperation, Token } from '../types/workspace'
const props=defineProps<{view:string}>()
const wallet=useWallet()
const agents=ref<Agent[]>([]),tokens=ref<Token[]>([]),operations=ref<SwapOperation[]>([])
const selectedAgent=ref(''),detail=ref<AgentDetail|null>(null),review=ref<OwnerIntent|null>(null)
const balances=ref<Balance[]>([])
const loading=ref(false),busy=ref(false),error=ref(''),notice=ref(''),liveEnabled=ref(false)
const name=ref(''),source=ref(''),destination=ref(''),perSwap=ref(''),daily=ref(''),requiresApproval=ref(true),balanceSource=ref<'public'|'confidential'>('public')
const amount=ref(''),minimum=ref(''),grantLabel=ref('SpendGuard trading agent'),grantHours=ref(24)
let generation=0,createAttempt:{fingerprint:string;id:string}|undefined,swapAttempt:{fingerprint:string;id:string}|undefined
let timer:ReturnType<typeof setInterval>|undefined
const activePolicy=computed(()=>detail.value?.policies.find(p=>p.status==='ACTIVE'))
const activeAgent=computed(()=>agents.value.find(a=>a.id===selectedAgent.value))
const rows=computed(()=>props.view==='activity'?operations.value:operations.value.filter(o=>!selectedAgent.value||o.agentId===selectedAgent.value))
function label(id:string) { const t=tokens.value.find(t=>t.asset_id===id);return t?`${t.symbol} · ${t.blockchain}`:id }
function format(value:string|undefined,id:string) { if(!value)return 'Unavailable';const t=tokens.value.find(t=>t.asset_id===id);return t?`${fromBaseUnits(value,t.decimals)} ${t.symbol}`:`${value} atomic units` }
const time=(value?:string)=>value?new Date(value).toLocaleString():'Unavailable'
function policy():PolicyInput {
  const token=tokens.value.find(t=>t.asset_id===source.value)
  if(!token||!destination.value)throw new Error('Choose a source and destination asset.')
  return {allowedSourceAssets:[source.value],allowedDestinationAssets:[destination.value],spendingLimits:[{assetId:source.value,
    maxPerOperationBaseUnits:toBaseUnits(perSwap.value,token.decimals),dailyLimitBaseUnits:toBaseUnits(daily.value,token.decimals)}],requiresUserApproval:requiresApproval.value,balanceSource:balanceSource.value}
}
async function load(epoch=generation) {
  const results=await Promise.allSettled([api.getAgents(),api.getTokens(),api.getOperations(),api.workspaceRequest<{liveExecutionEnabled:boolean}>('config')])
  if(epoch!==generation)return
  const [a,t,o,c]=results
  if(a!.status==='fulfilled')agents.value=a!.value
  if(t!.status==='fulfilled')tokens.value=t!.value
  if(o!.status==='fulfilled')operations.value=o!.value
  if(c!.status==='fulfilled')liveEnabled.value=c!.value.liveExecutionEnabled
  const failures=results.filter(r=>r.status==='rejected') as PromiseRejectedResult[]
  if(failures.length)error.value=failures[0]!.reason instanceof Error?failures[0]!.reason.message:'The workspace could not be loaded.'
  if(!selectedAgent.value&&agents.value.length)selectedAgent.value=agents.value[0]!.id
  if(selectedAgent.value){await loadDetail(epoch);if(!source.value&&!destination.value)editPolicy()}
}
async function loadDetail(epoch=generation) { const id=selectedAgent.value;if(!id)return;const value=await api.getAgent(id);if(epoch!==generation||selectedAgent.value!==id)return;detail.value=value;
  if(value.agent.status==='ACTIVE'){const balance=await api.getBalances(id);if(epoch===generation&&selectedAgent.value===id)balances.value=balance.balances}else balances.value=[] }
async function run(action:(epoch:number)=>Promise<void>) {
  if(busy.value||!wallet.session.value)return
  const epoch=generation;busy.value=true;error.value='';notice.value=''
  try{await action(epoch);if(epoch===generation)await load(epoch)}catch(failure){if(epoch===generation)error.value=failure instanceof Error?failure.message:'The action could not be completed.'}
  finally{if(epoch===generation)busy.value=false}
}
async function reload(){loading.value=true;await run(async epoch=>{await load(epoch)});loading.value=false}
async function addAgent(){await run(async epoch=>{
  const p=policy();const fingerprint=JSON.stringify({name:name.value.trim(),policy:p})
  if(createAttempt?.fingerprint!==fingerprint)createAttempt={fingerprint,id:crypto.randomUUID()}
  const result=await api.createAgent({requestId:createAttempt.id,name:name.value.trim(),policy:p})
  if(epoch!==generation)return
  selectedAgent.value=result.agent.id;review.value=result.intent;notice.value='Review and sign the agent policy to activate it.'
})}
async function savePolicy(){await run(async epoch=>{const value=await api.updatePolicy(selectedAgent.value,policy());if(epoch===generation)review.value=value})}
function editPolicy(){const p=activePolicy.value;if(!p)return;source.value=p.allowedSourceAssets[0]??'';destination.value=p.allowedDestinationAssets[0]??'';requiresApproval.value=p.requiresUserApproval;balanceSource.value=p.balanceSource;
  const t=tokens.value.find(t=>t.asset_id===source.value),l=p.spendingLimits[0];if(t&&l){perSwap.value=fromBaseUnits(l.maxPerOperationBaseUnits,t.decimals);daily.value=fromBaseUnits(l.dailyLimitBaseUnits,t.decimals)}}
async function authorize(){await run(async epoch=>{if(grantHours.value<1||grantHours.value>8760)throw new Error('Choose an authorization duration between 1 and 8760 hours.');const value=await api.createGrant(selectedAgent.value,grantLabel.value,new Date(Date.now()+grantHours.value*3600000).toISOString());if(epoch===generation)review.value=value})}
async function revoke(id:string){await run(async epoch=>{const value=await api.revokeGrant(selectedAgent.value,id);if(epoch===generation)review.value=value})}
async function sign(){const intent=review.value;if(!intent?.generated||intent.status!=='PENDING_SIGNATURE')return;await run(async epoch=>{
  if(!intent.expiresAt||Date.parse(intent.expiresAt)<=Date.now())throw new Error('This authorization has expired. Cancel it and prepare a new one.')
  const g=intent.generated!;if(g.intent.standard!=='nep413')throw new Error('This signing standard is not supported.')
  const proof=await signOwnerIntent('mainnet',g.intent.payload,g.signer.account_id,g.signer.public_key)
  if(epoch!==generation)return
  const value=await api.submitIntent(intent.id,proof);if(epoch===generation){review.value=value;notice.value=value.status==='SUCCESS'?'Authorization confirmed.':'Authorization submitted. Check its status for confirmation.'}
})}
async function checkIntent(intent:OwnerIntent,refresh=false){await run(async epoch=>{const value=intent.generated?await api.reconcileIntent(intent.id,refresh):await api.retryIntent(intent.id);if(epoch===generation)review.value=value})}
async function cancel(){const intent=review.value;if(!intent)return;await run(async epoch=>{await api.cancelIntent(intent.id);if(epoch===generation)review.value=null})}
async function resubmit(){const intent=review.value;if(!intent)return;await run(async epoch=>{const value=await api.retrySubmission(intent.id);if(epoch===generation)review.value=value})}
async function quote(){await run(async epoch=>{
  const p=activePolicy.value;if(!p)throw new Error('Create and authorize an active spending policy first.')
  const request={agentId:selectedAgent.value,inputAssetId:source.value||p.allowedSourceAssets[0]!,outputAssetId:destination.value||p.allowedDestinationAssets[0]!,amount:amount.value,minimumOutputAmount:minimum.value}
  const fingerprint=JSON.stringify(request);if(swapAttempt?.fingerprint!==fingerprint)swapAttempt={fingerprint,id:crypto.randomUUID()}
  const row=await api.createSwap({requestId:swapAttempt.id,...request});if(epoch===generation){operations.value=[row,...operations.value.filter(o=>o.id!==row.id)];notice.value='Preview created. Review the amount, minimum output, fees, and risk result.'}
})}
async function operationAction(row:SwapOperation,action:'approve'|'reject'|'execute'|'refresh'|'reconcile'|'review') {await run(async()=>{
  if(action==='approve'||action==='reject')await api.decideSwap(row,action)
  if(action==='execute')await api.executeSwap(row.id)
  if(action==='refresh')await api.refreshSwap(row.id)
  if(action==='reconcile'||action==='review')await api.reconcileSwap(row.id,action==='review')
})}
async function vote(row:SwapOperation,verdict:'approve'|'reject'){await run(async epoch=>{const value=await api.providerVote(row.id,verdict);if(epoch===generation)review.value=value})}
watch(selectedAgent,()=>{detail.value=null;void run(async epoch=>{await loadDetail(epoch);if(epoch===generation)editPolicy()})})
watch(()=>wallet.session.value?.user.id+'|'+wallet.session.value?.wallet.id,()=>{
  generation++;agents.value=[];operations.value=[];tokens.value=[];balances.value=[];selectedAgent.value='';detail.value=null;review.value=null;busy.value=false;error.value='';createAttempt=undefined;swapAttempt=undefined
  if(wallet.session.value)void reload()
},{immediate:true})
timer=setInterval(()=>{
  if(!wallet.session.value||busy.value||loading.value||document.visibilityState!=='visible')return
  const candidates=operations.value.filter(r=>r.operation.correlationId&&['PENDING','UNCERTAIN','PENDING_APPROVAL'].includes(r.operation.executionStatus))
  const intents=detail.value?.intents.filter(i=>['PENDING','UNCERTAIN'].includes(i.status)&&i.generated)??[]
  if(candidates.length||intents.length)void run(async()=>{for(const row of candidates)await api.reconcileSwap(row.id);for(const intent of intents)await api.reconcileIntent(intent.id)})
},15000)
onBeforeUnmount(()=>{generation++;clearInterval(timer)})
</script>

<template>
  <div class="workspace">
    <div class="section-heading"><div><h1>{{ view==='agents'?'Agents & spending policies':view==='activity'?'Your activity':view==='settings'?'Workspace settings':view==='help'?'Help & support':'Swap workspace' }}</h1><p>Control permissions, review each swap, and track its result.</p></div><button class="workspace-button secondary" :disabled="busy" @click="reload"><RefreshCw :size="16"/> Refresh</button></div>
    <section v-if="view==='help'" class="workspace-panel"><h2>Try the complete workflow</h2><ol><li>Connect and verify your Mainnet wallet through Meteor.</li><li>Open Agents & Policies, choose the asset pair and spending limits, and sign the creation message.</li><li>Authorize the agent with a clearly displayed expiry. Fund its agent balance separately.</li><li>Open Swaps, enter the amount and a minimum output, and review the preview and NEAR AI result.</li><li>Approve the exact preview. If execution is enabled, submit it and sign any required provider approval.</li><li>Use Activity Logs to track the original swap until settlement.</li></ol><p>If Meteor cannot find your account, open wallet.meteorwallet.app in the same browser profile, select Mainnet, and confirm the account is in its account menu.</p><p>An uncertain swap stays held for reconciliation. A review-required swap needs provider resolution before it can be observed again.</p></section>
    <section v-if="view==='settings'" class="workspace-panel"><h2>Connection & execution</h2><p>Wallet network: {{ wallet.networkLabel.value }}</p><p>Wallet provider: Meteor</p><p>Live execution: {{ liveEnabled?'Enabled':'Disabled' }}</p><p>Spending limits, asset permissions, and authorization expiry are managed in Agents & Policies.</p></section>
    <div v-if="!wallet.session.value" class="workspace-panel"><ShieldCheck :size="32"/><h2>Connect your wallet to begin</h2><p>Verify ownership to create agents and manage your spending policies.</p><button class="workspace-button" @click="wallet.openDialog">Connect wallet</button></div>
    <template v-else>
      <div v-if="error" class="workspace-error" role="alert">{{ error }} <button @click="error=''">Dismiss</button></div>
      <p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>
      <p v-if="loading" role="status"><LoaderCircle class="loading-icon" :size="16"/> Loading your workspace…</p>
      <div class="workspace-toolbar"><label>Agent<select v-model="selectedAgent" :disabled="busy"><option value="">Choose an agent</option><option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }} · {{ agent.status }}</option></select></label><span v-if="activeAgent?.busy" class="workspace-badge">Operation awaiting confirmation</span><span class="workspace-badge">{{ liveEnabled?'Live execution enabled':'Preview mode · execution disabled' }}</span></div>
      <template v-if="view==='agents'">
        <div class="workspace-grid">
          <form class="workspace-panel" @submit.prevent="addAgent"><h2><Bot :size="20"/> Create an agent</h2><p>Start with one asset pair and explicit spending limits.</p>
            <label>Agent name<input v-model="name" required maxlength="100" placeholder="My trading agent" :disabled="busy"/></label>
            <label>Source asset<select v-model="source" required :disabled="busy"><option value="">Choose source</option><option v-for="token in tokens" :key="token.asset_id" :value="token.asset_id">{{ token.symbol }} · {{ token.blockchain }} · {{ token.asset_id }}</option></select></label>
            <label>Destination asset<select v-model="destination" required :disabled="busy"><option value="">Choose destination</option><option v-for="token in tokens" :key="token.asset_id" :value="token.asset_id">{{ token.symbol }} · {{ token.blockchain }} · {{ token.asset_id }}</option></select></label>
            <div class="workspace-grid"><label>Maximum per swap<input v-model="perSwap" required inputmode="decimal" placeholder="e.g. 10" :disabled="busy"/></label><label>Limit per 24 hours<input v-model="daily" required inputmode="decimal" placeholder="e.g. 30" :disabled="busy"/></label></div>
            <label>Agent balance<select v-model="balanceSource" :disabled="busy"><option value="public">Public</option><option value="confidential">Confidential</option></select></label>
            <label class="workspace-check"><input v-model="requiresApproval" type="checkbox" :disabled="busy"/> Require owner approval for each swap</label>
            <button class="workspace-button" :disabled="busy||!tokens.length"><Plus :size="16"/> Prepare agent for signing</button>
            <button v-if="activePolicy" class="workspace-button secondary" type="button" :disabled="busy||activeAgent?.busy" @click="savePolicy">Prepare policy update</button>
          </form>
          <div class="workspace-panel"><h2>Current policy & authorization</h2><template v-if="detail">
            <p><strong>{{ detail.agent.name }}</strong> · {{ detail.agent.status }}</p>
            <template v-if="activePolicy"><p>Policy version {{ activePolicy.version }} · {{ activePolicy.balanceSource }} balance</p><p>Sell: {{ activePolicy.allowedSourceAssets.map(label).join(', ') }}</p><p>Buy: {{ activePolicy.allowedDestinationAssets.map(label).join(', ') }}</p><p v-for="limit in activePolicy.spendingLimits" :key="limit.assetId">Per swap {{ format(limit.maxPerOperationBaseUnits,limit.assetId) }} · per 24h {{ format(limit.dailyLimitBaseUnits,limit.assetId) }}</p><p>{{ activePolicy.requiresUserApproval?'Owner approval required':'Owner approval optional; risk warnings still require review' }}</p><button class="workspace-button secondary" :disabled="busy" @click="editPolicy">Load policy into form</button></template>
            <p v-else>Agent policy awaits signing and provider confirmation.</p>
            <form v-if="detail.agent.status==='ACTIVE'" @submit.prevent="authorize"><label>Authorization label<input v-model="grantLabel" required maxlength="64" :disabled="busy"/></label><label>Expires in (hours)<input v-model.number="grantHours" type="number" min="1" max="8760" required :disabled="busy"/></label><button class="workspace-button" :disabled="busy||detail.agent.busy">Prepare authorization</button></form>
            <div v-for="grant in detail.grants" :key="grant.id" class="workspace-record"><p>Authorization · {{ grant.status }} · policy v{{ grant.policyVersion }}</p><p>Expires {{ time(grant.expiresAt) }}</p><button v-if="grant.status!=='REVOKED'" class="workspace-button secondary" :disabled="busy" @click="revoke(grant.id)">Revoke authorization</button></div>
            <h3>Owner authorizations</h3><div v-for="intent in detail.intents" :key="intent.id" class="workspace-record"><button class="workspace-link" @click="review=intent">{{ intent.type.replaceAll('_',' ') }} · {{ intent.status }}</button></div>
          </template><p v-else>Select an agent to view its policy and authorizations.</p></div>
        </div>
      </template>
      <section v-if="view==='swaps'&&activeAgent" class="workspace-panel"><h2>Agent available balance</h2><p v-if="!balances.length">No funded balance is available. Fund the agent through the provider’s deposit workflow before requesting a swap.</p><p v-for="balance in balances" :key="balance.asset_id">{{ label(balance.asset_id) }}: {{ format(balance.available_raw,balance.asset_id) }} available</p></section>
      <form v-if="view==='swaps'" class="workspace-panel" @submit.prevent="quote"><h2><ArrowLeftRight :size="20"/> Request a swap preview</h2><p>Funds come from your agent’s balance. A preview moves no funds.</p>
        <div class="workspace-grid"><label>Sell<select v-model="source" required :disabled="busy"><option value="">Choose source</option><option v-for="id in activePolicy?.allowedSourceAssets??[]" :key="id" :value="id">{{ label(id) }}</option></select></label><label>Buy<select v-model="destination" required :disabled="busy"><option value="">Choose destination</option><option v-for="id in activePolicy?.allowedDestinationAssets??[]" :key="id" :value="id">{{ label(id) }}</option></select></label><label>Amount to sell<input v-model="amount" required inputmode="decimal" :disabled="busy" placeholder="e.g. 5"/></label><label>Minimum amount to receive<input v-model="minimum" required inputmode="decimal" :disabled="busy" placeholder="Your required minimum"/></label></div><button class="workspace-button" :disabled="busy||!activePolicy">Get preview & risk assessment</button>
      </form>
      <section v-if="view==='swaps'||view==='activity'" class="workspace-panel"><h2>Swap history & approvals</h2><p v-if="!rows.length">No swaps yet. Create and authorize an agent, then request a preview.</p>
        <article v-for="row in rows" :key="row.id" class="workspace-operation"><div class="section-heading"><h3>{{ row.request }}</h3><span class="workspace-badge" :class="row.operation.executionStatus.toLowerCase()">{{ row.operation.executionStatus.replaceAll('_',' ') }}</span></div>
          <div class="workspace-grid"><p>Sell <strong>{{ format(row.operation.inputAmountBaseUnits,row.operation.inputAssetId) }}</strong></p><p>Minimum receive <strong>{{ format(row.operation.minimumOutputAmountBaseUnits,row.operation.outputAssetId) }}</strong></p><p>Estimated receive {{ format(row.operation.quote?.estimatedOutputAmountBaseUnits,row.operation.outputAssetId) }}</p><p>Fee {{ row.operation.quote?.feeUsd?'$'+row.operation.quote.feeUsd:'Unavailable' }} <span v-if="row.operation.quote?.feePercent">({{ row.operation.quote.feePercent }}%)</span></p></div>
          <p>Policy v{{ row.operation.policyVersion }} · {{ row.operation.balanceSource }} balance · {{ time(row.createdAt) }}</p>
          <p v-if="row.operation.quote">Review expires {{ time(row.operation.quote.reviewExpiresAt) }}<span v-if="!row.operation.quote.expiresAt"> · Provider quote expiry unavailable</span></p>
          <p v-if="row.risk"><strong>NEAR AI: {{ row.risk.status }} · {{ row.risk.score }}/100</strong> — {{ row.risk.message }}</p><p v-else>Risk assessment unavailable. Execution is held.</p>
          <ul v-if="row.risk?.reasons.length"><li v-for="reason in row.risk.reasons" :key="reason">{{ reason }}</li></ul><ul v-if="row.operation.decisionReasons.length"><li v-for="reason in row.operation.decisionReasons" :key="reason">{{ reason }}</li></ul><ul v-if="row.operation.quote?.warnings.length"><li v-for="warning in row.operation.quote.warnings" :key="warning">{{ warning }}</li></ul>
          <p v-if="row.operation.actualOutputAmountBaseUnits">Received: {{ format(row.operation.actualOutputAmountBaseUnits,row.operation.outputAssetId) }}</p><p v-if="row.operation.transactionHash">Transaction hash: <code>{{ row.operation.transactionHash }}</code></p><p v-if="row.operation.correlationId">Tracking ID: <code>{{ row.operation.correlationId }}</code></p><p v-if="row.operation.providerErrorCode">{{ row.operation.providerErrorCode }}</p>
          <div class="workspace-actions">
            <template v-if="row.operation.executionStatus==='PENDING_APPROVAL'&&!row.operation.submittedAt"><button class="workspace-button" :disabled="busy" @click="operationAction(row,'approve')">Approve this preview</button><button class="workspace-button secondary" :disabled="busy" @click="operationAction(row,'reject')">Reject</button></template>
            <button v-if="row.operation.executionStatus==='DRAFT'" class="workspace-button" :disabled="busy||!liveEnabled" @click="operationAction(row,'execute')">Execute reviewed swap</button>
            <button v-if="!row.operation.submittedAt&&['DRAFT','PENDING_APPROVAL','NEEDS_REVIEW'].includes(row.operation.executionStatus)" class="workspace-button secondary" :disabled="busy" @click="operationAction(row,'refresh')">Refresh preview</button>
            <template v-if="row.operation.submittedAt&&row.operation.executionStatus==='PENDING_APPROVAL'&&row.operation.providerApprovalId"><button class="workspace-button" :disabled="busy" @click="vote(row,'approve')">Review wallet approval</button><button class="workspace-button secondary" :disabled="busy" @click="vote(row,'reject')">Prepare wallet rejection</button></template>
            <button v-if="row.operation.submittedAt&&['PENDING','UNCERTAIN','PENDING_APPROVAL'].includes(row.operation.executionStatus)" class="workspace-button secondary" :disabled="busy" @click="operationAction(row,'reconcile')">Check original swap</button>
            <button v-if="row.operation.submittedAt&&row.operation.executionStatus==='NEEDS_REVIEW'" class="workspace-button secondary" :disabled="busy" @click="operationAction(row,'review')">Observe after provider resolution</button>
          </div><p v-if="row.operation.submittedAt&&!row.operation.correlationId">The dispatch outcome is unknown. This agent is held; recovery must use the original request and idempotency key.</p>
        </article>
      </section>
      <section v-if="review" class="workspace-panel workspace-review"><div class="section-heading"><h2>Review owner authorization</h2><button class="workspace-button secondary" :disabled="busy" @click="review=null">Close review</button></div><p>{{ review.type.replaceAll('_',' ') }} · {{ review.status }}</p>
        <template v-if="review.generated"><p>{{ review.generated.preview.summary }}</p><p>Signing account: <strong>{{ review.generated.signer.account_id }}</strong> · Mainnet</p><p>Expires {{ time(review.expiresAt) }}</p><p>This wallet signature authorizes the action described below. Read the exact message before approving it in Meteor.</p><pre>{{ review.generated.intent.payload.message }}</pre><p>Recipient: {{ review.generated.intent.payload.recipient }}</p><details><summary>Full signing payload</summary><pre>{{ JSON.stringify(review.generated.intent.payload,null,2) }}</pre></details>
          <button v-if="review.status==='PENDING_SIGNATURE'&&!review.hasSubmission" class="workspace-button" :disabled="busy" @click="sign">Review & sign in Meteor</button><button v-if="review.status==='PENDING_SIGNATURE'&&!review.hasSubmission" class="workspace-button secondary" :disabled="busy" @click="cancel">Cancel unsigned authorization</button><button v-if="review.hasSubmission&&['PENDING_SIGNATURE','SUBMITTING','UNCERTAIN'].includes(review.status)" class="workspace-button secondary" :disabled="busy" @click="resubmit">Recover original signed submission</button>
        </template><p v-if="review.failureCode">{{ review.failureCode }}</p><button v-if="!['SUCCESS','FAILED','PENDING_SIGNATURE'].includes(review.status)" class="workspace-button secondary" :disabled="busy" @click="checkIntent(review,review.status==='NEEDS_REVIEW')">{{ review.generated?'Check original authorization':'Retry preparation with original request' }}</button>
      </section>
      <p v-if="busy" class="workspace-notice" role="status"><LoaderCircle class="loading-icon" :size="16"/> Waiting for the current action to complete…</p>
    </template>
  </div>
</template>
