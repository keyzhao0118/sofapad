// Optional desktop Chromium regression test. It does not substitute for iPhone Safari.
// PLAYWRIGHT_MODULE may point to a locally installed playwright/index.mjs.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import net from 'node:net';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '../..');
const directory = await mkdtemp(join(tmpdir(), 'sofapad-browser-'));
const pairFile = join(directory, 'pair.json');
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const server = spawn(join(root, '.build/debug/SofaPad'), ['--preview-server', '--port', String(port), '--web-root', join(root, 'Web/dist'), '--pair-file', pairFile], { stdio: ['ignore', 'ignore', 'inherit'] });
let browser;
try {
  let paired;
  for (let i = 0; i < 200; i++) {
    try { paired = JSON.parse(await readFile(pairFile, 'utf8')); break; } catch { await delay(50); }
  }
  assert.ok(paired, 'preview server started');
  browser = await chromium.launch({ executablePath: process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await context.newPage(), errors = [], messages = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => { try { messages.push(JSON.parse(event.payload)); } catch {} }));
  await page.goto(paired.url);
  await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.evaluate(() => document.cookie), '');
  const cookies = await context.cookies(); assert.ok(cookies.find(cookie => cookie.name === 'sofapad' && cookie.httpOnly && cookie.sameSite === 'Strict'));
  const baseURL = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 20; i++) { await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected'); }
  const pad = await page.locator('#surface').boundingBox();
  assert.deepEqual(pad, { x: 0, y: 0, width: 393, height: 852 });
  const settingsBox = await page.locator('#open-settings').boundingBox();
  assert.ok(settingsBox.x < 30 && settingsBox.y < 30 && settingsBox.width >= 44);
  await page.mouse.move(pad.x + 80, pad.y + 100); await page.mouse.down();
  await page.mouse.move(pad.x + 160, pad.y + 140, { steps: 12 }); await page.mouse.up();
  await page.mouse.click(pad.x + 140, pad.y + 150); await page.mouse.click(pad.x + 140, pad.y + 150);
  const cdp = await context.newCDPSession(page);
  const points = [{ x: pad.x + 80, y: pad.y + 150, id: 1 }, { x: pad.x + 180, y: pad.y + 150, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map(p => ({ ...p, x: p.x + 20, y: p.y + 50 })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(250);
  assert.ok(messages.some(m => m.type === 'move'));
  assert.deepEqual(messages.filter(m => m.type === 'click' && m.button === 'left').map(m => m.count), [1, 2]);
  assert.equal(messages.filter(m => m.type === 'click' && m.button === 'right').length, 1);
  assert.ok(messages.some(m => m.type === 'scroll' && m.phase === 'end'));
  const artifacts = join(root, 'build/validation'); await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'phone-connected.png') });
  await page.locator('#open-settings').click(); await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#pointer-speed').fill('2.4'); await page.locator('#pointer-speed').dispatchEvent('input');
  await page.screenshot({ path: join(artifacts, 'phone-settings.png') });
  await page.locator('#close-settings').click();
  const second = await context.newPage(); await second.goto(baseURL);
  await second.waitForFunction(() => document.body.dataset.state === 'busy'); await second.close();
  const beforeMode = messages.filter(m => ['click', 'move', 'scroll', 'drag'].includes(m.type)).length;
  await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#draft').evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('#open-settings').isVisible(), false);
  assert.equal(await page.locator('#paste').isDisabled(), true);
  const text = '  中文 👨‍👩‍👧‍👦 e\u0301\n第二行\n';
  await page.locator('#draft').fill(text);
  await page.locator('#paste').click();
  await page.waitForFunction(() => document.querySelector('#paste-notice').textContent === '粘贴指令已执行');
  assert.equal(await page.locator('#draft').inputValue(), text);
  assert.equal(messages.filter(m => m.type === 'paste').length, 1);
  assert.equal(messages.find(m => m.type === 'paste').text, text);
  assert.equal(messages.filter(m => ['click', 'move', 'scroll', 'drag'].includes(m.type)).length, beforeMode);
  await page.screenshot({ path: join(artifacts, 'phone-input.png') });
  await page.locator('#mode-toggle').click(); await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#draft').inputValue(), text);
  // Dispatch composition events in a single task to check that the final input wins.
  await page.evaluate(() => {
    const field = document.querySelector('#draft'); field.value = 'zhong';
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    document.querySelector('#paste').click();
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    field.value = '最后选词 中文'; field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#paste-notice').textContent === '粘贴指令已执行');
  await delay(50); assert.equal(messages.filter(m => m.type === 'paste').at(-1).text, '最后选词 中文');
  // Model the smaller visible area with the keyboard open; real iOS keyboard still needs a device.
  await page.setViewportSize({ width: 393, height: 330 });
  await page.waitForFunction(() => Math.abs(document.querySelector('#viewport').getBoundingClientRect().height - visualViewport.height) < 1 && visualViewport.height < 331);
  for (const selector of ['#draft', '#paste', '#mode-toggle']) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 330, `${selector}: ${JSON.stringify(box)}`);
  }
  await page.screenshot({ path: join(artifacts, 'phone-input-compact.png') });
  await page.locator('#mode-toggle').click();
  assert.notEqual(await page.locator('#draft').evaluate(e => e === document.activeElement), true);
  await page.setViewportSize({ width: 393, height: 852 });
  const triple = [...points, { x: 270, y: 150, id: 3 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: triple });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: triple.map(p => ({ ...p, x: p.x + 30, y: p.y + 15 })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(80);
  assert.ok(messages.some(m => m.type === 'drag' && m.phase === 'begin'));
  assert.ok(messages.some(m => m.type === 'drag' && m.phase === 'end'));
  assert.equal(await page.evaluate(() => document.body.dataset.state), 'connected');
  // Mode switch during a drag must send cancel before any text input.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: triple });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: triple.map(p => ({ ...p, x: p.x + 30 })) });
  await page.evaluate(() => document.querySelector('#mode-toggle').click());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(80); assert.ok(messages.some(m => m.type === 'drag' && m.phase === 'cancel'));
  await page.locator('#mode-toggle').click();
  await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.locator('#pointer-speed').inputValue(), '2.4');
  assert.equal(await page.locator('#draft').inputValue(), ''); // Draft is not persisted.
  await page.setViewportSize({ width: 852, height: 393 });
  await page.waitForFunction(() => document.querySelector('#surface').getBoundingClientRect().height === 393);
  assert.deepEqual(await page.locator('#surface').boundingBox(), { x: 0, y: 0, width: 852, height: 393 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'phone-landscape.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: Chromium pairing/cookie, 20 reloads, full viewport, top-left settings, two/three-touch gestures, drag mode cancellation, busy, text/IME, preserved drafts, compact input and landscape. No system input generated.');
  console.log('Screenshots: build/validation/');
} finally {
  if (browser) await browser.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
}
