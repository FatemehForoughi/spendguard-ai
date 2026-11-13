import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' },
  webServer: {
    command: process.env.SPENDGUARD_BROWSER_BUILD === '1'
      ? 'npm run preview -- --host 127.0.0.1 --port 5173'
      : 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173', reuseExistingServer: false,
  },
})
