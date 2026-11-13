<script setup lang="ts">
import { ShieldCheck, Wallet, LoaderCircle } from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet'
const { session, verified, busy, error, connectionError, networkLabel, openDialog, initialize } = useWallet()
</script>

<template>
  <section class="wallet-section" aria-live="polite">
    <div class="wallet-icon"><ShieldCheck v-if="verified" :size="24" /><Wallet v-else :size="24" /></div>
    <div class="wallet-status-copy">
      <template v-if="session && verified"><h3>{{ session.wallet.address }}</h3><p>Ownership verified · {{ networkLabel }}</p></template>
      <template v-else-if="busy === 'loading'"><h3>Checking wallet connection</h3><p>Loading your SpendGuard session…</p></template>
      <template v-else-if="connectionError"><h3>Wallet connection unavailable</h3><p>{{ connectionError }}</p></template>
      <template v-else><h3>No verified wallet connected</h3><p>Connect a {{ networkLabel }} wallet and prove ownership to get started.</p></template>
      <p v-if="error && !session" class="wallet-error">{{ error }}</p>
    </div>
    <button v-if="connectionError" class="reset-button" :disabled="!!busy" @click="initialize">Retry</button>
    <button class="connect-button" :disabled="!!busy" @click="openDialog"><LoaderCircle v-if="busy" class="loading-icon" :size="17" />{{ verified ? 'Manage wallet' : 'Connect wallet' }}</button>
  </section>
</template>
