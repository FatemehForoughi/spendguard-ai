import { test, expect } from '@playwright/test'

for (const transport of ['extension', 'web popup']) {
test(`the actual Meteor SDK signs the reviewed challenge through ${transport}, without ordinary sign-in or local keys`, async ({ page, context }, testInfo) => {
  const challenge = {
    challengeId: '23bf9199-0ae7-4021-9e29-fb7b1b0f1672', accountId: 'alice.near', networkId: 'mainnet',
    message: 'SpendGuard ownership proof\nThis message does not authorize spending.', recipient: new URL(testInfo.project.use.baseURL).host,
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
          accountId: data.inputs.accountId, message: data.inputs.message, recipient: data.inputs.recipient, nonce: Array.from(data.inputs.nonce), state: data.inputs.state })
        if (data.inputs.accountId !== undefined) {
          setTimeout(() => listener({ uid: data.uid, status: 'closed_fail', endTags: ['NO_ACCOUNTS'] }), 0)
          return
        }
        setTimeout(() => listener({ uid: data.uid, status: 'closed_success', payload: {
          accountId: 'alice.near', publicKey: 'ed25519:' + '1'.repeat(32), signature: 'A'.repeat(86) + '==', state: data.inputs.state,
        } }), 0)
      },
    }
  })
  else await context.route('https://wallet.meteorwallet.app/**', (route) => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><title>Mock Meteor ownership signature</title>
    <button id="unlock">Unlock Meteor</button><button id="approve" hidden>Approve ownership message</button><script>
      let handled = false;
      let pending;
      let sourceOrigin;
      window.addEventListener('message', async (event) => {
        const data = event.data;
        if (handled || !data.inputs || data.actionType !== 'sign_message') return;
        handled = true;
        pending = data;
        sourceOrigin = event.origin;
        await window.__recordWalletAction({ actionType: data.actionType, network: data.network,
          accountId: data.inputs.accountId, message: data.inputs.message, recipient: data.inputs.recipient, nonce: Array.from(data.inputs.nonce), state: data.inputs.state });
        if (data.inputs.accountId !== undefined) window.opener.postMessage({ uid: data.uid, status: 'closed_fail', endTags: ['NO_ACCOUNTS'] }, event.origin);
      });
      document.getElementById('unlock').onclick = () => {
        document.getElementById('unlock').hidden = true;
        document.getElementById('approve').hidden = false;
      };
      document.getElementById('approve').onclick = () => {
        if (!pending || pending.inputs.accountId !== undefined) return;
        window.opener.postMessage({ uid: pending.uid, status: 'closed_success', payload: {
          accountId: 'alice.near', publicKey: 'ed25519:' + '1'.repeat(32), signature: 'A'.repeat(86) + '==', state: pending.inputs.state
        } }, sourceOrigin);
      };
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
  const popupOpened = transport === 'web popup' ? page.waitForEvent('popup') : null
  await page.getByRole('button', { name: 'Sign & verify in Meteor' }).click()
  if (popupOpened) {
    const popup = await popupOpened
    await popup.getByRole('button', { name: 'Unlock Meteor' }).click()
    await expect(page.getByRole('button', { name: 'Waiting for approval in Meteor…' })).toBeVisible()
    expect(submitted).toBeUndefined()
    await expect.poll(() => walletActions.length).toBe(1)
    await popup.getByRole('button', { name: 'Approve ownership message' }).click()
  }
  await expect(page.getByRole('heading', { name: 'alice.near' })).toBeVisible()
  expect(submitted).toMatchObject({ challengeId: challenge.challengeId, accountId: 'alice.near' })
  expect(walletActions).toEqual([{
    actionType: 'sign_message', network: 'mainnet', accountId: undefined, message: challenge.message, recipient: challenge.recipient,
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

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
test(`the dialog is centered at ${viewport.width}px and a startup 502 offers connection retry`, async ({ page }) => {
  await page.setViewportSize(viewport)
  let available = false
  let challenges = 0
  await page.route('**/api/wallet/config', (route) => route.fulfill({ json: { success: true, data: {
    networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300,
  } } }))
  await page.route('**/api/auth/session', (route) => available
    ? route.fulfill({ json: { success: true, data: null } })
    : route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' }))
  await page.route('**/api/wallet/challenges', (route) => { challenges++; return route.abort() })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Wallet connection unavailable' })).toBeVisible()
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Retry connection' })).toBeEnabled()
  await expect(dialog.locator('.wallet-error')).toHaveCount(0)
  await expect(page.getByLabel('NEAR account ID')).toHaveValue('')
  const bounds = await dialog.boundingBox()
  expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2)
  expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  await page.getByLabel('NEAR account ID').fill('alice.near')
  await expect(page.getByRole('button', { name: 'Review ownership message' })).toBeDisabled()
  expect(challenges).toBe(0)
  available = true
  await dialog.getByRole('button', { name: 'Retry connection' }).click()
  await expect(dialog.locator('.wallet-service-notice')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review ownership message' })).toBeEnabled()
  await expect(page.getByLabel('NEAR account ID')).toHaveValue('alice.near')
})
}

for (const [tag, message] of [
  ['NO_ACCOUNTS', 'Meteor could not find an account on NEAR Mainnet. Open wallet.meteorwallet.app in this same browser profile, unlock your account, then start verification again.'],
  ['POPUP_WINDOW_OPEN_FAILED', 'Allow pop-ups for SpendGuard, then start wallet verification again.'],
]) {
test(`Meteor ${tag} produces an actionable error without submitting a proof`, async ({ page }, testInfo) => {
  let proofs = 0
  await page.route('**/api/wallet/config', route => route.fulfill({ json: { success: true, data: {
    networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300,
  } } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { success: true, data: null } }))
  await page.route('**/api/wallet/challenges', route => route.fulfill({ json: { success: true, data: {
    challengeId: '23bf9199-0ae7-4021-9e29-fb7b1b0f1672', accountId: 'alice.near', networkId: 'mainnet',
    message: 'Ownership proof', recipient: new URL(testInfo.project.use.baseURL).host,
    nonce: Buffer.alloc(32).toString('base64'), expiresAt: new Date(Date.now() + 300_000).toISOString(),
  } } }))
  await page.route('**/api/wallet/verify', route => { proofs++; return route.abort() })
  await page.addInitScript(tag => {
    let listener
    const handled = new Set()
    window.meteorCom = {
      addMessageDataListener(callback) { listener = callback },
      sendMessageData(data) {
        if (!data.inputs || handled.has(data.uid)) return
        handled.add(data.uid)
        setTimeout(() => listener({ uid: data.uid, status: 'closed_fail', endTags: [tag] }), 0)
      },
    }
  }, tag)
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).first().click()
  await page.getByLabel('NEAR account ID').fill('alice.near')
  await page.getByRole('button', { name: 'Review ownership message' }).click()
  await page.getByRole('button', { name: 'Sign & verify in Meteor' }).click()
  await expect(page.getByRole('alert')).toHaveText(message)
  await expect(page.getByRole('button', { name: 'Review ownership message' })).toBeEnabled()
  expect(proofs).toBe(0)
})
}

test('letting Meteor choose an account still rejects a different account before submitting a proof', async ({ page }, testInfo) => {
  let proofs = 0
  await page.route('**/api/wallet/config', route => route.fulfill({ json: { success: true, data: {
    networkId: 'mainnet', walletProvider: 'meteor-wallet', challengeLifetimeSeconds: 300,
  } } }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { success: true, data: null } }))
  await page.route('**/api/wallet/challenges', route => route.fulfill({ json: { success: true, data: {
    challengeId: '23bf9199-0ae7-4021-9e29-fb7b1b0f1672', accountId: 'alice.near', networkId: 'mainnet',
    message: 'Ownership proof for alice.near', recipient: new URL(testInfo.project.use.baseURL).host,
    nonce: Buffer.alloc(32).toString('base64'), expiresAt: new Date(Date.now() + 300_000).toISOString(),
  } } }))
  await page.route('**/api/wallet/verify', route => { proofs++; return route.abort() })
  await page.addInitScript(() => {
    let listener
    const handled = new Set()
    window.meteorCom = {
      addMessageDataListener(callback) { listener = callback },
      sendMessageData(data) {
        if (!data.inputs || handled.has(data.uid)) return
        handled.add(data.uid)
        setTimeout(() => listener({ uid: data.uid, status: 'closed_success', payload: {
          accountId: 'bob.near', publicKey: 'ed25519:' + '1'.repeat(32), signature: 'A'.repeat(86) + '==', state: data.inputs.state,
        } }), 0)
      },
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).first().click()
  await page.getByLabel('NEAR account ID').fill('alice.near')
  await page.getByRole('button', { name: 'Review ownership message' }).click()
  await page.getByRole('button', { name: 'Sign & verify in Meteor' }).click()
  await expect(page.getByRole('alert')).toHaveText('Meteor signed with a different account. Select alice.near and start again.')
  await expect(page.getByRole('button', { name: 'Review ownership message' })).toBeEnabled()
  expect(proofs).toBe(0)
})
