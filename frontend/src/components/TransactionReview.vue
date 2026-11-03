
<script setup lang="ts">
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  CheckCircle2,
} from 'lucide-vue-next'

import { computed } from 'vue'

import type { TransactionAnalysis } from '../types/transaction'
import TransactionDetails from './TransactionDetails.vue'
import TransactionApproval from './TransactionApproval.vue'

const emit = defineEmits<{
  reset: []
  approve: [fingerprint: string]
}>()

const props = defineProps<{
  analysis: TransactionAnalysis
}>()

const fingerprint = computed(() =>
  JSON.stringify({
    request: props.analysis.request,
    details: props.analysis.details,
  }),
)

const canApprove = computed(() => {
  const details = props.analysis.details

  return Boolean(
    details.amount &&
    details.asset &&
    details.sourceNetwork &&
    details.destinationNetwork &&
    details.recipient,
  )
})
</script>

<template>
  <section class="review-card">
    <div class="review-heading">
      <div>
        <h2>Security Analysis</h2>
        <p>SpendGuard AI transaction assessment</p>
      </div>

      <span class="status-badge" :class="analysis.status.toLowerCase()">
        <ShieldCheck v-if="analysis.status === 'ALLOW'" :size="16" />
        <ShieldAlert v-else-if="analysis.status === 'WARN'" :size="16" />
        <ShieldX v-else :size="16" />
        {{ analysis.status }}
      </span>
    </div>

    <div class="review-request">
      <span class="review-label">YOUR REQUEST</span>
      <p>{{ analysis.request }}</p>
    </div>

    <TransactionDetails :details="analysis.details" />

    <div class="review-message">
      <div class="message-icon">
        <CheckCircle2 v-if="analysis.status === 'ALLOW'" />
        <ShieldAlert v-else-if="analysis.status === 'WARN'" />
        <ShieldX v-else />
      </div>

      <div>
        <h3>{{ analysis.message }}</h3>
        <p>Based on the current demo security rules.</p>
      </div>
    </div>

    <div class="risk-reasons">
      <h3>Analysis details</h3>
      <ul>
        <li v-for="reason in analysis.reasons" :key="reason">
          {{ reason }}
        </li>
      </ul>
    </div>

    <TransactionApproval
      :transaction-fingerprint="fingerprint"
      :can-approve="canApprove"
      :blocked="analysis.status === 'BLOCK'"
      @approve="emit('approve', $event)"
    />

    <div class="review-footer">
      <div class="analysis-time">
        <Clock :size="15" />
        {{ new Date(analysis.createdAt).toLocaleString() }}
      </div>

      <button class="reset-button" @click="emit('reset')">
        New request
      </button>
    </div>

    <p class="review-disclaimer">
      Demo only. This analysis does not verify a real blockchain
      transaction or authorize wallet execution.
    </p>
  </section>
</template>
