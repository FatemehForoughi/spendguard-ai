<script setup lang="ts">
import { ref } from 'vue'
import { ShieldCheck, Wallet, Activity, AlertTriangle, ArrowUpRight, LoaderCircle } from 'lucide-vue-next'
import TransactionReview from '../components/TransactionReview.vue'
import ErrorNotification from '../components/ErrorNotification.vue'
import { analyzeTransaction as analyzeTransactionApi } from '../services/transaction.api'
import type { TransactionAnalysis } from '../types/transaction'

const requestText = ref('')
const analysis = ref<TransactionAnalysis | null>(null)
const isAnalyzing = ref(false)
const errorMessage = ref<string | null>(null)

const stats = [
  { label: 'Transactions Checked', value: '0', icon: Activity },
  { label: 'Transactions Approved', value: '0', icon: ShieldCheck },
  { label: 'Threats Blocked', value: '0', icon: AlertTriangle },
]

async function analyzeTransaction() {
  if (!requestText.value.trim() || isAnalyzing.value) return

  isAnalyzing.value = true
  analysis.value = null
  errorMessage.value = null

  try {
    analysis.value = await analyzeTransactionApi(requestText.value.trim())
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message : 'We could not analyze this transaction. Please try again.'
  } finally {
    isAnalyzing.value = false
  }
}

function resetAnalysis() {
  analysis.value = null
  requestText.value = ''
}
</script>

<template>
  <div class="dashboard">
    <section class="welcome-section">
      <div>
        <h1>Your wallet security starts here.</h1>
        <p>Let SpendGuard AI analyze your transactions before you approve them.</p>
      </div>
      <div class="security-icon">
        <ShieldCheck :size="42" />
      </div>
    </section>

    <section class="stats-grid">
      <div v-for="stat in stats" :key="stat.label" class="stat-card">
        <div class="stat-top">
          <span>{{ stat.label }}</span>
          <component :is="stat.icon" :size="20" />
        </div>
        <h2>{{ stat.value }}</h2>
        <p>Since account creation</p>
      </div>
    </section>

    <section class="transaction-section">
      <div class="section-heading">
        <div>
          <h2>New Transaction Request</h2>
          <p>Describe what you want to do.</p>
        </div>
        <span class="demo-label">DEMO MODE</span>
      </div>

      <div class="request-box">
        <textarea
          v-model="requestText"
          placeholder="Example: Transfer 100 USDC from Ethereum Sepolia to Aurora Testnet..."
          rows="4"
          maxlength="1000"
          :disabled="isAnalyzing"
        ></textarea>

        <div class="request-footer">
          <span>{{ requestText.length }}/1000 characters</span>
          <button
            class="analyze-button"
            :disabled="!requestText.trim() || isAnalyzing"
            @click="analyzeTransaction"
          >
            <LoaderCircle v-if="isAnalyzing" class="loading-icon" :size="17" />
            <template v-else>
              Analyze Transaction
              <ArrowUpRight :size="17" />
            </template>
          </button>
        </div>
      </div>
    </section>

    <section class="wallet-section">
      <div class="wallet-icon">
        <Wallet :size="24" />
      </div>
      <div>
        <h3>No wallet connected</h3>
        <p>Connect a Testnet wallet to get started.</p>
      </div>
    </section>

    <TransactionReview
      v-if="analysis"
      :analysis="analysis"
      @reset="resetAnalysis"
    />

    <ErrorNotification
      v-if="errorMessage"
      :message="errorMessage"
      :retrying="isAnalyzing"
      @dismiss="errorMessage = null"
      @retry="analyzeTransaction"
    />
  </div>
</template>
