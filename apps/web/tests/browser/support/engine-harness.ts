import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';

const webRoot = path.resolve(__dirname, '../../..');
let bundledFixture: Promise<string> | undefined;

async function fixtureBundle() {
  // tsx is a direct, pinned development dependency. Its esbuild 0.27.7 dependency
  // is already pinned in pnpm-lock.yaml; this harness adds no tool or app route.
  const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
  const requireFromTsx = createRequire(requireFromWeb.resolve('tsx/package.json'));
  const esbuild = requireFromTsx('esbuild') as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
  };
  const result = await esbuild.build({
    absWorkingDir: webRoot,
    entryPoints: ['tests/browser/fixtures/map-engine.tsx'],
    outfile: 'engine-harness.js',
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_MAPTILER_KEY': '""' },
  });
  return result.outputFiles[0].text;
}

/** Real React/Leaflet components, mounted offline; no Next route, server or DB. */
export async function mountEngineHarness(page: Page) {
  bundledFixture ??= fixtureBundle();
  const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
  const [bundle, leafletCss, productLeafletCss] = await Promise.all([
    bundledFixture,
    readFile(requireFromWeb.resolve('leaflet/dist/leaflet.css'), 'utf8'),
    readFile(path.join(webRoot, 'app/leaflet.css'), 'utf8'),
  ]);
  await page.setContent('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: leafletCss + '\n' + productLeafletCss });
  // Layout only: adapter tests exercise the complete application stylesheet.
  await page.addStyleTag({ content: `
    html,body{margin:0;font:14px sans-serif;background:#171717;color:#ededee}
    button{margin:3px;padding:6px} output{display:block;padding:4px}
    #fixture-map{width:900px;height:600px;position:relative}
    #fixture-map .leaflet-container{width:100%;height:100%}
  ` });
  await page.addScriptTag({ content: bundle });
}
