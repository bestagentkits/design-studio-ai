import { test as base, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

type SessionState = Awaited<ReturnType<BrowserContext['storageState']>>;

// Share only authentication; each test still gets its own browser context and project.
// Registering per keyboard assertion exhausts the real signup limit in the full suite.
export const test = base.extend<{}, { keyboardSession: SessionState }>({
  keyboardSession: [async ({ browser }, use, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL;
    const context = await browser.newContext({ baseURL });
    try {
      const registration = await context.request.post('/api/auth/register', {
        headers: { Origin: baseURL! },
        data: { email: `keyboard-${randomUUID()}@studio.test`, name: 'Keyboard UX', password: randomUUID() + randomUUID() },
      });
      expect(registration.status()).toBe(201);
      await use(await context.storageState());
    } finally {
      await context.close();
    }
  }, { scope: 'worker' }],
  storageState: async ({ keyboardSession }, use) => {
    await use(keyboardSession);
  },
});

export { expect };
