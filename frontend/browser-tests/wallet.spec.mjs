import { test, expect } from '@playwright/test'

for (const transport of ['extension', 'web popup']) {
test(`the actual Meteor SDK signs the reviewed challenge through ${transport}, without ordinary sign-in or local keys`, async ({ page, context }) => {
  const challenge = {
    challengeId: '23bf9199-0ae7-4021-9e29-fb7b1b0f1672', accountId: 'alice.near', networkId: 'mainnet',
    message: 'SpendGuard ownership proof\nThis message does not authorize spending.', recipient: '127.0.0.1:5173',
    nonce: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64'), expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }
  const verifiedSession = { user: { id: 'user-one' }, wallet: { id: 'wallet-one', address: 'alice.near', network: 'near:mainnet',
    verificationStatus: 'VERIFIED', verifiedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
  let session = null
  let submitted
  const walletActions = []
  await context.exposeFunction('__recordWalletAction', (action) => { walletActions.push(action) })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data
    if (path === '/api/wallet/config') data = { networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300 }
    else if (path === '/api/auth/session') data = session
    else if (path === '/api/wallet/challenges') {
      expect(route.request().postDataJSON()).toEqual({ accountId: 'alice.near' })
      data = challenge
    } else if (path === '/api/wallet/verify') {
      submitted = route.request().postDataJSON()
      session = verifiedSession
      data = session
    } else if (path === '/api/auth/logout') { session = null; data = null }
    else return route.fulfill({ status: 404, json: { success: false } })
    await route.fulfill({ status: 200, json: { success: true, data } })
  })
  if (transport === 'extension') await page.addInitScript(() => {
    let listener
    const handled = new Set()
    window.meteorCom = {
      addMessageDataListener(callback) { listener = callback },
      sendMessageData(data) {
        if (!data.inputs || handled.has(data.uid)) return
        handled.add(data.uid)
        window.__recordWalletAction({ actionType: data.actionType, network: data.network,
          message: data.inputs.message, recipient: data.inputs.recipient, nonce: Array.from(data.inputs.nonce), state: data.inputs.state })
        setTimeout(() => listener({ uid: data.uid, status: 'closed_success', payload: {
          accountId: 'alice.near', publicKey: 'ed25519:' + '1'.repeat(32), signature: 'A'.repeat(86) + '==', state: data.inputs.state,
        } }), 0)
      },
    }
  })
  else await context.route('https://wallet.meteorwallet.app/**', (route) => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><title>Mock Meteor ownership signature</title><script>
      let handled = false;
      window.addEventListener('message', async (event) => {
        const data = event.data;
        if (handled || !data.inputs || data.actionType !== 'sign_message') return;
        handled = true;
        await window.__recordWalletAction({ actionType: data.actionType, network: data.network,
          message: data.inputs.message, recipient: data.inputs.recipient, nonce: Array.from(data.inputs.nonce), state: data.inputs.state });
        window.opener.postMessage({ uid: data.uid, status: 'closed_success', payload: {
          accountId: 'alice.near', publicKey: 'ed25519:' + '1'.repeat(32), signature: 'A'.repeat(86) + '==', state: data.inputs.state
        } }, event.origin);
      });
    </script>`,
  }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No verified wallet connected' })).toBeVisible()
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).first().click()
  await page.getByLabel('NEAR account ID').fill('alice.near')
  await page.getByRole('button', { name: 'Review ownership message' }).click()
  await expect(page.locator('.wallet-proof-message')).toHaveText(challenge.message)
  await expect(page.getByRole('button', { name: 'Sign & verify in Meteor' })).toBeEnabled()
  expect(submitted).toBeUndefined()
  await page.getByRole('button', { name: 'Sign & verify in Meteor' }).click()
  await expect(page.getByRole('heading', { name: 'alice.near' })).toBeVisible()
  expect(submitted).toMatchObject({ challengeId: challenge.challengeId, accountId: 'alice.near' })
  expect(walletActions).toEqual([{
    actionType: 'sign_message', network: 'mainnet', message: challenge.message, recipient: challenge.recipient,
    nonce: Array.from({ length: 32 }, (_, i) => i), state: challenge.challengeId,
  }])
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) =>
    /keystore|private|secret|pending_key/.test(key) || /ed25519:/.test(value)))).toBe(false)
  expect(browserErrors).toEqual([])
  await page.getByRole('button', { name: 'Manage wallet' }).click()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No verified wallet connected' })).toBeVisible()
})
}

test('an unavailable verification service leaves the UI unverified and offers a fresh challenge', async ({ page }) => {
  await page.route('**/api/wallet/config', (route) => route.fulfill({ json: { success: true, data: { networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300 } } }))
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { success: true, data: null } }))
  await page.route('**/api/wallet/challenges', (route) => route.fulfill({ status: 503, json: { success: false, code: 'WALLET_SERVICE_UNAVAILABLE', message: 'Wallet sign-in is unavailable. Please try again.' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).first().click()
  await page.getByLabel('NEAR account ID').fill('alice.near')
  await page.getByRole('button', { name: 'Review ownership message' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wallet sign-in is unavailable. Please try again.')
  await expect(page.getByRole('button', { name: 'Review ownership message' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'No verified wallet connected' })).toBeVisible()
})
