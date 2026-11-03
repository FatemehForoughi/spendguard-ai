
<script setup lang="ts">
import Sidebar from './components/Sidebar.vue'
import AppHeader from './components/AppHeader.vue'
import DashboardView from './views/DashboardView.vue'
</script>

<template>
  <div class="app-layout">
    <Sidebar />

    <main class="main-content">
      <AppHeader />

      <DashboardView />
    </main>
  </div>
</template>
