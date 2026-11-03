
<script setup lang="ts">
import {
  ShieldCheck,
  LayoutDashboard,
  ArrowLeftRight,
  History,
  Settings,
  CircleHelp,
} from 'lucide-vue-next'

const menuItems = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Transactions', icon: ArrowLeftRight },
  { label: 'Activity Logs', icon: History },
]
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-icon">
        <ShieldCheck :size="24" />
      </div>
      <span>SpendGuard<span class="brand-ai"> AI</span></span>
    </div>

    <div class="sidebar-section">
      <p class="sidebar-label">WORKSPACE</p>

      <button
        v-for="(item, index) in menuItems"
        :key="item.label"
        class="nav-item"
        :class="{ active: index === 0 }"
      >
        <component :is="item.icon" :size="19" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="sidebar-bottom">
      <button class="nav-item">
        <Settings :size="19" />
        <span>Settings</span>
      </button>

      <button class="nav-item">
        <CircleHelp :size="19" />
        <span>Help & Support</span>
      </button>

      <div class="network-card">
        <span class="network-dot"></span>
        <div>
          <p>Network</p>
          <strong>Testnet Mode</strong>
        </div>
      </div>
    </div>
  </aside>
</template>
