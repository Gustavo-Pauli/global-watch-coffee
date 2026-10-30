import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';

export const screenshots = path.resolve(process.env.BROWSER_SCREENSHOT_DIR || path.join(tmpdir(), 'global-watch-browser-screenshots'));

/** Wait for fonts and finite layout transitions before measuring the UI. */
export async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

export async function capture(page: Page, filename: string) {
  await settled(page);
  await page.screenshot({ path: path.join(screenshots, filename), fullPage: true, animations: 'disabled' });
}

export async function noHorizontalOverflow(page: Page) {
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
