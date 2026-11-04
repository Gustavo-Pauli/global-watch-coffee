import { test, expect, type Page, type Route } from '@playwright/test';
import { mountEngineHarness } from './support/engine-harness';
import { tinyPng } from './support/map-fixtures';

const alphaPath = (page: Page) => page.locator('path[data-layer="alpha"]');
const betaPath = (page: Page) => page.locator('path[data-layer="beta"]');
const browserErrors = new WeakMap<Page, string[]>();
const image = tinyPng([87, 130, 68]);
async function selection(page: Page, expected: { alpha: string | null; beta: string | null }) {
  await expect(page.getByTestId('engine-selection')).toHaveText(JSON.stringify(expected));
}
async function focusedAt(page: Page, coordinate: number) {
  await expect.poll(async () => {
    const view = JSON.parse((await page.getByTestId('engine-view').textContent())!);
    return Math.max(Math.abs(view.lat - coordinate), Math.abs(view.lng - coordinate));
  }).toBeLessThan(.0001);
}
async function flushMapFrame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // The real engine renders locally. Unexpected network calls fail closed.
  await page.route('**/*', route => route.abort());
  await mountEngineHarness(page);
  await expect(alphaPath(page)).toBeVisible();
  await expect(betaPath(page)).toBeVisible();
});

test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('equal feature IDs in different GeoJSON layers retain independent callbacks, styles and visibility', async ({ page }) => {
  await expect(alphaPath(page)).toHaveAttribute('data-feature', 'shared');
  await expect(betaPath(page)).toHaveAttribute('data-feature', 'shared');
  await alphaPath(page).click();
  await selection(page, { alpha: 'shared', beta: null });
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(alphaPath(page)).toHaveAttribute('stroke-dasharray', '7,3');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#773399');
  await betaPath(page).click();
  await selection(page, { alpha: 'shared', beta: 'shared' });
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');

  await page.getByRole('button', { name: 'Clear alpha', exact: true }).click();
  await selection(page, { alpha: null, beta: 'shared' });
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#2266aa');
  await expect(alphaPath(page)).not.toHaveAttribute('stroke-dasharray');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');
  await page.getByRole('button', { name: 'Change beta style', exact: true }).click();
  await expect(betaPath(page)).toHaveAttribute('stroke', '#88ee00');
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#2266aa');

  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await expect(alphaPath(page)).toHaveCount(0);
  await expect(betaPath(page)).toHaveAttribute('stroke', '#88ee00');
  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#2266aa');
  await selection(page, { alpha: null, beta: 'shared' });
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(2);
});

test('replacing or removing a layer leaves no stale features and preserves the other layer selection', async ({ page }) => {
  await alphaPath(page).click();
  await betaPath(page).click();
  await page.getByRole('button', { name: 'Replace alpha data', exact: true }).click();
  await expect(alphaPath(page)).toHaveAttribute('data-feature', 'other');
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#2266aa');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');
  await expect(page.locator('path[data-layer="alpha"][data-feature="shared"]')).toHaveCount(0);
  await alphaPath(page).click();
  await selection(page, { alpha: 'other', beta: 'shared' });
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');

  await page.getByRole('button', { name: 'Toggle alpha mounting', exact: true }).click();
  await expect(alphaPath(page)).toHaveCount(0);
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle alpha mounting', exact: true }).click();
  await expect(alphaPath(page)).toHaveAttribute('data-feature', 'other');
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(2);
});

test('focus is scoped by layer and repeated requests for the same feature still refocus', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus alpha', exact: true }).click();
  await focusedAt(page, .008);
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#773399');
  await page.getByRole('button', { name: 'Focus beta', exact: true }).click();
  await focusedAt(page, .032);
  await expect(betaPath(page)).toHaveAttribute('stroke', '#ff1199');
  await page.getByRole('button', { name: 'Focus alpha', exact: true }).click();
  await focusedAt(page, .008);
  await selection(page, { alpha: 'shared', beta: 'shared' });
});

test('already applied focus is not replayed by visibility or data updates after the user pans', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus alpha', exact: true }).click();
  await focusedAt(page, .008);
  const canvas = (await page.locator('.leaflet-container').boundingBox())!;
  await page.mouse.move(canvas.x + 800, canvas.y + 500);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 550, canvas.y + 400, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => {
    const view = JSON.parse((await page.getByTestId('engine-view').textContent())!);
    return Math.abs(view.lng - .008);
  }).toBeGreaterThan(.001);
  const pannedView = await page.getByTestId('engine-view').textContent();
  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await flushMapFrame(page);
  await expect(page.getByTestId('engine-view')).toHaveText(pannedView!);
  await page.getByRole('button', { name: 'Refresh alpha data', exact: true }).click();
  await flushMapFrame(page);
  await expect(page.getByTestId('engine-view')).toHaveText(pannedView!);
  // A genuinely new request still executes, even though the feature ID is equal.
  await page.getByRole('button', { name: 'Focus alpha', exact: true }).click();
  await focusedAt(page, .008);
});

