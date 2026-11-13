
<script setup lang="ts">
import {
  ShieldCheck,
  LayoutDashboard,
  ArrowLeftRight,
  History,
  Settings,
  CircleHelp,
} from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet'
const { networkLabel } = useWallet()
defineProps<{ activeView: string }>()
const emit=defineEmits<{navigate:[view:string]}>()

const menuItems = [
  { label: 'Dashboard', icon: LayoutDashboard, view:'dashboard' },
  { label: 'Agents & Policies', icon: ShieldCheck, view:'agents' },
  { label: 'Swaps', icon: ArrowLeftRight, view:'swaps' },
  { label: 'Activity Logs', icon: History, view:'activity' },
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
        v-for="item in menuItems"
        :key="item.label"
        class="nav-item"
        :class="{ active: activeView === item.view }"
        @click="emit('navigate',item.view)"
        :aria-label="item.label"
        :title="item.label"
      >
        <component :is="item.icon" :size="19" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="sidebar-bottom">
      <button class="nav-item" aria-label="Settings" @click="emit('navigate','settings')">
        <Settings :size="19" />
        <span>Settings</span>
      </button>

      <button class="nav-item" aria-label="Help & Support" @click="emit('navigate','help')">
        <CircleHelp :size="19" />
        <span>Help & Support</span>
      </button>

      <div class="network-card">
        <span class="network-dot"></span>
        <div>
          <p>Network</p>
          <strong>{{ networkLabel }}</strong>
        </div>
      </div>
    </div>
  </aside>
</template>
