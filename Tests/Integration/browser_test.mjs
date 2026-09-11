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
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'touch', 'always opens the trackpad');
  assert.equal(await page.locator('#remote-mode, input[name="control-mode"]').count(), 0);
  assert.equal(await page.locator('.mouse-icon').isVisible(), true);
  await page.locator('#open-settings').click();
  assert.equal(await page.locator('#pointer-speed').inputValue(), '1.8');
  await page.locator('#close-settings').click();
  const pad = await page.locator('#surface').boundingBox();
  assert.deepEqual(pad, { x: 0, y: 0, width: 393, height: 852 });
  const settingsBox = await page.locator('#open-settings').boundingBox();
  assert.ok(settingsBox.x < 30 && settingsBox.y < 30 && settingsBox.width >= 44);
  const inputBox = await page.locator('#mode-toggle').boundingBox();
  assert.ok(inputBox.y < 30 && inputBox.x > 250 && inputBox.x + inputBox.width <= 393, 'input button stays top-right');
  assert.equal((await page.locator('#mode-toggle').textContent()).trim(), '', 'mode toggle uses icons without visible text');
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-label'), '切换到输入模式');
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#backspace').isVisible(), false);
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
  assert.ok(Math.abs(messages.filter(m => m.type === 'scroll').reduce((sum, m) => sum + m.dy, 0) - 50 * 1.4 * 0.4) < 0.01, 'trackpad scroll uses the slower base scale');
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
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-label'), '切换到触控板模式');
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'true');
  const deleteBox = await page.locator('#backspace').boundingBox();
  assert.ok(deleteBox.x < 30 && deleteBox.y < 30 && deleteBox.width >= 44 && deleteBox.height >= 44);
  assert.equal(await page.locator('#backspace').isDisabled(), false, 'Mac backspace is available even with an empty local draft');
  assert.equal(await page.locator('#paste').isDisabled(), true);
  const returnBox = await page.locator('#mode-toggle').boundingBox();
  const draftBox = await page.locator('#draft').boundingBox();
  assert.ok(draftBox.y > returnBox.y + returnBox.height, 'input textarea clears the top-right return button');
  const text = '  中文 👨‍👩‍👧‍👦 e\u0301\n第二行\n';
  await page.locator('#draft').fill(text);
  const backspacesBefore = messages.filter(m => m.type === 'backspace').length;
  // Hold the button: a single release sends one backspace, without autorepeat.
  await page.mouse.move(deleteBox.x + 24, deleteBox.y + 24); await page.mouse.down(); await delay(700);
  assert.equal(messages.filter(m => m.type === 'backspace').length, backspacesBefore);
  await page.mouse.up(); await delay(50);
  assert.equal(messages.filter(m => m.type === 'backspace').length, backspacesBefore + 1);
  assert.equal(await page.locator('#draft').inputValue(), text, 'Mac backspace leaves the phone draft intact');
  assert.equal(await page.locator('#draft').evaluate(e => e === document.activeElement), true, 'backspace keeps the native keyboard focused');
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
  for (const selector of ['#draft', '#paste', '#mode-toggle', '#backspace']) {
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
  const mouseMessages = () => messages.filter(m => ['click', 'move', 'scroll', 'drag'].includes(m.type));
  const single = [{ x: 150, y: 300, id: 1 }];
  const longPressStart = mouseMessages().length;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: single });
  await delay(350);
  assert.equal(mouseMessages().length, longPressStart, 'hold must wait 500 ms');
  await delay(300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: single.map(p => ({ ...p, x: p.x + 30 })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(50);
  assert.deepEqual(mouseMessages().slice(longPressStart).map(m => [m.type, m.button, m.count]), [['click', 'right', 1]], 'hold fires exactly once without trailing motion or a left click');
  const tapDragStart = mouseMessages().length;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: single });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: single });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: single.map(p => ({ ...p, x: p.x + 30, y: p.y + 20 })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(50);
  const tapDrag = mouseMessages().slice(tapDragStart);
  assert.deepEqual(tapDrag.filter(m => m.type === 'click').map(m => [m.button, m.count]), [['left', 1]]);
  assert.equal(tapDrag.find(m => m.type === 'drag').phase, 'begin'); assert.equal(tapDrag.at(-1).phase, 'end');
  assert.ok(tapDrag.every(m => ['click', 'drag'].includes(m.type)));
  const touch = async (type, x = 150, y = 300) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }],
  });
  // Opening settings or switching to the keyboard cancels a pending hold.
  for (const selector of ['#open-settings', '#mode-toggle']) {
    const before = mouseMessages().length;
    await touch('touchStart'); await page.locator(selector).evaluate(e => e.click());
    await delay(650); await touch('touchEnd'); await delay(50);
    assert.equal(mouseMessages().length, before);
    await page.locator(selector === '#open-settings' ? '#close-settings' : '#mode-toggle').click();
  }
  for (const [side, x, outside] of [['left', 12, 80], ['right', 380, 310]]) {
    assert.deepEqual(await page.locator(`#scroll-${side}`).boundingBox(), { x: side === 'left' ? 0 : 365, y: 0, width: 28, height: 852 });
    const before = mouseMessages().length;
    await touch('touchStart', x, 300); await touch('touchEnd', x, 300);
    await touch('touchStart', x, 300); await delay(600); await touch('touchMove', outside, 300); await touch('touchEnd', outside, 300);
    await delay(50); assert.equal(mouseMessages().length, before, 'edge tap, hold and horizontal motion do nothing');
    await touch('touchStart', x, 300); await touch('touchMove', x, 340); await touch('touchMove', outside, 380);
    await delay(60); await page.screenshot({ path: join(artifacts, `phone-scroll-${side}.png`) });
    await touch('touchEnd', outside, 380); await delay(50);
    const scrolled = mouseMessages().slice(before);
    assert.equal(scrolled[0].phase, 'begin'); assert.equal(scrolled.at(-1).phase, 'end');
    assert.ok(scrolled.every(m => m.type === 'scroll' && m.dx === 0));
    assert.ok(Math.abs(scrolled.reduce((sum, m) => sum + m.dy, 0) - 80 * 1.4 * 0.4) < 0.01, 'both edges use the saved slower scroll multiplier');
  }
  // A contact beginning in the main panel remains pointer movement at the edge.
  const crossingStart = mouseMessages().length;
  await touch('touchStart', 100, 300); await touch('touchMove', 12, 340); await touch('touchEnd', 12, 340); await delay(50);
  assert.ok(mouseMessages().slice(crossingStart).every(m => m.type === 'move'));
  assert.ok(Math.abs(mouseMessages().slice(crossingStart).reduce((sum, m) => sum + m.dx, 0) + 88 * 2.4) < 0.01);
  // Mixed zones and browser cancellation release a scroll and cannot leave clicks behind.
  for (const cancel of ['second-contact', 'touchCancel', 'keyboard']) {
    const before = mouseMessages().length;
    await touch('touchStart', 12, 300); await touch('touchMove', 12, 340);
    if (cancel === 'second-contact') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 12, y: 340, id: 1 }, { x: 200, y: 300, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 12, y: 400, id: 1 }, { x: 220, y: 350, id: 2 }] });
      await touch('touchEnd');
    } else if (cancel === 'keyboard') {
      await page.locator('#mode-toggle').evaluate(e => e.click()); await touch('touchEnd');
      await page.locator('#mode-toggle').click();
    } else await touch('touchCancel');
    await delay(50);
    const actions = mouseMessages().slice(before);
    assert.deepEqual(actions.map(m => m.phase), ['begin', 'cancel']);
    assert.ok(actions.every(m => m.type === 'scroll'));
  }
  await page.locator('#open-settings').click(); await page.locator('#natural').uncheck(); await page.locator('#close-settings').click();
  const reversedStart = mouseMessages().length;
  await touch('touchStart', 380, 300); await touch('touchMove', 380, 350); await touch('touchEnd', 380, 350); await delay(50);
  assert.ok(Math.abs(mouseMessages().slice(reversedStart).reduce((sum, m) => sum + m.dy, 0) + 50 * 1.4 * 0.4) < 0.01);
  await page.locator('#open-settings').click(); await page.locator('#natural').check(); await page.locator('#close-settings').click();
  const hiddenBackspaces = messages.filter(m => m.type === 'backspace').length;
  await page.locator('#backspace').evaluate(e => e.click()); await delay(50);
  assert.equal(messages.filter(m => m.type === 'backspace').length, hiddenBackspaces, 'backspace cannot fire outside input mode');
  // Upgrading from a saved remote mode returns to the trackpad and preserves its handfeel.
  await page.evaluate(() => {
    localStorage.setItem('sofapad-control-mode', 'remote');
    localStorage.setItem('sofapad-settings', JSON.stringify({ pointer: 2.4, remote: 0.8, scroll: 1.4, natural: true }));
  });
  await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'touch');
  assert.equal(await page.evaluate(() => localStorage.getItem('sofapad-control-mode')), null);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sofapad-settings'))), { pointer: 2.4, scroll: 1.4, natural: true });
  assert.equal(await page.locator('#pointer-speed').inputValue(), '2.4');
  assert.equal(await page.locator('#draft').inputValue(), '');
  await page.locator('#open-settings').click(); await page.locator('#reset').click();
  assert.equal(await page.locator('#pointer-speed').inputValue(), '1.8');
  await page.locator('#close-settings').click();
  await page.setViewportSize({ width: 852, height: 393 });
  await page.waitForFunction(() => document.querySelector('#surface').getBoundingClientRect().height === 393);
  assert.deepEqual(await page.locator('#surface').boundingBox(), { x: 0, y: 0, width: 852, height: 393 });
  assert.deepEqual(await page.locator('#scroll-left').boundingBox(), { x: 0, y: 0, width: 28, height: 393 });
  assert.deepEqual(await page.locator('#scroll-right').boundingBox(), { x: 824, y: 0, width: 28, height: 393 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'phone-landscape.png') });
  // Control chrome cannot be selected; the editor retains native text selection.
  await page.locator('#open-settings').click(); await page.locator('#settings-title').dblclick();
  assert.equal(await page.evaluate(() => getSelection().toString()), '');
  assert.equal(await page.locator('#settings-title').evaluate(e => getComputedStyle(e).userSelect), 'none');
  await page.locator('#close-settings').click(); await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#draft').evaluate(e => getComputedStyle(e).userSelect), 'text');
  await page.locator('#draft').fill('editable draft');
  assert.equal(await page.locator('#draft').evaluate(e => { e.setSelectionRange(0, 8); return e.selectionEnd - e.selectionStart; }), 8);
  const cancelledSelection = await page.locator('#surface').evaluate(e => !e.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })));
  assert.equal(cancelledSelection, true);
  await page.locator('#mode-toggle').click();
  await page.evaluate(() => localStorage.setItem('sofapad-control-mode', 'unknown'));
  await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'touch', 'obsolete mode preferences cannot restore remote');
  assert.deepEqual(errors, []);
  console.log('PASS: Chromium pairing/cookie, 20 reloads, full trackpad, minimal mouse/keyboard toggle, input-only backspace, text/IME/drafts, busy, 500 ms right-click and cancellation, double-tap drag, two/three fingers, both scroll edges with cross-zone capture and 40% baseline, cancellation/mixed contacts, settings migration and reset, selection suppression, compact input and landscape. No system input generated.');
  console.log('Screenshots: build/validation/');
} finally {
  if (browser) await browser.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
}
