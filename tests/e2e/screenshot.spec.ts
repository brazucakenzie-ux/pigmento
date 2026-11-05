import { test } from '@playwright/test';
import path from 'node:path';
import { launchApp } from './harness';

// Captures the main window for visual review (not an assertion test).
test('capture main window', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const h = await launchApp();
  try {
    await h.page.setViewportSize({ width: 1360, height: 860 }).catch(() => undefined);
    await h.page.waitForSelector('.ribbon');
    await h.page.waitForTimeout(600);
    const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
    await h.page.screenshot({ path: path.join(out, 'main.png') });
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});
