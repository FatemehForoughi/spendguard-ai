<script setup lang="ts">
import { computed } from 'vue'
import { ShieldCheck, ShieldAlert, ShieldX, X } from 'lucide-vue-next'
import type { TransactionAnalysis } from '../types/transaction'

const emit = defineEmits<{
  reset: []
}>()

const props = defineProps<{
  analysis: TransactionAnalysis
}>()

const scoreLabel = computed(() => `${props.analysis.score}%`)
const statusLabel = computed(() => {
  if (props.analysis.status === 'ALLOW') return 'LOW RISK'
  if (props.analysis.status === 'WARN') return 'REVIEW REQUIRED'
  return 'HIGH RISK'
})
</script>

<template>
  <div
    class="risk-modal-backdrop"
    role="presentation"
    @click.self="emit('reset')"
  >
    <section
      class="risk-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risk-modal-title"
    >
      <button
        class="risk-modal-close"
        type="button"
        aria-label="Close analysis"
        @click="emit('reset')"
      >
        <X :size="20" />
      </button>

      <div class="risk-modal-heading">
        <div class="risk-status-icon" :class="analysis.status.toLowerCase()">
          <ShieldCheck v-if="analysis.status === 'ALLOW'" :size="25" />
          <ShieldAlert v-else-if="analysis.status === 'WARN'" :size="25" />
          <ShieldX v-else :size="25" />
        </div>
        <div>
          <p class="risk-modal-eyebrow">SPENDGUARD AI RESULT</p>
          <h2 id="risk-modal-title">Transaction risk analysis</h2>
          <span class="risk-status-text" :class="analysis.status.toLowerCase()">
            {{ statusLabel }}
          </span>
        </div>
      </div>

      <div class="risk-score-panel" :class="analysis.status.toLowerCase()">
        <div class="risk-score-copy">
          <span>Risk score</span>
          <strong>{{ scoreLabel }}</strong>
        </div>
        <div
          class="risk-score-track"
          role="progressbar"
          :aria-valuenow="analysis.score"
          aria-valuemin="1"
          aria-valuemax="100"
          :aria-label="`Risk score ${scoreLabel}`"
        >
          <div
            class="risk-score-fill"
            :style="{ width: `${analysis.score}%` }"
          ></div>
        </div>
        <p>Higher score means higher transaction risk.</p>
      </div>

      <div class="risk-result-message">
        <p>{{ analysis.message }}</p>
      </div>

      <section
        v-if="analysis.reasons.length > 0"
        class="risk-reasons"
        aria-labelledby="risk-reasons-title"
      >
        <h3 id="risk-reasons-title">Risk reasons</h3>
        <ul>
          <li v-for="reason in analysis.reasons" :key="reason">{{ reason }}</li>
        </ul>
      </section>

      <div class="risk-request-preview">
        <span>ANALYZED REQUEST</span>
        <p>{{ analysis.request }}</p>
      </div>

      <button class="risk-modal-done" type="button" @click="emit('reset')">
        Analyze another transaction
      </button>

      <p class="risk-modal-disclaimer">
        Demo only. No blockchain transaction was verified or executed.
      </p>
    </section>
  </div>
</template>
