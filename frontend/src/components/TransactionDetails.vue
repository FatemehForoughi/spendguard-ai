
<script setup lang="ts">
import { ArrowRight, Coins, Network, UserRound } from 'lucide-vue-next'
import type { TransactionDetails } from '../types/transaction'

defineProps<{
  details: TransactionDetails
}>()
</script>

<template>
  <section class="details-card">
    <h3>Transaction Details</h3>

    <div class="detail-row">
      <div class="detail-icon"><Coins :size="18" /></div>
      <div class="detail-content">
        <span>Amount</span>
        <strong>
          {{ details.amount ?? 'Not detected' }}
          {{ details.asset ?? '' }}
        </strong>
      </div>
    </div>

    <div class="detail-row">
      <div class="detail-icon"><Network :size="18" /></div>
      <div class="detail-content">
        <span>Network route</span>
        <strong class="network-route">
          {{ details.sourceNetwork ?? 'Unknown' }}
          <ArrowRight :size="15" />
          {{ details.destinationNetwork ?? 'Unknown' }}
        </strong>
      </div>
    </div>

    <div class="detail-row">
      <div class="detail-icon"><UserRound :size="18" /></div>
      <div class="detail-content">
        <span>Recipient address</span>
        <strong class="recipient-address">
          {{ details.recipient ?? 'Not provided' }}
        </strong>
      </div>
    </div>
  </section>
</template>
