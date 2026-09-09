import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8787',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Authentication is part of this suite; traces would retain submitted credentials.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    ...(process.env.STUDIO_CROSS_BROWSER === '1' ? [
      { name: 'firefox', use: { browserName: 'firefox' as const, viewport: { width: 1440, height: 1000 } } },
      { name: 'webkit', use: { browserName: 'webkit' as const, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ] : []),
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
