import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { analysisId, installMapFixtures, studyId, type OfflineMapFixture } from './support/map-fixtures';
import { capture, noHorizontalOverflow, screenshots, settled } from './support/ui';

// These tests exercise the real application adapters. All API/image/provider responses are
// synthetic HTTP fixtures; no database, OAuth account, Storage bucket, worker or paid API is used.
const images = (page: Page) => page.locator('img.leaflet-image-layer[data-geospatial-layer]');
const image = (page: Page, asset: string) => page.locator(`img.leaflet-image-layer[data-geospatial-layer][src*="/assets/${asset}"]`);
const canvas = (page: Page) => page.locator('.leaflet-container');

async function readyImage(locator: Locator) {
  await expect(locator).toBeAttached();
  await expect.poll(() => locator.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 32)).toBe(true);
}

async function openAnalysis(page: Page) {
  await page.goto(`/analyses/${analysisId}`);
  await readyImage(images(page));
  await expect(page.getByRole('button', { name: 'Aproximar mapa', exact: true })).toBeVisible();
}

async function openStudy(page: Page) {
  await page.goto(`/experiments/${studyId}`);
  await readyImage(image(page, 'south-before-rgb'));
  await readyImage(image(page, 'south-after-rgb'));
  await expect(page.getByRole('button', { name: 'Aproximar mapa', exact: true })).toBeVisible();
}

async function layers(page: Page) {
  await page.getByRole('button', { name: 'Camadas', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camadas', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setRange(page: Page, slider: Locator, value: '0' | '.5' | '1', max: number) {
  await slider.focus();
  await page.keyboard.press('Home');
  if (value === '1') await page.keyboard.press('End');
  if (value === '.5') for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue(String(Number(value) * max));
}

async function chooseFalseColor(page: Page, control: Locator) {
  if (await control.evaluate(element => element.tagName === 'SELECT')) {
    await control.selectOption('falseColor');
  } else {
    await control.click();
    await page.getByRole('option', { name: /Falsa cor/ }).click();
  }
}

async function frame(page: Page, raster = images(page).first()) {
  await settled(page);
  const map = (await canvas(page).boundingBox())!, overlay = (await raster.boundingBox())!;
  return { width: overlay.width, height: overlay.height,
    x: (map.x + map.width / 2 - overlay.x) / overlay.width,
    y: (map.y + map.height / 2 - overlay.y) / overlay.height };
}

async function expectSameView(page: Page, before: Awaited<ReturnType<typeof frame>>) {
  await expect.poll(async () => {
    const after = await frame(page);
    return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
  }).toBeLessThan(.005);
}

async function viewportSettled(page: Page) {
  let previous = -1, stable = 0;
  await expect.poll(async () => {
    const width = (await images(page).first().boundingBox())!.width;
    const animating = await canvas(page).evaluate(element => element.classList.contains('leaflet-zoom-anim') || element.classList.contains('leaflet-pan-anim'));
    stable = Math.abs(width - previous) < .1 && !animating ? stable + 1 : 0;
    previous = width;
    return stable;
  }, { intervals: [60], timeout: 10_000 }).toBeGreaterThanOrEqual(4);
}

async function pan(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  // Away from the toolbar, legend, attribution and synthetic polygons.
  const x = box.x + Math.min(110, box.width / 3), y = box.y + 145;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 75, y + 35, { steps: 10 }); await page.mouse.up();
  await viewportSettled(page);
}

async function navigationChangesZoom(page: Page) {
  const initial = await frame(page);
  await page.getByRole('button', { name: 'Aproximar mapa', exact: true }).click();
  await expect.poll(async () => (await frame(page)).width).toBeGreaterThan(initial.width * 1.1);
  await page.getByRole('button', { name: 'Afastar mapa', exact: true }).click();
  await expect.poll(async () => Math.abs((await frame(page)).width / initial.width - 1)).toBeLessThan(.01);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -450);
  await expect.poll(async () => (await frame(page)).width).toBeGreaterThan(initial.width * 1.1);
  // Wheel input is debounced and animated by Leaflet. Wait for the visible zoom
  // to finish before dispatching a separate fit action.
  await viewportSettled(page);
  await page.getByRole('button', { name: 'Enquadrar imagem', exact: true }).click();
  await expect.poll(async () => Math.abs((await frame(page)).width / initial.width - 1)).toBeLessThan(.01);
}

