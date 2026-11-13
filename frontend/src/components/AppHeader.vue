
<script setup lang="ts">
import { Bell, Wallet } from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet'
const { session, verified, busy, networkLabel, openDialog } = useWallet()
</script>

<template>
  <header class="app-header">
    <div>
      <p class="header-eyebrow">SECURITY WORKSPACE</p>
      <h2>Overview</h2>
    </div>

    <div class="header-actions">
      <div class="testnet-badge">
        <span class="network-dot"></span>
        {{ networkLabel }}
      </div>

      <button class="icon-button" aria-label="Notifications">
        <Bell :size="19" />
      </button>

      <button class="connect-button" :disabled="!!busy" @click="openDialog">
        <Wallet :size="18" />
        {{ verified && session ? session.wallet.address : 'Connect Wallet' }}
      </button>
    </div>
  </header>
</template>
