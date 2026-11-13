<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { LoaderCircle, ShieldCheck, Wallet, X } from 'lucide-vue-next'
import { useWallet } from '../composables/useWallet'

const { session, challenge, accountId, dialogOpen, busy, error, connectionError, ready, networkLabel,
  initialize, closeDialog, prepareChallenge, verifyChallenge, disconnect } = useWallet()
const dialog = ref<HTMLDialogElement | null>(null)
const expiryLabel = computed(() => challenge.value ? new Date(challenge.value.expiresAt).toLocaleTimeString() : '')
let previousFocus: HTMLElement | null = null
watch(dialogOpen, async (open) => {
  await nextTick()
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value?.showModal()
  } else {
    dialog.value?.close()
    previousFocus?.focus()
  }
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="wallet-dialog" aria-labelledby="wallet-dialog-title" @cancel.prevent="closeDialog">
    <div class="wallet-dialog-heading">
      <div class="wallet-icon"><Wallet :size="24" /></div>
      <div><p class="header-eyebrow">{{ networkLabel }}</p><h2 id="wallet-dialog-title">{{ session ? 'Your wallet' : 'Connect your wallet' }}</h2></div>
      <button class="icon-button" aria-label="Close wallet dialog" :disabled="!!busy" @click="closeDialog"><X :size="18" /></button>
    </div>

    <div v-if="session" class="wallet-verified-summary">
      <ShieldCheck :size="20" /><div><strong>{{ session.wallet.address }}</strong><p>Ownership verified</p></div>
      <button class="reset-button" :disabled="!!busy" @click="disconnect">{{ busy === 'disconnecting' ? 'Disconnecting…' : 'Disconnect' }}</button>
    </div>

    <template v-if="challenge">
      <p class="wallet-explanation">Review this ownership message, then unlock Meteor Wallet, select <strong>{{ challenge.accountId }}</strong>, and approve the message. Unlocking your wallet alone does not complete verification.</p>
      <pre class="wallet-proof-message">{{ challenge.message }}</pre>
      <dl class="wallet-proof-details"><dt>Recipient</dt><dd>{{ challenge.recipient }}</dd><dt>Expires</dt><dd>{{ expiryLabel }}</dd><dt>Nonce</dt><dd class="wallet-nonce">{{ challenge.nonce }}</dd></dl>
      <button class="wallet-primary-button" :disabled="!!busy || !ready" @click="verifyChallenge">
        <LoaderCircle v-if="busy === 'signing' || busy === 'verifying'" class="loading-icon" :size="18" />
        {{ busy === 'signing' ? 'Waiting for approval in Meteor…' : busy === 'verifying' ? 'Verifying wallet ownership…' : 'Sign & verify in Meteor' }}
      </button>
    </template>
    <form v-else @submit.prevent="prepareChallenge">
      <p class="wallet-explanation">{{ session ? 'You can link another NEAR wallet to this SpendGuard account.' : 'Verify your NEAR account with an ownership message signed in Meteor Wallet.' }}</p>
      <label class="wallet-account-label" for="wallet-account">NEAR account ID</label>
      <input id="wallet-account" v-model="accountId" class="wallet-account-input" placeholder="user.near" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" :disabled="!!busy" required />
      <p class="wallet-explanation wallet-small">Entering an address does not verify ownership. Choose the same account in Meteor when signing.</p>
      <button class="wallet-primary-button" :disabled="!!busy || !ready || !accountId.trim()">
        <LoaderCircle v-if="busy" class="loading-icon" :size="18" />
        {{ busy === 'preparing' ? 'Preparing verification…' : 'Review ownership message' }}
      </button>
    </form>
    <div v-if="connectionError" class="wallet-service-notice" role="status">
      <p>{{ connectionError }}</p>
      <button type="button" class="reset-button" :disabled="!!busy" @click="initialize">Retry connection</button>
    </div>
    <p v-if="error" class="wallet-error" role="alert">{{ error }}</p>
    <p class="wallet-security-note">Your private keys stay in your wallet. This step does not authorize spending or send a transaction.</p>
    <a href="https://wallet.meteorwallet.app" target="_blank" rel="noopener noreferrer" class="wallet-provider-link">Open Meteor Wallet</a>
  </dialog>
</template>
