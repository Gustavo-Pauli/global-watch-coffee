import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { getCookies } from 'better-auth/cookies';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { FeatureCollection, Polygon } from 'geojson';

const screenshots = path.resolve('../../docs/delivery/screenshots');
const outputs = ['candidatos.geojson', 'imagem_classificada.png', 'imagem_mapa.png', 'imagem_rgb.png', 'classificacao.tif', 'resultado.json'];

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function capture(page: Page, filename: string) {
  await settled(page);
  await page.screenshot({ path: path.join(screenshots, filename), fullPage: true, animations: 'disabled' });
}

async function noOverflow(page: Page) {
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator('.map-toolbar button, .map-results-button').all()) {
    const rectangle = await button.boundingBox();
    if (!rectangle) continue;
    expect(rectangle.x).toBeGreaterThanOrEqual(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

async function readyMap(page: Page) {
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-image-layer')).toBeVisible();
  await expect.poll(() => page.locator('.leaflet-image-layer').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.leaflet-interactive')).toHaveCount(24);
  await expect(page.locator('.map-legend')).toContainText('22,66');
  const date = page.locator('.header-acquisition');
  await expect(date).toHaveText('16/08/2025');
  await expect(date).toHaveAttribute('datetime', '2025-08-16');
  await expect(date).toHaveAttribute('aria-label', /Aquisição:.*2025/);
  await expect(date).toHaveAttribute('title', /Aquisição:.*agosto.*2025/);
  await settled(page);
  expect(await date.evaluate(element => {
    const rectangle = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
      && rectangle.left >= 0 && rectangle.right <= innerWidth;
  }), `Acquisition date must remain completely visible at ${page.viewportSize()!.width}px`).toBe(true);
}

function inside(point: number[], ring: number[][]) {
  const [x, y] = point;
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

// Choose an interior point from the actual polygon, then project it into the
// real Leaflet ImageOverlay rectangle. The test clicks visible map geometry.
function representativePolygon(geojson: FeatureCollection) {
  const feature = geojson.features
    .filter(feature => feature.geometry.type === 'Polygon')
    .sort((a, b) => Number(b.properties?.area_ha) - Number(a.properties?.area_ha))[0];
  assert.ok(feature);
  const geometry = feature.geometry as Polygon;
  const ring = geometry.coordinates[0];
  const xs = ring.map(point => point[0]), ys = ring.map(point => point[1]);
  const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
  for (let row = 1; row < 10; row++) {
    for (let column = 1; column < 10; column++) {
      const point = [west + (east - west) * column / 10, south + (north - south) * row / 10];
      if (inside(point, ring) && !geometry.coordinates.slice(1).some(hole => inside(point, hole))) {
        return { point, id: Number(feature.properties?.id) };
      }
    }
  }
  throw new Error('The public fixture polygon has no testable interior point.');
}

test('real ready-analysis UI, profile, keyboard, mobile and logout without processing quota', async ({ browser, baseURL }) => {
  test.skip(process.env.RUN_UI_BROWSER !== '1', 'Set RUN_UI_BROWSER=1 to use disposable DB/Storage fixtures with precomputed public scene outputs.');
  test.setTimeout(180_000);
  const database = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('UI fixtures require local PostgreSQL.');
  const root = process.env.UI_FIXTURE_DIR || path.join(tmpdir(), 'global-watch-gemini-live');
  const buffers = await Promise.all(outputs.map(filename => readFile(path.join(root, filename))));
  const result = JSON.parse(buffers[outputs.indexOf('resultado.json')].toString('utf8'));
  const geojson = JSON.parse(buffers[0].toString('utf8')) as FeatureCollection;
  assert.equal(result.image, 'imagem_multiespectral.tif');
  assert.equal(result.acquisition_date, '2025-08-16');
  assert.equal(result.method, 'rf_purified_multiclass_2.0');
  assert.equal(result.coffee_validated, false);
  assert.equal(result.candidate_polygon_count, 24);
  assert.equal(geojson.features.length, result.candidate_polygon_count);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.toString(), max: 2 }) });
  const storage = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'geo-private';
  const owner = `ui-review-${randomUUID()}`, id = randomUUID();
  const prefix = `users/${createHash('sha256').update(owner).digest('hex')}/analyses/${id}/out`;
  const paths = outputs.map(filename => `${prefix}/${filename}`);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const processingRequests: string[] = [];
  const chatRequests: string[] = [];
  const tileRequests: { host: string; referer: string | undefined }[] = [];
  const tileResponses: number[] = [];
  const tileHeaderReads: Promise<void>[] = [];
  const tileOrigin = `${new URL(baseURL!).origin}/`;
  const quotaBefore = await prisma.rateLimit.findMany({ where: { key: { startsWith: 'global:analysis:' } }, orderBy: { key: 'asc' }, select: { key: true, count: true } });
  try {
    await mkdir(screenshots, { recursive: true });
    await prisma.user.create({ data: { id: owner, name: 'Revisão da plataforma', email: `${owner}@example.invalid`, emailVerified: true } });
    await prisma.analysis.create({ data: { id, ownerId: owner, status: 'ready', scene: 'august', acquisitionDate: new Date('2025-08-16'), result } });
    for (const [index, filename] of outputs.entries()) {
      const { error } = await storage.storage.from(bucket).upload(paths[index], buffers[index], {
        contentType: filename.endsWith('json') ? 'application/json' : filename.endsWith('.png') ? 'image/png' : 'image/tiff',
      });
      if (error) throw new Error('Could not upload disposable public-scene UI artifacts.');
    }
    for (let index = 0; index < 2; index++) {
      const token = randomUUID();
      await prisma.session.create({ data: { id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 3600_000) } });
      const context = await browser.newContext(index
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
        : { viewport: { width: 1440, height: 1000 } });
      const cookie = getCookies({ baseURL, secret: process.env.BETTER_AUTH_SECRET }).sessionToken;
      const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64');
      await context.addCookies([{ name: cookie.name, value: encodeURIComponent(`${token}.${signature}`), url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
      contexts.push(context);
    }
    const page = await contexts[0].newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (/\/api\/analysis\/(demo|start)$/.test(url.pathname)) processingRequests.push(request.url());
      if (/\/api\/analyses\/[^/]+\/chat$/.test(url.pathname)) chatRequests.push(url.pathname);
      if (url.hostname === 'api.maptiler.com' && /^\/(tiles|maps)\//.test(url.pathname)) {
        // Passive inspection preserves normal browser caching. Routing or
        // fetching tiles separately would change the behavior under test.
        tileHeaderReads.push(request.allHeaders().then(headers => {
          tileRequests.push({ host: url.hostname, referer: headers.referer });
        }));
      }
    });
    page.on('response', response => {
      if (new URL(response.url()).hostname === 'api.maptiler.com' && /^\/(tiles|maps)\//.test(new URL(response.url()).pathname)) tileResponses.push(response.status());
    });
    const documentResponse = await page.goto('/analyses');
    expect(documentResponse?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const record = page.getByRole('link', { name: `Abrir análise ${id}`, exact: true });
    await expect(record).toBeVisible();
    await expect(page.locator('.analysis-table-wrap')).toHaveAttribute('aria-busy', 'false');
    const header = page.getByTestId('page-header');
    const sidebar = page.locator('.platform-sidebar');
    const create = header.getByRole('button', { name: 'Nova análise', exact: true });
    await expect(header.getByRole('heading', { level: 1, name: 'Análises', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Nova análise', exact: true })).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: 'Análises', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Menu da conta', exact: true })).toBeVisible();
    await expect(page.locator('.platform')).not.toHaveClass(/is-sidebar-collapsed/);
    await settled(page);
    const collectionSidebarWidth = (await sidebar.boundingBox())!.width;
    const collectionNavigation = await sidebar.getByRole('link').allTextContents();
    const collectionCreate = (await create.boundingBox())!;
    await capture(page, 'desktop-analyses.png');
    await page.getByLabel('Buscar análises', { exact: true }).fill('imagem-inexistente');
    await expect(record).not.toBeVisible();
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await expect(record).toBeVisible();

    await create.click();
    const creation = page.getByRole('dialog', { name: 'Nova análise', exact: true });
    await expect(creation.getByRole('tab', { name: 'Enviar imagem', exact: true })).toHaveAttribute('aria-selected', 'true');
    await capture(page, 'desktop-new-analysis.png');
    await creation.getByRole('tab', { name: 'Usar exemplo', exact: true }).click();
    await expect(creation.getByRole('tab', { name: 'Usar exemplo', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(creation.getByRole('radio')).toHaveCount(3);
    await expect(creation.getByRole('radio').first()).toBeVisible();
    await capture(page, 'desktop-example.png');
    await creation.getByRole('tab', { name: 'Enviar imagem', exact: true }).click();
    await expect(creation.getByRole('tab', { name: 'Enviar imagem', exact: true })).toHaveAttribute('aria-selected', 'true');
    await creation.getByLabel('Imagem multiespectral', { exact: true }).setInputFiles(path.resolve('../../data/sample/imagem_multiespectral.tif'));
    await expect(creation.getByText('imagem_multiespectral.tif', { exact: true })).toBeVisible();
    await capture(page, 'desktop-upload.png');
    await page.keyboard.press('Escape');
    await expect(creation).not.toBeVisible();
    await expect(create).toBeFocused();

    // Navigation density is a user preference, never an automatic route mode.
    await header.getByRole('button', { name: 'Recolher navegação', exact: true }).click();
    await expect(page.locator('.platform')).toHaveClass(/is-sidebar-collapsed/);
    const collapsedSidebarWidth = (await sidebar.boundingBox())!.width;
    expect(collapsedSidebarWidth).toBeLessThan(collectionSidebarWidth);
    await page.reload();
    await expect(record).toBeVisible();
    await expect(page.locator('.platform')).toHaveClass(/is-sidebar-collapsed/);
    await expect(header.getByRole('button', { name: 'Expandir navegação', exact: true })).toBeVisible();
    await record.click();
    await readyMap(page);
    await expect(page.locator('.platform')).toHaveClass(/is-sidebar-collapsed/);
    expect((await sidebar.boundingBox())!.width).toBe(collapsedSidebarWidth);
    await header.getByRole('button', { name: 'Expandir navegação', exact: true }).click();
    await settled(page);
    expect((await sidebar.boundingBox())!.width).toBe(collectionSidebarWidth);
    expect(await sidebar.getByRole('link').allTextContents()).toEqual(collectionNavigation);
    await expect(header.getByRole('heading', { level: 1, name: `Análise ${id.slice(0, 8)}`, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Nova análise', exact: true })).toHaveCount(1);
    expect((await create.boundingBox())!.x).toBe(collectionCreate.x);
    expect((await create.boundingBox())!.width).toBe(collectionCreate.width);
    await expect(header.getByRole('link', { name: 'Análises', exact: true })).toHaveCount(0);
    await expect(header.getByRole('button', { name: /Detalhes|Painel da análise/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mostrar resultados', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Baixar arquivos', exact: true })).toContainText('Baixar');
    const loadedTile = page.locator('img.leaflet-tile-loaded').first();
    await expect(loadedTile).toBeVisible();
    await expect.poll(() => loadedTile.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const nativeTiles = await page.locator('img.leaflet-tile').evaluateAll(images => images.map(image => ({
      host: new URL((image as HTMLImageElement).src).hostname,
      policy: (image as HTMLImageElement).referrerPolicy,
    })));
    expect(nativeTiles.length).toBeGreaterThan(0);
    expect(nativeTiles.every(tile => tile.host === 'api.maptiler.com' && tile.policy === 'strict-origin')).toBe(true);
    await expect.poll(() => tileResponses.length).toBeGreaterThan(0);
    await Promise.all(tileHeaderReads);
    expect(tileRequests.length).toBeGreaterThan(0);
    expect(tileRequests.every(tile => tile.host === 'api.maptiler.com' && tile.referer === tileOrigin)).toBe(true);
    expect(tileResponses.every(status => status === 200 || status === 304)).toBe(true);
    await expect(page.locator('.basemap-error')).toHaveCount(0);
    await noOverflow(page);
    await capture(page, 'desktop-results.png');
    await expect(page.getByRole('tabpanel', { name: 'Informações', exact: true })).toBeVisible();
    const { point, id: polygonId } = representativePolygon(geojson);
    const rectangle = await page.locator('.leaflet-image-layer').boundingBox();
    assert.ok(rectangle);
    const [[south, west], [north, east]] = result.leaflet_bounds as [[number, number], [number, number]];
    const mercator = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
    await page.mouse.click(
      rectangle.x + (point[0] - west) / (east - west) * rectangle.width,
      rectangle.y + (mercator(north) - mercator(point[1])) / (mercator(north) - mercator(south)) * rectangle.height,
    );
    await expect(page.locator('.leaflet-popup-content')).toContainText(`Candidato ${polygonId}`);
    await expect(page.locator('.leaflet-popup-content')).toContainText('ha');
    await expect(page.locator('.leaflet-popup-content')).not.toContainText(/validação|método/i);
    await expect(page.locator('.leaflet-popup')).toHaveCSS('opacity', '1');
    await capture(page, 'desktop-popup.png');
    await page.locator('.leaflet-popup-close-button').click();

    const layers = page.getByRole('button', { name: 'Camadas', exact: true });
    await layers.click();
    const layerPicker = page.getByRole('dialog', { name: 'Camadas', exact: true });
    await expect(layerPicker.getByRole('radiogroup', { name: 'Mapa de fundo', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Satélite', exact: true })).toBeChecked();
    await expect(layerPicker).toContainText('Mosaico de diferentes datas');
    await expect(layerPicker.locator('time')).toHaveCount(0);
    await capture(page, 'desktop-layers.png');
    const raster = page.getByRole('switch', { name: 'Imagem analisada', exact: true });
    await raster.click();
    await expect(page.locator('.leaflet-image-layer')).toHaveCount(0);
    await raster.click();
    await readyMap(page);
    const polygons = layerPicker.getByRole('switch', { name: 'Áreas candidatas', exact: true });
    await polygons.click();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(0);
    await polygons.click();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(24);
    await page.getByRole('radio', { name: 'Ruas', exact: true }).click();
    await expect(page.locator('.basemap-streets img.leaflet-tile-loaded').first()).toBeVisible();
    await readyMap(page);
    await capture(page, 'desktop-streets.png');
    await page.getByRole('radio', { name: 'Sem fundo', exact: true }).click();
    await expect(page.locator('.basemap-tiles')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'MapTiler', exact: true })).toHaveCount(0);
    await readyMap(page);
    await page.getByRole('radio', { name: 'Satélite', exact: true }).click();
    await expect(page.locator('.basemap-satellite img.leaflet-tile-loaded').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layers).toBeFocused();
    await page.getByRole('button', { name: 'Baixar arquivos', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /GeoJSON/ }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/\.geojson$/);
    expect(await file.failure()).toBeNull();
    const information = page.getByRole('tab', { name: 'Informações', exact: true });
    const inspector = page.getByRole('button', { name: 'Mostrar resultados', exact: true });
    const info = page.getByRole('tabpanel', { name: 'Informações', exact: true });
    await expect(info).toContainText('24');
    await expect(info).toContainText('0,559');
    await expect(info.locator('time, details')).toHaveCount(0);
    await expect(info).not.toContainText('Áreas potenciais de café, sem validação em campo.');
    await expect(page.locator('.header-acquisition')).toHaveCount(1);
    const aboutTrigger = info.getByRole('button', { name: 'Sobre o resultado', exact: true });
    await aboutTrigger.click();
    const about = page.getByRole('dialog', { name: 'Sobre o resultado', exact: true });
    await expect(about).toBeVisible();
    await expect(about).toContainText(/Random Forest/);
    await expect(about).toContainText(/MapBiomas/);
    await expect(about).toContainText(/sem (verificação de|validação em) campo/i);
    await expect(about).toContainText(result.limitations);
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press('Tab');
      expect(await about.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    }
    await capture(page, 'desktop-about-result.png');
    await page.keyboard.press('Escape');
    await expect(about).not.toBeVisible();
    await expect(aboutTrigger).toBeFocused();
    await expect(info).toBeVisible();
    await capture(page, 'desktop-information.png');
    await information.focus();
    await page.keyboard.press('ArrowRight');
    const assistant = page.getByRole('tabpanel', { name: 'Assistente', exact: true });
    await expect(assistant).toBeVisible();
    const classifiedPreview = assistant.getByRole('img', { name: 'Imagem processada com os polígonos candidatos a café', exact: true });
    await expect(classifiedPreview).toBeVisible();
    await expect.poll(() => classifiedPreview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(assistant.getByRole('button', { name: 'Enviar pergunta', exact: true })).toBeDisabled();
    await assistant.getByRole('button', { name: 'Como interpretar o resultado?', exact: true }).click();
    const composer = assistant.getByRole('textbox', { name: 'Pergunta sobre a análise', exact: true });
    await expect(composer).toHaveValue('Como interpretar as áreas candidatas?');
    await expect(composer).toBeFocused();
    await expect(assistant.getByRole('button', { name: 'Enviar pergunta', exact: true })).toBeEnabled();
    await information.click();
    await expect(info).toBeVisible();
    await page.getByRole('tab', { name: 'Assistente', exact: true }).click();
    await expect(composer).toHaveValue('Como interpretar as áreas candidatas?');
    await capture(page, 'desktop-chat-ready.png');
    await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await expect(inspector).toBeFocused();
    await expect(inspector).toContainText('Resultados');
    await inspector.click();
    await expect(inspector).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Assistente', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(composer).toHaveValue('Como interpretar as áreas candidatas?');

    // Verify the same navigation account menu works while viewing a map.
    const account = page.getByRole('button', { name: 'Menu da conta', exact: true });
    await account.click();
    await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
    const profile = page.getByRole('dialog', { name: 'Meu perfil', exact: true });
    await expect(profile.getByRole('textbox', { name: 'Nome', exact: true })).toBeFocused();
    await profile.getByRole('textbox', { name: 'Nome', exact: true }).fill('Revisão visual');
    await capture(page, 'desktop-profile.png');
    await profile.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(profile).not.toBeVisible();
    await expect(account).toBeFocused();
    await page.reload();
    await readyMap(page);
    await expect(page.locator('.platform')).not.toHaveClass(/is-sidebar-collapsed/);
    await account.click();
    await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
    await expect(profile.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Revisão visual');
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();

    for (const [width, filename] of [[768, 'tablet-results.png'], [320, 'narrow-results.png']] as const) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 740 });
      await page.reload();
      await readyMap(page);
      await expect(header.getByRole('button', { name: 'Nova análise', exact: true })).toBeVisible();
      await noOverflow(page);
      await capture(page, filename);
      await inspector.click();
      await information.click();
      await expect(info).toBeVisible();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await account.click();
    await page.getByRole('menuitem', { name: 'Sair da conta', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continuar com Google', exact: true })).toBeVisible();
    expect((await contexts[0].request.get(baseURL + '/api/analyses')).status()).toBe(401);

    const mobile = await contexts[1].newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    mobile.on('request', request => {
      if (/\/api\/analysis\/(demo|start)$/.test(new URL(request.url()).pathname)) processingRequests.push(request.url());
      if (/\/api\/analyses\/[^/]+\/chat$/.test(new URL(request.url()).pathname)) chatRequests.push(new URL(request.url()).pathname);
    });
    await mobile.emulateMedia({ reducedMotion: 'reduce' });
    await mobile.goto(`/analyses/${id}`);
    await readyMap(mobile);
    await expect(mobile.getByTestId('page-header').getByRole('button', { name: 'Nova análise', exact: true })).toBeVisible();
    await noOverflow(mobile);
    await capture(mobile, 'mobile-results.png');
    await mobile.setViewportSize({ width: 320, height: 740 });
    await mobile.reload();
    await readyMap(mobile);
    await noOverflow(mobile);
    await capture(mobile, 'mobile-narrow-results.png');
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.reload();
    await readyMap(mobile);
    await mobile.getByRole('button', { name: 'Mostrar resultados', exact: true }).click();
    await mobile.getByRole('tab', { name: 'Informações', exact: true }).click();
    await expect(mobile.getByRole('tabpanel', { name: 'Informações', exact: true })).toBeVisible();
    await mobile.getByRole('button', { name: 'Sobre o resultado', exact: true }).click();
    const mobileAbout = mobile.getByRole('dialog', { name: 'Sobre o resultado', exact: true });
    await expect(mobileAbout).toBeVisible();
    await noOverflow(mobile);
    await mobile.keyboard.press('Escape');
    await expect(mobile.getByRole('button', { name: 'Sobre o resultado', exact: true })).toBeFocused();
    await capture(mobile, 'mobile-information.png');
    await mobile.getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await mobile.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
    const navigation = mobile.getByRole('dialog', { name: 'Navegação', exact: true });
    await expect(navigation).toBeVisible();
    await capture(mobile, 'mobile-navigation.png');
    await navigation.getByRole('button', { name: 'Menu da conta', exact: true }).click();
    await mobile.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
    const mobileProfile = mobile.getByRole('dialog', { name: 'Meu perfil', exact: true });
    await expect(mobileProfile.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Revisão visual');
    await expect(mobileProfile.getByRole('textbox', { name: 'Nome', exact: true })).toBeFocused();
    for (let index = 0; index < 7; index++) {
      await mobile.keyboard.press('Tab');
      expect(await mobileProfile.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    }
    await noOverflow(mobile);
    await capture(mobile, 'mobile-profile.png');
    await mobile.keyboard.press('Escape');
    await expect(mobileProfile).not.toBeVisible();
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Menu da conta', exact: true })).toBeFocused();
    await navigation.getByRole('link', { name: 'Análises', exact: true }).click();
    await expect(mobile).toHaveURL(/\/analyses$/);
    await expect(mobile.getByRole('link', { name: `Abrir análise ${id}`, exact: true })).toBeVisible();
    await capture(mobile, 'mobile-analyses.png');
    await mobile.getByRole('button', { name: 'Nova análise', exact: true }).click();
    const mobileCreation = mobile.getByRole('dialog', { name: 'Nova análise', exact: true });
    await expect(mobileCreation.getByRole('tab', { name: 'Enviar imagem', exact: true })).toHaveAttribute('aria-selected', 'true');
    await noOverflow(mobile);
    await capture(mobile, 'mobile-new-analysis.png');
    await mobile.keyboard.press('Escape');
    await mobile.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
    await navigation.getByRole('button', { name: 'Menu da conta', exact: true }).click();
    await mobile.getByRole('menuitem', { name: 'Sair da conta', exact: true }).click();
    await expect(mobile.getByRole('button', { name: 'Continuar com Google', exact: true })).toBeVisible();
    expect((await contexts[1].request.get(baseURL + '/api/analyses')).status()).toBe(401);

    expect(errors).toEqual([]);
    expect(processingRequests).toEqual([]);
    expect(chatRequests).toEqual([]);
    await Promise.all(tileHeaderReads);
    expect(tileRequests.every(tile => tile.host === 'api.maptiler.com' && tile.referer === tileOrigin)).toBe(true);
    expect(tileResponses.every(status => status === 200 || status === 304)).toBe(true);
    const quotaAfter = await prisma.rateLimit.findMany({ where: { key: { startsWith: 'global:analysis:' } }, orderBy: { key: 'asc' }, select: { key: true, count: true } });
    expect(quotaAfter).toEqual(quotaBefore);
    console.log(JSON.stringify({ readyUI: true, consistentShell: true, sidebarPreferencePersisted: true, aboutResultAccessible: true,
      profilePersisted: true, desktopSidebarLogout: true, mobileNestedProfileAndLogout: true,
      acquisitionDate: '16/08/2025', dateUnclippedAtWidths: [320, 390, 768, 1440],
      processingJobsStarted: 0, geminiCalls: 0, globalQuotaCount: quotaAfter.reduce((sum, row) => sum + row.count, 0),
      artifacts: 'real precomputed public Sentinel-2 scene', oauthHandshakeTested: false,
      basemap: { host: 'api.maptiler.com', referrerPolicy: 'strict-origin', referer: tileOrigin,
        observedResponses: tileResponses.length, statuses: [...new Set(tileResponses)], globalReferrerPolicy: 'strict-origin-when-cross-origin' } }));
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    const { error } = await storage.storage.from(bucket).remove(paths);
    if (error) {
      await prisma.analysis.updateMany({ where: { id, ownerId: owner }, data: { expiresAt: new Date(Date.now() - 1000) } });
    } else {
      await prisma.analysis.deleteMany({ where: { id, ownerId: owner } });
    }
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${owner}:` } } });
    await prisma.user.deleteMany({ where: { id: owner } });
    await prisma.$disconnect();
    if (error) throw new Error('UI fixture cleanup failed; metadata retained for authenticated cron cleanup.');
  }
});
