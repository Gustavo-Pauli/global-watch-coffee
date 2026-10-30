import { test, expect, type BrowserContext } from '@playwright/test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { getCookies } from 'better-auth/cookies';
import { ALL_OUTPUTS, requiredOutputKinds, resultExtensions } from '../../lib/analysis-artifacts';
import { capture, screenshots, settled, noHorizontalOverflow } from './support/ui';

test('real multispectral artifacts, polygon inspection and private downloads', async ({ browser, baseURL }) => {
  test.skip(process.env.RUN_INSPECTION_BROWSER !== '1', 'Opt in with a real schema2 public scene fixture.');
  const database = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Local disposable fixtures required.');
  const fixtureRoot = process.env.INSPECTION_FIXTURE_DIR || path.join(tmpdir(), 'global-watch-extended-fixture-egps9uuj', 'august');
  const result = JSON.parse(await readFile(path.join(fixtureRoot, 'resultado.json'), 'utf8'));
  expect(resultExtensions(result)).not.toBeNull();
  const names = requiredOutputKinds(result).map(kind => ALL_OUTPUTS[kind]);
  const owner = `inspection-${randomUUID()}`, id = randomUUID(), token = randomUUID();
  const prefix = `users/${createHash('sha256').update(owner).digest('hex')}/analyses/${id}/out`;
  const objects = names.map(name => `${prefix}/${name}`);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString(), max: 2 }) });
  const storage = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'geo-private';
  let context: BrowserContext | undefined;
  try {
    await db.user.create({ data: { id: owner, name: 'Inspeção técnica', email: `${owner}@example.invalid`, emailVerified: true } });
    await db.session.create({ data: { id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 3600_000) } });
    await db.analysis.create({ data: { id, ownerId: owner, status: 'ready', scene: 'august', acquisitionDate: new Date('2025-08-16'), result } });
    for (const [index, name] of names.entries()) {
      const { error } = await storage.storage.from(bucket).upload(objects[index], await readFile(path.join(fixtureRoot, name)), {
        contentType: name.endsWith('json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : 'image/tiff',
      });
      if (error) throw new Error('Disposable inspection artifact upload failed.');
    }
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const cookie = getCookies({ baseURL, secret: process.env.BETTER_AUTH_SECRET }).sessionToken;
    const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64');
    await context.addCookies([{ name: cookie.name, value: encodeURIComponent(`${token}.${signature}`), url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors: string[] = [], forbiddenCalls: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/api\/analysis\/(start|demo)$|\/chat$/.test(new URL(request.url()).pathname)) forbiddenCalls.push(new URL(request.url()).pathname); });
    await page.goto(`/analyses/${id}`);
    await expect(page.locator('.leaflet-image-layer')).toBeVisible();
    await expect.poll(() => page.locator('.leaflet-image-layer').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await mkdir(screenshots, { recursive: true });

    // Ownership checks happen before any signed URL is minted.
    const outsider = await browser.newContext();
    try {
      for (const kind of ['false_color', 'ndvi', 'result']) {
        expect((await outsider.request.get(`${baseURL}/api/analyses/${id}/files/${kind}`)).status()).toBe(401);
        expect((await context.request.get(`${baseURL}/api/analyses/${id}/files/${kind}`)).status()).toBe(200);
      }
      expect((await context.request.get(`${baseURL}/api/analyses/${id}/files/unknown`)).status()).toBe(404);
    } finally { await outsider.close(); }

    await page.getByRole('button', { name: 'Camadas', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Camadas', exact: true });
    const view = picker.getByRole('combobox', { name: 'Visualização da imagem', exact: true });
    for (const name of ['Falsa cor · B08, B04, B03', 'NDVI · vegetação', 'Cor natural · RGB']) {
      const before = await page.getByTestId('map-canvas').boundingBox();
      const previousImage = await page.locator('.leaflet-image-layer').getAttribute('src');
      await view.click();
      await page.getByRole('option', { name, exact: true }).click();
      await expect.poll(() => page.locator('.leaflet-image-layer').getAttribute('src')).not.toBe(previousImage);
      await expect(picker.getByText('Carregando imagem…', { exact: true })).toHaveCount(0);
      await expect.poll(() => page.locator('.leaflet-image-layer').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await settled(page);
      expect(await page.getByTestId('map-canvas').boundingBox()).toEqual(before);
      await capture(page, `inspection-${name.startsWith('NDVI') ? 'ndvi' : name.startsWith('Falsa cor') ? 'false-color' : 'rgb'}.png`);
    }
    const opacity = picker.getByRole('slider', { name: 'Opacidade da imagem', exact: true });
    await opacity.focus();
    await page.keyboard.press('Home');
    await expect(opacity).toHaveValue('0');
    await page.keyboard.press('End');
    await expect(opacity).toHaveValue('100');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Explorar polígonos', exact: true }).click();
    const first = page.getByTestId('candidate-list').getByRole('button', { name: /Polígono/ }).first();
    await first.click();
    await expect(page.locator('.leaflet-popup-content')).toContainText('ha');
    await expect(page.locator('.leaflet-popup-content')).toContainText('NDVI');
    await capture(page, 'inspection-polygon.png');
    const highlighted = page.locator('.leaflet-interactive[stroke="#f4f5dc"]');
    await expect(highlighted).toHaveCount(1);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    // Empty map background clears both the popup and the shared list selection.
    await page.getByTestId('map-canvas').click({ position: { x: 5, y: 200 } });
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await expect(highlighted).toHaveCount(0);
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await first.click();
    await expect(highlighted).toHaveCount(1);
    await page.getByRole('button', { name: 'Aproximar mapa', exact: true }).click();
    await expect(highlighted).toHaveCount(1);
    await page.getByRole('button', { name: 'Perguntar sobre este polígono', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Assistente', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('textbox', { name: 'Pergunta sobre a análise', exact: true })).toHaveValue(/polígono \d+/);
    await noHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Fechar painel', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Mostrar resultados', exact: true }).click();
    await page.getByRole('tab', { name: 'Informações', exact: true }).click();
    const section = page.getByRole('button', { name: 'Explorar polígonos', exact: true });
    if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
    await page.getByTestId('candidate-list').getByRole('button', { name: /Polígono/ }).first().click();
    await expect(page.getByRole('button', { name: 'Mostrar resultados', exact: true })).toBeVisible();
    await expect(page.locator('.leaflet-popup-content')).toBeVisible();
    await noHorizontalOverflow(page);
    await capture(page, 'inspection-mobile.png');
    expect(errors).toEqual([]);
    expect(forbiddenCalls).toEqual([]);
  } finally {
    await context?.close();
    const { error } = await storage.storage.from(bucket).remove(objects);
    if (error) await db.analysis.updateMany({ where: { id, ownerId: owner }, data: { expiresAt: new Date(Date.now() - 1000) } });
    else {
      await db.analysis.deleteMany({ where: { id, ownerId: owner } });
      await db.user.deleteMany({ where: { id: owner } });
    }
    await db.$disconnect();
    if (error) throw new Error('Inspection cleanup failed; expired metadata retained.');
  }
});
