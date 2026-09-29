import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:emulators -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175/booking.html',
    reuseExistingServer: false,
  },
});
