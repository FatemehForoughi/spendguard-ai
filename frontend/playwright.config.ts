import { defineConfig } from '@playwright/test'

const port = Number(process.env.SPENDGUARD_BROWSER_PORT || 5173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser test port.')
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  use: { baseURL, headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' },
  webServer: {
    command: process.env.SPENDGUARD_BROWSER_BUILD === '1'
      ? `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`
      : `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL, reuseExistingServer: false,
  },
})
