
<script setup lang="ts">
import Sidebar from './components/Sidebar.vue'
import AppHeader from './components/AppHeader.vue'
import DashboardView from './views/DashboardView.vue'
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import AgentWorkspace from './components/AgentWorkspace.vue'
import WalletDialog from './components/WalletDialog.vue'
import { walletKey } from './composables/useWallet'
import { createWalletFlow } from './services/wallet-flow'
import { getWalletChallenge, getWalletConfig, getWalletSession, logoutWallet, submitWalletProof } from './services/wallet.api'
import { prepareMeteorWallet, signWalletChallenge } from './services/meteor-wallet'

const wallet = createWalletFlow({
  getConfig: getWalletConfig, getSession: getWalletSession, getChallenge: getWalletChallenge,
  prepareWallet: prepareMeteorWallet, signChallenge: signWalletChallenge,
  submitProof: submitWalletProof, logout: logoutWallet, host: window.location.host,
})
const activeView=ref('dashboard')
provide(walletKey, wallet)
const refresh = () => { if (document.visibilityState === 'visible') void wallet.refreshSession() }
let sessionTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void wallet.initialize()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  sessionTimer = setInterval(refresh, 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', refresh)
  clearInterval(sessionTimer)
})
</script>

<template>
  <div class="app-layout">
    <Sidebar :active-view="activeView" @navigate="activeView=$event" />

    <main class="main-content">
      <AppHeader />

      <DashboardView v-if="activeView==='dashboard'" @navigate="activeView=$event" />
      <AgentWorkspace v-else :view="activeView" />
    </main>
  </div>
  <WalletDialog />
</template>