function cleanFixture(state: OfflineMapFixture) {
  expect(state.unexpected, 'All API requests must be explicitly mocked and external requests blocked').toEqual([]);
  expect(state.errors, 'The shared engine must not produce browser errors').toEqual([]);
  expect(state.requests).toContain('/api/auth/get-session');
}

test('offline analysis adapter preserves raster, selection, zoom and view during layout changes', async ({ page, context, baseURL }) => {
  const fixture = await installMapFixtures(context, baseURL!);
  await openAnalysis(page);
  await navigationChangesZoom(page);
  let picker = await layers(page);
  const opacity = picker.getByRole('slider', { name: 'Opacidade da imagem', exact: true });
  for (const value of ['0', '.5', '1'] as const) {
    await setRange(page, opacity, value, 100);
    await expect(images(page)).toHaveCSS('opacity', String(Number(value)));
  }
  await picker.getByRole('switch', { name: 'Imagem analisada', exact: true }).click();
  await expect(images(page)).toHaveCount(0);
  await picker.getByRole('switch', { name: 'Imagem analisada', exact: true }).click();
  await readyImage(images(page));
  const polygons = picker.getByRole('switch', { name: 'Plantações de Café', exact: true });
  await polygons.click(); await expect(page.locator('.leaflet-interactive')).toHaveCount(0);
  await polygons.click(); await expect(page.locator('.leaflet-interactive')).toHaveCount(2);

  const previousSource = await images(page).getAttribute('src');
  fixture.failAssets.add('false_color');
  await chooseFalseColor(page, picker.getByRole('combobox', { name: 'Visualização da imagem', exact: true }));
  await expect(picker.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect(images(page)).toHaveAttribute('src', previousSource!);
  await readyImage(images(page));
  fixture.failAssets.delete('false_color');
  await picker.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect.poll(() => images(page).getAttribute('src')).not.toBe(previousSource);
  await readyImage(images(page));
  await expect(picker.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Explorar polígonos', exact: true }).click();
  const row = page.getByTestId('candidate-row').first();
  await page.locator('.leaflet-interactive').first().click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.leaflet-popup-content')).toContainText('Polígono 1');
  await expect(page.locator('.leaflet-interactive[stroke="#f4f5dc"]')).toHaveCount(1);
  await row.click();
  const focused = await frame(page);
  await pan(page);
  await expect.poll(async () => Math.abs((await frame(page)).x - focused.x)).toBeGreaterThan(.01);
  // A second request for the already-selected ID must still reframe the feature.
  await row.click();
  await expectSameView(page, focused);
  await canvas(page).click({ position: { x: 20, y: 150 } });
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await expect(page.locator('.leaflet-interactive[stroke="#f4f5dc"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Enquadrar imagem', exact: true }).click();
  const beforePanel = await frame(page);
  await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expectSameView(page, beforePanel);
  await page.setViewportSize({ width: 1250, height: 850 });
  await expectSameView(page, beforePanel);
  await noHorizontalOverflow(page);
  cleanFixture(fixture);
});

test('offline experiment adapter keeps two rasters independent and reframes a distant region', async ({ page, context, baseURL }) => {
  const fixture = await installMapFixtures(context, baseURL!);
  fixture.failAssets.add('south-after-rgb');
  await page.goto(`/experiments/${studyId}`);
  const before = image(page, 'south-before-rgb'), after = image(page, 'south-after-rgb');
  await readyImage(before);
  // Failed comparison imagery must not remove the usable reference or polygons.
  await expect(page.getByTestId('map-raster-error').filter({ hasText: /comparação/i })).toBeVisible();
  await expect(page.locator('.leaflet-interactive')).toHaveCount(2);
  fixture.failAssets.delete('south-after-rgb');
  await page.getByRole('button', { name: /Tentar novamente:.*comparação/i }).click();
  await readyImage(after);
  await expect(page.getByTestId('map-raster-error')).toHaveCount(0);
  await expect(images(page)).toHaveCount(2);
  await expect(before).toHaveCSS('opacity', '1');
  const picker = await layers(page);
  const opacity = picker.getByRole('slider', { name: 'Opacidade da imagem de comparação', exact: true });
  for (const value of ['0', '.5', '1'] as const) {
    await setRange(page, opacity, value, 1);
    await expect(after).toHaveCSS('opacity', String(Number(value)));
    await expect(before).toHaveCSS('opacity', '1');
  }
  const candidates = picker.getByRole('checkbox', { name: 'Candidatos', exact: true });
  await candidates.uncheck(); await expect(page.locator('.leaflet-interactive')).toHaveCount(0);
  await candidates.check(); await expect(page.locator('.leaflet-interactive')).toHaveCount(2);
  await chooseFalseColor(page, picker.getByRole('combobox', { name: 'Visualização da imagem', exact: true }));
  await readyImage(image(page, 'south-before-false'));
  await readyImage(image(page, 'south-after-false'));
  await page.keyboard.press('Escape');
  await navigationChangesZoom(page);
  const first = page.getByTestId('experiment-candidate').first();
  await page.locator('.leaflet-interactive').first().click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.leaflet-interactive[stroke="#f1e9cf"]')).toHaveCount(1);
  await first.click();
  const focused = await frame(page);
  await pan(page);
  await expect.poll(async () => Math.abs((await frame(page)).x - focused.x)).toBeGreaterThan(.01);
  await first.click();
  await expectSameView(page, focused);
  await canvas(page).click({ position: { x: 20, y: 150 } });
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.leaflet-interactive[stroke="#f1e9cf"]')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Piloto do estudo', exact: true }).selectOption('north');
  await readyImage(image(page, 'north-before-false'));
  await readyImage(image(page, 'north-after-false'));
  await expect(page.getByTestId('experiment-candidate').first()).toContainText('north-1');
  // New hemisphere bounds must fit on screen and retain aligned vectors, not a fixed Brazilian center.
  const map = (await canvas(page).boundingBox())!, overlay = (await images(page).first().boundingBox())!;
  expect(overlay.width).toBeGreaterThan(100);
  expect(overlay.x).toBeLessThan(map.x + map.width);
  expect(overlay.x + overlay.width).toBeGreaterThan(map.x);
  for (const path of await page.locator('.leaflet-interactive').all()) {
    const box = (await path.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(map.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(map.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height + 1);
  }
  const beforeResize = await frame(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expectSameView(page, beforeResize);
  await noHorizontalOverflow(page);
  cleanFixture(fixture);
});

for (const mobile of [false, true]) {
  test(`offline adapters share accessible ${mobile ? 'mobile' : 'desktop'} map controls`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    try {
      const fixture = await installMapFixtures(context, baseURL!);
      const page = await context.newPage();
      const controls: unknown[] = [];
      await mkdir(screenshots, { recursive: true });
      for (const adapter of ['analysis', 'experiment'] as const) {
        if (adapter === 'analysis') await openAnalysis(page); else await openStudy(page);
        await settled(page);
        const navigation = page.getByTestId('map-navigation');
        await expect(navigation.getByRole('button')).toHaveCount(3);
        for (const label of ['Aproximar mapa', 'Afastar mapa', 'Enquadrar imagem']) {
          const button = navigation.getByRole('button', { name: label, exact: true });
          await expect(button).toBeVisible();
          const rectangle = (await button.boundingBox())!, icon = (await button.locator('svg').boundingBox())!;
          expect(rectangle.width).toBe(mobile ? 40 : 36); expect(rectangle.height).toBe(mobile ? 40 : 36);
          expect(icon.width).toBe(18); expect(icon.height).toBe(18);
          expect(Math.abs(icon.x + icon.width / 2 - rectangle.x - rectangle.width / 2)).toBeLessThanOrEqual(1);
          expect(Math.abs(icon.y + icon.height / 2 - rectangle.y - rectangle.height / 2)).toBeLessThanOrEqual(1);
        }
        controls.push(await navigation.evaluate(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius,
            padding: style.padding, shadow: style.boxShadow, gap: style.gap, direction: style.flexDirection };
        }));
        const zoom = navigation.getByRole('button', { name: 'Aproximar mapa', exact: true });
        await zoom.focus(); await expect(zoom).toBeFocused();
        await expect(page.getByRole('tooltip', { name: 'Aproximar mapa', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('tooltip', { name: 'Aproximar mapa', exact: true })).toHaveCount(0);
        await layers(page);
        await expect(page.getByRole('radiogroup', { name: 'Mapa de fundo', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Camadas', exact: true })).toBeFocused();
        await noHorizontalOverflow(page);
        await capture(page, `map-engine-${adapter}-${mobile ? 'mobile' : 'desktop'}.png`);
      }
      expect(controls[1]).toEqual(controls[0]);
      cleanFixture(fixture);
    } finally { await context.close(); }
  });
}
