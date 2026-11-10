<script setup lang="ts">
import { AlertCircle, RotateCcw, X } from 'lucide-vue-next'

defineProps<{
  message: string
  retrying: boolean
}>()

const emit = defineEmits<{
  dismiss: []
  retry: []
}>()
</script>

<template>
  <aside class="error-notification" role="alert" aria-atomic="true">
    <AlertCircle class="error-notification-icon" :size="23" aria-hidden="true" />
    <div class="error-notification-content">
      <h2>Unable to analyze transaction</h2>
      <p>{{ message }}</p>
      <button class="error-notification-retry" type="button" :disabled="retrying" @click="emit('retry')">
        <RotateCcw :size="14" aria-hidden="true" />
        Try again
      </button>
    </div>
    <button
      class="error-notification-close"
      type="button"
      aria-label="Dismiss notification"
      @click="emit('dismiss')"
    >
      <X :size="18" aria-hidden="true" />
    </button>
  </aside>
</template>
