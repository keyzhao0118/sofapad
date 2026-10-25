// Public download and onboarding flow, independent from the remote-control app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docs = path.join(root, 'docs');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'Web/package.json'), 'utf8'));
const expectedDownloads = new Set(['windows-x64-setup.exe', 'windows-x64.zip', 'macos-arm64.pkg', 'macos-arm64.zip', 'SHA256SUMS.txt'].map(s => `SofaPad-${version}-${s}`));
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(docs, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(docs + path.sep)) { response.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[path.extname(file)] ?? 'text/plain; charset=utf-8' }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BINARY || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const output = path.join(root, 'build/validation');
await fs.mkdir(output, { recursive: true });
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 900 : 1050 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /Windows.*Mac/);
    assert.match(await page.locator('h1').innerText(), /Windows.*Mac/);
    assert.equal(await page.locator('.hero-downloads [data-download]').count(), 2);
    const invalidAnchors = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(a => a.hash && !document.getElementById(a.hash.slice(1))).map(a => a.hash));
    assert.deepEqual(invalidAnchors, []);
    const downloads = await page.locator('a[href*="/releases/download/"]').evaluateAll(links => links.map(a => a.href));
    for (const link of downloads) {
      assert.ok(link.includes(`/v${version}/`), link);
      assert.ok(expectedDownloads.has(decodeURIComponent(new URL(link).pathname.split('/').at(-1))), link);
    }
    assert.equal(new Set(downloads.map(link => new URL(link).pathname.split('/').at(-1))).size, 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Horizontal overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `site-${width}.png`) });
    await page.locator('button[data-platform="macos"]').click();
    assert.equal(await page.locator('#macos-start').isVisible(), true);
    assert.equal(await page.locator('#windows-start').isVisible(), false);
    assert.equal(await page.locator('[data-platform="macos"]').getAttribute('aria-pressed'), 'true');
    await page.locator('button[data-platform="windows"]').click();
    assert.equal(await page.locator('#windows-start').isVisible(), true);
    await page.locator('#start').screenshot({ path: path.join(output, `site-guide-${width}.png`) });
    await page.locator('.download-card a[href="#macos-start"]').click();
    assert.equal(await page.locator('#macos-start').isVisible(), true);
    assert.equal(new URL(page.url()).hash, '#macos-start');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#macos-start').isVisible(), true, 'Deep link survives reload');
    await page.locator('.hero a[href="#install-prompts"]').click();
    assert.equal(await page.locator('#install-prompts').getAttribute('open'), '');
    await page.locator('#download').screenshot({ path: path.join(output, `site-download-${width}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS public site at ${width}px: downloads, anchors, platform switching, deep links, prompts and layout`);
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(url);
  assert.equal(await page.locator('#windows-start').isVisible(), true);
  assert.equal(await page.locator('#macos-start').isVisible(), true);
  assert.equal(await page.locator('.platform-switch').isVisible(), false);
  assert.equal(await page.locator('.hero-downloads a').count(), 2);
  await context.close();
  console.log('PASS downloads and both installation guides remain available without JavaScript');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
