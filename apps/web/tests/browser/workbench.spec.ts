import { test, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { getCookies } from 'better-auth/cookies';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const screenshots = path.resolve('../../docs/delivery/screenshots');

test('login, navigation and responsive shell have no horizontal overflow', async ({ page }) => {
  await mkdir(screenshots, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(screenshots, 'desktop-login.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshots, 'mobile-login.png'), fullPage: true });
});

test('real local session, demo, ownership, files, chat, refresh, upload and logout', async ({ browser, baseURL }) => {
  test.skip(process.env.RUN_LIVE_BROWSER !== '1', 'Opt in to disposable DB/Storage fixtures using RUN_LIVE_BROWSER=1.');
  await mkdir(screenshots, { recursive: true });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 2 }) });
  const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'geo-private';
  const ids = [randomUUID(), randomUUID()];
  const contexts: BrowserContext[] = [];
  let analysisId: string | undefined;
  try {
    for (const [index, id] of ids.entries()) {
      const token = randomUUID();
      await prisma.user.create({ data: { id, name: index ? 'Outra sessão de teste' : 'Revisão técnica', email: `audit-${id}@example.invalid`, emailVerified: true } });
      await prisma.session.create({ data: { id: randomUUID(), token, userId: id, expiresAt: new Date(Date.now() + 3600_000) } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const cookie = getCookies({ baseURL, secret: process.env.BETTER_AUTH_SECRET }).sessionToken;
      const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64');
      await context.addCookies([{ name: cookie.name, value: encodeURIComponent(`${token}.${signature}`), url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
      contexts.push(context);
    }
    const page = await contexts[0].newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nova análise', exact: true })).toBeVisible();
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(screenshots, 'desktop-new-analysis.png'), fullPage: true });
    for (const [contentType, data, status] of [
      ['text/plain', '{}', 415], ['application/json', '{', 400],
      ['application/json', '{}', 422], ['application/json', '[]', 422],
      ['application/json', JSON.stringify({ padding: 'x'.repeat(17_000) }), 413],
    ] as const) {
      const response = await contexts[0].request.post(baseURL + '/api/analysis/upload', {
        headers: { Origin: baseURL!, 'Content-Type': contentType }, data: Buffer.from(data),
      });
      expect(response.status()).toBe(status);
    }
    const started = page.waitForResponse(response => response.url().endsWith('/api/analysis/demo') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Iniciar análise', exact: true }).click();
    const startResponse = await started;
    expect(startResponse.status()).toBe(202);
    analysisId = (await startResponse.json()).id;
    await page.screenshot({ path: path.join(screenshots, 'desktop-processing.png'), fullPage: true });
    await expect(page.getByRole('region', { name: 'Área candidata', exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.leaflet-interactive').first()).toBeVisible();
    await expect(page.locator('.leaflet-image-layer')).toBeVisible();
    await expect.poll(() => page.locator('.leaflet-image-layer').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: path.join(screenshots, 'desktop-results.png'), fullPage: true });
    const foreign = contexts[1].request;
    for (const endpoint of [`/api/analyses/${analysisId}`, `/api/analyses/${analysisId}/files/geojson`]) {
      expect((await foreign.get(baseURL + endpoint)).status()).toBe(404);
    }
    expect((await foreign.post(baseURL + `/api/analyses/${analysisId}/chat`, { headers: { Origin: baseURL! }, data: { question: 'Qual é a área?' } })).status()).toBe(404);
    for (const kind of ['geojson', 'classified', 'map', 'rgb', 'tif']) {
      const response = await contexts[0].request.get(baseURL + `/api/analyses/${analysisId}/files/${kind}`);
      expect(response.status()).toBe(200);
      expect((await response.body()).length).toBeGreaterThan(50);
    }
    await page.getByRole('tab', { name: 'Consultar análise', exact: true }).click();
    await page.getByRole('textbox', { name: 'Pergunta sobre a análise' }).fill('Qual é a área candidata e quais são as limitações?');
    await page.getByRole('button', { name: 'Enviar pergunta' }).click();
    await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
    await expect(page.locator('.chat-message.assistant')).toContainText(/candidatos|candidata/);
    await page.screenshot({ path: path.join(screenshots, 'desktop-chat.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Resultados', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(screenshots, 'mobile-results.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nova análise', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Enviar GeoTIFF', exact: true }).click();
    await page.getByLabel('Imagem multiespectral', { exact: true }).setInputFiles({ name: 'invalido.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(page.locator('.field-error[role="alert"]')).toContainText('TIFF');
    await page.screenshot({ path: path.join(screenshots, 'desktop-invalid-upload.png'), fullPage: true });
    await page.getByLabel('Imagem multiespectral', { exact: true }).setInputFiles(path.resolve('../../data/sample/imagem_multiespectral.tif'));
    await page.getByLabel('Máscara SCL (opcional)', { exact: true }).setInputFiles(path.resolve('../../data/sample/qualidade_scl.tif'));
    await page.getByLabel('Data de aquisição').fill('2025-08-16');
    await page.screenshot({ path: path.join(screenshots, 'desktop-upload.png'), fullPage: true });
    await page.getByRole('button', { name: 'Iniciar análise', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Área candidata', exact: true })).toBeVisible({ timeout: 120_000 });
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
    expect((await contexts[0].request.get(baseURL + '/api/analyses')).status()).toBe(401);
    console.log('Real browser flow passed: demo + upload + IDOR + files + chat + logout. OAuth provider handshake was not automated.');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    for (const ownerId of ids) {
      const analyses = await prisma.analysis.findMany({ where: { ownerId } });
      for (const analysis of analyses) {
        // A failed UI assertion may leave a genuine Python job running. Keep its
        // metadata for cron rather than deleting it before late uploads finish.
        let status = analysis.status;
        const deadline = Date.now() + 60_000;
        while (status === 'processing' && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          status = (await prisma.analysis.findUnique({ where: { id: analysis.id } }))?.status ?? 'gone';
        }
        if (status === 'processing') {
          await prisma.analysis.update({ where: { id: analysis.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
          console.warn('A disposable job is still running; metadata retained for authenticated cron cleanup.');
          continue;
        }
        const prefix = `users/${createHash('sha256').update(ownerId).digest('hex')}/analyses/${analysis.id}`;
        const files = [analysis.imagePath, analysis.sclPath, ...['candidatos.geojson', 'imagem_classificada.png', 'imagem_mapa.png', 'imagem_rgb.png', 'classificacao.tif', 'resultado.json'].map(file => `${prefix}/out/${file}`)].filter((file): file is string => !!file);
        const { error } = await storage.storage.from(bucket).remove(files);
        if (error) throw new Error('Disposable browser Storage cleanup failed.');
      }
      await prisma.analysis.deleteMany({ where: { ownerId, status: { not: 'processing' } } });
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${ownerId}:` } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    }
    await prisma.$disconnect();
  }
});
