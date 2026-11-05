import { expect, test } from '@playwright/test';
import { launchApp } from './harness';

test('app launches with a secure renderer and no console errors', async () => {
  const h = await launchApp();
  try {
    await expect(h.page).toHaveTitle(/Pigmento/);
    const exposure = await h.page.evaluate(() => ({
      hasApi: typeof window.pigmento === 'object',
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
      hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
      origin: location.origin,
    }));
    expect(exposure.hasApi).toBe(true);
    expect(exposure.hasRequire).toBe(false);
    expect(exposure.hasProcess).toBe(false);
    expect(exposure.origin).toBe('app://pigmento');
    expect(h.errors).toEqual([]);
  } finally {
    await h.close();
  }
});
