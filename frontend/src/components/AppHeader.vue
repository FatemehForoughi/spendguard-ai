
<script setup lang="ts">
import { Bell, Wallet } from 'lucide-vue-next'
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
        Testnet
      </div>

      <button class="icon-button" aria-label="Notifications">
        <Bell :size="19" />
      </button>

      <button class="connect-button">
        <Wallet :size="18" />
        Connect Wallet
      </button>
    </div>
  </header>
</template>