test('a new focus request waits until its hidden feature becomes available', async ({ page }) => {
  const initialView = await page.getByTestId('engine-view').textContent();
  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await page.getByRole('button', { name: 'Focus alpha', exact: true }).click();
  await flushMapFrame(page);
  await expect(page.getByTestId('engine-view')).toHaveText(initialView!);
  await page.getByRole('button', { name: 'Toggle alpha visibility', exact: true }).click();
  await focusedAt(page, .008);
});

test('features without selection IDs receive changed styles and reset omitted path options', async ({ page }) => {
  await page.getByRole('button', { name: 'Load ID-less reference', exact: true }).click();
  const path = page.locator('path[data-layer="idless"]');
  await expect(path).toHaveAttribute('stroke', '#aa1122');
  await expect(path).toHaveAttribute('stroke-width', '6');
  await expect(path).toHaveAttribute('stroke-dasharray', '8,4');
  await page.getByRole('button', { name: 'Change ID-less style', exact: true }).click();
  await expect(path).toHaveAttribute('stroke', '#55bb44');
  await expect(path).toHaveAttribute('stroke-width', '3');
  await expect(path).not.toHaveAttribute('stroke-dasharray');
  await selection(page, { alpha: null, beta: null });
});

test('raster loading, failure and retry are independent per layer and visibility removes its credit', async ({ page }) => {
  let mode: 'pending' | 'fail' | 'success' = 'pending';
  let pending: Route | null = null;
  let comparisonRequests = 0;
  await page.route('**/engine/reference.png', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/engine/comparison.png?*', async route => {
    comparisonRequests += 1;
    if (mode === 'pending') { pending = route; return; }
    if (mode === 'fail') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  const reference = page.locator('.leaflet-image-layer[data-geospatial-layer="reference"]');
  const comparison = page.locator('.leaflet-image-layer[data-geospatial-layer="comparison"]');
  await page.getByRole('button', { name: 'Load rasters', exact: true }).click();
  await expect.poll(() => pending !== null).toBe(true);
  await expect(reference).toHaveAttribute('data-geospatial-status', 'ready');
  await expect(comparison).toHaveAttribute('data-geospatial-status', 'loading');
  await expect(page.getByTestId('engine-status')).toContainText('"comparison":"loading"');
  await expect(page.getByTestId('map-raster-loading')).toHaveCount(1);
  try {
    await pending!.fulfill({ contentType: 'image/png', body: image });
  } finally { pending = null; }
  await expect(comparison).toHaveAttribute('data-geospatial-status', 'ready');
  await expect(page.getByTestId('map-raster-loading')).toHaveCount(0);
  await expect(reference).toHaveAttribute('data-source-time-kind', 'acquisition');
  await expect(reference).toHaveAttribute('data-source-date', '2025-09-01');
  await expect(comparison).toHaveAttribute('data-source-date', '2026-09-01');
  await expect(comparison).toHaveAttribute('alt', 'Comparison scene · 2026-09-01');
  await expect.poll(() => comparison.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Offline acquisition reference credit');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Offline acquisition comparison credit');
  await expect(comparison).toHaveCSS('opacity', '0.6');
  await page.getByRole('button', { name: 'Reduce comparison opacity', exact: true }).click();
  await expect(comparison).toHaveCSS('opacity', '0.2');
  await expect(reference).toHaveCSS('opacity', '1');

  mode = 'fail';
  await page.getByRole('button', { name: 'Change comparison URL', exact: true }).click();
  await expect(comparison).toHaveAttribute('data-geospatial-status', 'error');
  const error = page.getByTestId('map-raster-error');
  await expect(error).toHaveCount(1);
  await expect(page.getByTestId('map-raster-loading')).toHaveCount(0);
  await expect(error).toHaveAttribute('data-geospatial-layer', 'comparison');
  await expect(reference).toHaveAttribute('data-geospatial-status', 'ready');
  await expect.poll(() => reference.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  mode = 'success';
  await page.getByRole('button', { name: 'Tentar novamente: Comparison scene', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(comparison).toHaveAttribute('data-geospatial-status', 'ready');
  expect(comparisonRequests).toBe(3);

  await page.getByRole('button', { name: 'Toggle comparison visibility', exact: true }).click();
  await expect(comparison).toHaveCount(0);
  await expect(page.locator('.leaflet-control-attribution')).not.toContainText('Offline acquisition comparison credit');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Offline acquisition reference credit');
  await expect(reference).toHaveAttribute('data-geospatial-status', 'ready');
  await page.getByRole('button', { name: 'Toggle comparison visibility', exact: true }).click();
  await expect(comparison).toHaveAttribute('data-geospatial-status', 'ready');
  await expect(comparison).toHaveCSS('opacity', '0.2');
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(2);
});

test('reference tile failure and retry preserve independent vector and raster layers', async ({ page }) => {
  let failTiles = true;
  let tileRequests = 0;
  await page.route('**/engine/tiles/**', route => {
    tileRequests += 1;
    return route.fulfill({ status: failTiles ? 503 : 200, contentType: failTiles ? 'text/plain' : 'image/png', body: failTiles ? Buffer.from('Unavailable') : image });
  });
  await page.route('**/engine/reference.png', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/engine/comparison.png?*', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.getByRole('button', { name: 'Load rasters', exact: true }).click();
  await expect(page.locator('.leaflet-image-layer[data-geospatial-status="ready"]')).toHaveCount(2);
  await alphaPath(page).click();
  await page.getByRole('button', { name: 'Toggle reference tiles', exact: true }).click();
  const error = page.getByTestId('map-tile-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-geospatial-layer', 'offline-reference');
  expect(tileRequests).toBeGreaterThan(0);
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(betaPath(page)).toHaveAttribute('stroke', '#773399');
  await expect(page.locator('.leaflet-image-layer[data-geospatial-status="ready"]')).toHaveCount(2);
  const failedRequests = tileRequests;
  failTiles = false;
  await error.getByRole('button', { name: 'Recarregar mapa', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect.poll(() => tileRequests).toBeGreaterThan(failedRequests);
  await expect.poll(() => page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);
  const tileSource = page.locator('.leaflet-layer[data-geospatial-layer="offline-reference"]');
  await expect(tileSource).toHaveAttribute('data-source-time-kind', 'reference');
  await expect(tileSource).toHaveAttribute('data-source-time-label', 'Reference without acquisition date');
  await expect(tileSource).not.toHaveAttribute('data-source-date');
  await expect(alphaPath(page)).toHaveAttribute('stroke', '#11ddff');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Offline tile credit');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Offline acquisition comparison credit');
  await page.getByRole('button', { name: 'Toggle reference tiles', exact: true }).click();
  await expect(page.locator('.leaflet-tile')).toHaveCount(0);
  await expect(page.locator('.leaflet-control-attribution')).not.toContainText('Offline tile credit');
  await expect(page.locator('.leaflet-image-layer[data-geospatial-status="ready"]')).toHaveCount(2);
});

test('changing raster bounds with the same URL moves only that image without a reload or viewport reset', async ({ page }) => {
  let referenceRequests = 0;
  await page.route('**/engine/reference.png', route => {
    referenceRequests += 1;
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.route('**/engine/comparison.png?*', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.getByRole('button', { name: 'Load rasters', exact: true }).click();
  const reference = page.locator('.leaflet-image-layer[data-geospatial-layer="reference"]');
  const comparison = page.locator('.leaflet-image-layer[data-geospatial-layer="comparison"]');
  await expect(reference).toHaveAttribute('data-geospatial-status', 'ready');
  const original = (await reference.boundingBox())!;
  const comparisonBox = await comparison.boundingBox();
  const view = await page.getByTestId('engine-view').textContent();
  const source = await reference.getAttribute('src');
  await page.getByRole('button', { name: 'Change raster bounds', exact: true }).click();
  await expect.poll(async () => (await reference.boundingBox())!.width / original.width).toBeCloseTo(.5, 2);
  const changed = (await reference.boundingBox())!;
  expect(changed.x).toBeGreaterThan(original.x);
  expect(changed.y).toBeGreaterThan(original.y);
  expect(changed.height / original.height).toBeCloseTo(.5, 2);
  expect(await comparison.boundingBox()).toEqual(comparisonBox);
  await expect(reference).toHaveAttribute('src', source!);
  await expect(reference).toHaveAttribute('data-geospatial-status', 'ready');
  await expect(page.getByTestId('engine-view')).toHaveText(view!);
  expect(referenceRequests).toBe(1);
});
