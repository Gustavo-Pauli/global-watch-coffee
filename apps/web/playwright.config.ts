import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const baseURL = process.env.BROWSER_BASE_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('Browser audit must target a local server.');

export default defineConfig({
  testDir: './tests/browser', timeout: 180_000, workers: 1,
  reporter: 'list', expect: { timeout: 30_000 },
  use: { baseURL, browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', actionTimeout: 30_000, viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' },
});
