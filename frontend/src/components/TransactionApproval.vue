
<script setup lang="ts">
import { ref, watch } from 'vue'
import { LockKeyhole, ShieldCheck } from 'lucide-vue-next'

const props = defineProps<{
  transactionFingerprint: string
  canApprove: boolean
  blocked: boolean
}>()

const emit = defineEmits<{
  approve: [fingerprint: string]
}>()

const accepted = ref(false)

watch(
  () => props.transactionFingerprint,
  () => {
    accepted.value = false
  },
)

function approveTransaction() {
  if (!props.canApprove || props.blocked || !accepted.value) return

  emit('approve', props.transactionFingerprint)
}
</script>

<template>
  <section class="approval-card">
    <div class="approval-heading">
      <LockKeyhole :size="20" />
      <div>
        <h3>Transaction Approval</h3>
        <p>Review the details before confirming.</p>
      </div>
    </div>

    <label class="approval-checkbox">
      <input
        v-model="accepted"
        type="checkbox"
        :disabled="!canApprove || blocked"
      />

      <span>
        I have reviewed the transaction details and confirm
        that they match my request.
      </span>
    </label>

    <button
      class="approval-button"
      :disabled="!accepted || !canApprove || blocked"
      @click="approveTransaction"
    >
      <ShieldCheck :size="17" />
      Confirm transaction details
    </button>

    <p class="approval-note">
      This is a frontend demonstration. No wallet signature
      or blockchain transaction will be created.
    </p>
  </section>
</template>
