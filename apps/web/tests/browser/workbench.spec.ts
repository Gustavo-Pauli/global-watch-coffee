import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { getCookies } from 'better-auth/cookies';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const screenshots = path.resolve('../../docs/delivery/screenshots');

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshots, name), fullPage: true, animations: 'disabled' });
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('dedicated sign-in is readable on desktop and mobile', async ({ page }) => {
  await mkdir(screenshots, { recursive: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/analyses$/);
  await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
  await expect(page.locator('.brand')).toHaveText('Global Watch');
  await expect(page.locator('.brand svg, .brand-product')).toHaveCount(0);
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await screenshot(page, 'desktop-login.png');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
  await noHorizontalOverflow(page);
  await screenshot(page, 'mobile-login.png');
});

test('real account, collection, creation, map tools, files, chat and mobile navigation', async ({ browser, baseURL }) => {
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
    await page.goto('/analyses');
    await expect(page.getByRole('heading', { name: 'Análises', exact: true })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Teams|Billing|Alertas|Configurações/ })).toHaveCount(0);
    await screenshot(page, 'desktop-analyses-empty.png');

    // The saved value is read after a full reload; only our disposable account
    // is edited through Better Auth, never the user's account.
    const account = page.getByRole('button', { name: 'Menu da conta', exact: true });
    await account.click();
    await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
    const profile = page.getByRole('dialog', { name: 'Meu perfil', exact: true });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Revisão técnica');
    await profile.getByRole('textbox', { name: 'Nome', exact: true }).fill('Revisão de plataforma');
    await screenshot(page, 'desktop-profile.png');
    await profile.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(profile).not.toBeVisible();
    await expect(account).toBeFocused();
    await page.reload();
    await account.click();
    await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
    await expect(profile.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Revisão de plataforma');
    await page.keyboard.press('Escape');
    await expect(profile).not.toBeVisible();
    await expect(account).toBeFocused();

    const create = page.getByTestId('page-header').getByRole('button', { name: 'Nova análise', exact: true });
    await create.click();
    const creation = page.getByRole('dialog', { name: 'Nova análise', exact: true });
    await expect(creation).toBeVisible();
    await expect(creation.getByRole('tab', { name: 'Enviar imagem', exact: true })).toHaveAttribute('aria-selected', 'true');
    await creation.getByLabel('Imagem multiespectral', { exact: true }).setInputFiles({ name: 'invalido.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(creation.getByRole('alert')).toContainText(/tif/i);
    await screenshot(page, 'desktop-invalid-upload.png');
    await page.keyboard.press('Escape');
    await expect(creation).not.toBeVisible();
    await expect(create).toBeFocused();

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
    await create.click();
    await creation.getByRole('tab', { name: 'Usar exemplo', exact: true }).click();
    await screenshot(page, 'desktop-new-analysis.png');
    const started = page.waitForResponse(response => response.url().endsWith('/api/analysis/demo') && response.request().method() === 'POST');
    await creation.getByRole('button', { name: 'Iniciar análise', exact: true }).click();
    const startResponse = await started;
    expect(startResponse.status()).toBe(202);
    analysisId = (await startResponse.json()).id;
    await expect(page).toHaveURL(new RegExp(`/analyses/${analysisId}$`));
    await screenshot(page, 'desktop-processing.png');
    await expect(page.locator('.leaflet-interactive').first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.leaflet-image-layer')).toBeVisible();
    await expect.poll(() => page.locator('.leaflet-image-layer').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(page.getByRole('tabpanel', { name: 'Informações', exact: true })).toBeVisible();
    await screenshot(page, 'desktop-results.png');

    // One tool at a time; opening and closing preserves the result map.
    await page.getByRole('button', { name: 'Camadas', exact: true }).click();
    const raster = page.getByRole('switch', { name: 'Imagem analisada', exact: true });
    await expect(raster).toBeChecked();
    await raster.click();
    await expect(page.locator('.leaflet-image-layer')).toHaveCount(0);
    await raster.click();
    await expect(page.locator('.leaflet-image-layer')).toBeVisible();
    const polygons = page.getByRole('switch', { name: 'Plantações de Café', exact: true });
    await polygons.click();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(0);
    await polygons.click();
    await expect(page.locator('.leaflet-interactive').first()).toBeVisible();
    await screenshot(page, 'desktop-layers.png');
    await page.getByRole('button', { name: 'Fechar camadas', exact: true }).click();

    await page.getByRole('tab', { name: 'Informações', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Informações', exact: true })).toBeVisible();
    await screenshot(page, 'desktop-information.png');
    await page.getByRole('button', { name: 'Baixar arquivos', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /GeoJSON/ }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/\.geojson$/);
    expect(await file.failure()).toBeNull();

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
    await page.getByRole('tab', { name: 'Assistente', exact: true }).click();
    await page.getByRole('textbox', { name: 'Pergunta sobre a análise', exact: true }).fill('Qual é a área candidata e quais são as limitações?');
    await page.getByRole('button', { name: 'Enviar pergunta', exact: true }).click();
    await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
    await expect(page.locator('.chat-message.assistant')).toContainText(/candidatos|candidata/);
    await screenshot(page, 'desktop-chat.png');
    await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();

    // A direct URL survives reload; the old UI lost the selected analysis.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/analyses/${analysisId}$`));
    await expect(page.locator('.leaflet-image-layer')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const closeInspector = page.getByRole('button', { name: 'Fechar painel', exact: true });
    if (await closeInspector.isVisible()) await closeInspector.click();
    await noHorizontalOverflow(page);
    await screenshot(page, 'mobile-results.png');
    await page.getByRole('button', { name: 'Mostrar resultados', exact: true }).click();
    await page.getByRole('tab', { name: 'Informações', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Informações', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, 'mobile-information.png');
    await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();

    await page.goto('/analyses');
    await expect(page.getByRole('heading', { name: 'Análises', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, 'mobile-analyses.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const record = page.locator(`a[href="/analyses/${analysisId}"]`).first();
    await expect(record).toBeVisible();
    const search = page.getByLabel('Buscar análises', { exact: true });
    await search.fill('registro-inexistente-auditoria');
    await expect(record).not.toBeVisible();
    await search.clear();
    await expect(record).toBeVisible();
    const filter = page.getByLabel('Filtrar por status', { exact: true });
    await filter.click();
    await page.getByRole('option', { name: 'Processando', exact: true }).click();
    await expect(record).not.toBeVisible();
    await filter.click();
    await page.getByRole('option', { name: 'Concluída', exact: true }).click();
    await expect(record).toBeVisible();
    await filter.click();
    await page.getByRole('option', { name: 'Todos os status', exact: true }).click();
    await screenshot(page, 'desktop-analyses.png');
    await record.click();
    await expect(page).toHaveURL(new RegExp(`/analyses/${analysisId}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/analyses$/);

    await create.click();
    await creation.getByLabel('Imagem multiespectral', { exact: true }).setInputFiles(path.resolve('../../data/sample/imagem_multiespectral.tif'));
    await creation.getByText('Opções da imagem', { exact: true }).click();
    await creation.getByLabel('Máscara SCL (opcional)', { exact: true }).setInputFiles(path.resolve('../../data/sample/qualidade_scl.tif'));
    await creation.getByLabel('Data de aquisição').fill('2025-08-16');
    await screenshot(page, 'desktop-upload.png');
    const uploadStarted = page.waitForResponse(response => response.url().endsWith('/api/analysis/start') && response.request().method() === 'POST');
    await creation.getByRole('button', { name: 'Iniciar análise', exact: true }).click();
    const uploadResponse = await uploadStarted;
    expect(uploadResponse.status()).toBe(202);
    const uploadId = (await uploadResponse.json()).id;
    expect(uploadId).not.toBe(analysisId);
    await expect(page).toHaveURL(new RegExp(`/analyses/${uploadId}$`));
    await expect(page.locator('.leaflet-image-layer')).toBeVisible({ timeout: 120_000 });
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Menu da conta', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sair da conta', exact: true }).click();
    await expect(page.getByRole('button', { name: /Continuar com Google/ })).toBeVisible();
    expect((await contexts[0].request.get(baseURL + '/api/analyses')).status()).toBe(401);
    console.log('Real browser flow passed: profile + collection + routes + demo + map tools + upload + IDOR + files + chat + logout. OAuth provider handshake was not automated.');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    for (const ownerId of ids) {
      const analyses = await prisma.analysis.findMany({ where: { ownerId } });
      for (const analysis of analyses) {
        // Keep metadata for authenticated cron if genuine processing is still
        // running; deleting it first could leave late-uploaded files orphaned.
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
