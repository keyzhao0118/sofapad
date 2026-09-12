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
const infoFile = join(directory, 'server.json');
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const server = spawn(join(root, '.build/debug/SofaPad'), ['--preview-server', '--port', String(port), '--web-root', join(root, 'Web/dist'), '--info-file', infoFile], { stdio: ['ignore', 'ignore', 'inherit'] });
let browser;
try {
  let info;
  for (let i = 0; i < 200; i++) {
    try { info = JSON.parse(await readFile(infoFile, 'utf8')); break; } catch { await delay(50); }
  }
  assert.ok(info, 'preview server started');
  browser = await chromium.launch({ executablePath: process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await context.newPage(), errors = [], messages = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framesent', event => { try { messages.push(JSON.parse(event.payload)); } catch {} }));
  await page.goto(info.url);
  await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.evaluate(() => document.cookie), '', 'no credential cookie is needed');
  const baseURL = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 20; i++) { await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected'); }
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'touch', 'always opens the trackpad');
  assert.equal(await page.locator('#remote-mode, input[name="control-mode"]').count(), 0);
  assert.equal(await page.locator('.mouse-icon').isVisible(), true);
  await page.locator('#open-settings').click();
  assert.equal(await page.locator('#pointer-speed').inputValue(), '50', 'the default pointer speed sits in the middle of the slider');
  assert.equal((await page.locator('#pointer-value').textContent()).trim(), '1.5×');
  assert.equal((await page.locator('#scroll-value').textContent()).trim(), '0.3×', 'the default scroll speed is 0.3×');
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
  assert.ok(Math.abs(messages.filter(m => m.type === 'scroll').reduce((sum, m) => sum + m.dy, 0) - 50 * 0.3 * 0.4) < 0.01, 'trackpad scroll uses the slower base scale and the 0.3× default');
  const artifacts = join(root, 'build/validation'); await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'phone-connected.png') });
  await page.locator('#open-settings').click(); await page.locator('#settings').waitFor({ state: 'visible' });
  await page.locator('#pointer-speed').fill('80'); await page.locator('#pointer-speed').dispatchEvent('input');
  const pointerSpeed = await page.evaluate(() => JSON.parse(localStorage.getItem('sofapad-settings')).pointer), scrollSpeed = 0.3;
  assert.ok(pointerSpeed > 2 && pointerSpeed < 5, 'slider position 80 is a fast pointer speed: ' + pointerSpeed);
  await page.screenshot({ path: join(artifacts, 'phone-settings.png') });
  await page.locator('#close-settings').click();
  // A second device is a second controller, not a queued visitor: both stay live.
  const second = await context.newPage();
  const secondMoves = [];
  second.on('websocket', socket => socket.on('framesent', event => { try { secondMoves.push(JSON.parse(event.payload)); } catch {} }));
  await second.goto(baseURL);
  await second.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => document.body.dataset.state), 'connected', 'the first controller keeps its connection');
  // Start well clear of the edge band, which turns vertical drags into scrolls.
  await second.mouse.move(pad.x + 150, pad.y + 200); await second.mouse.down();
  await second.mouse.move(pad.x + 190, pad.y + 240, { steps: 4 }); await second.mouse.up();
  await delay(150);
  assert.ok(secondMoves.some(message => message.type === 'move'), 'the second controller sends its own pointer input');
  await second.close();
  await delay(150);
  assert.equal(await page.evaluate(() => document.body.dataset.state), 'connected', 'closing the second controller leaves the first one alone');
  const beforeMode = messages.filter(m => ['click', 'move', 'scroll', 'drag'].includes(m.type)).length;
  await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#draft').evaluate(e => e === document.activeElement), true);
  // Let the panel finish dropping in before measuring it.
  await page.waitForFunction(() => document.querySelector('#text-mode').getAnimations().every(animation => animation.playState === 'finished'));
  assert.equal(await page.locator('#open-settings').isVisible(), false);
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-label'), '切换到触控板模式');
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'true');
  // This host advertises live typing, so the manual clipboard controls stay hidden.
  assert.equal(await page.locator('#paste').isVisible(), false);
  assert.equal(await page.locator('#backspace').isVisible(), false);
  assert.equal(await page.locator('#sync-hint').isVisible(), true);
  assert.equal(await page.locator('#ghost-layer').isVisible(), true);
  // Input mode is a panel over the trackpad, not a separate page.
  assert.deepEqual(await page.locator('#surface').boundingBox(), { x: 0, y: 0, width: 393, height: 852 });
  const panelBox = await page.locator('#text-mode').boundingBox();
  assert.ok(panelBox.y <= 80 && panelBox.y + panelBox.height <= 220, `input panel drops in from the top: ${JSON.stringify(panelBox)}`);
  assert.equal(await page.locator('#draft').getAttribute('readonly'), null);
  const returnBox = await page.locator('#mode-toggle').boundingBox();
  const draftBox = await page.locator('#draft').boundingBox();
  assert.ok(draftBox.y > returnBox.y + returnBox.height, `input textarea clears the top-right return button: ${JSON.stringify({ draftBox, returnBox })}`);
  assert.ok(draftBox.height >= 44 && draftBox.height <= 64, `live typing keeps the field one line tall: ${draftBox.height}`);
  const edits = () => messages.filter(m => m.type === 'edit');
  const chips = () => page.locator('#ghost-layer .ghost').allTextContents();
  const sentinel = '\u200b';
  const text = '  中文 👨‍👩‍👧‍👦 e\u0301\n第二行\n';
  await page.locator('#draft').fill(text);
  await delay(80);
  assert.equal(edits().filter(m => m.text).map(m => m.text).join(''), text, 'every committed character reaches the Mac');
  assert.equal(await page.locator('#draft').inputValue(), sentinel, 'the field stays empty: the text lives on the Mac');
  assert.ok((await chips()).some(chip => chip.includes('中文')), 'committed text drifts up as a fading chip');
  assert.ok(edits().every(m => m.delete === undefined || m.delete === 0));
  assert.ok(edits().every(m => m.v === 2 && Number.isInteger(m.seq)));
  assert.ok(edits().filter(m => m.text).every(m => new TextEncoder().encode(m.text).length <= 512));
  await page.evaluate(() => document.querySelector('#ghost-layer').replaceChildren());
  // Typing one character at a time: each one leaves the box and becomes its own chip.
  await page.locator('#draft').type('ab');
  await delay(80);
  assert.deepEqual(edits().filter(m => m.text).map(m => m.text).slice(-2), ['a', 'b']);
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  assert.deepEqual((await chips()).slice(-2), ['a', 'b'], 'each character is echoed as it is sent');
  const echoed = await page.locator('#ghost-layer .ghost').last().boundingBox();
  assert.ok(echoed.y >= draftBox.y - 4 && echoed.y + echoed.height <= draftBox.y + draftBox.height + 4,
    'the echo rests inside the input line first');
  const echoStyle = await page.locator('#ghost-layer .ghost').last().evaluate(e => ({ size: parseFloat(getComputedStyle(e).fontSize), left: e.getBoundingClientRect().x }));
  assert.ok(Math.abs(echoStyle.left - (draftBox.x + 19)) < 6, `the echo appears at the caret: ${JSON.stringify(echoStyle)} vs ${draftBox.x + 19}`);
  assert.ok(echoStyle.size >= 19, `the echoed character is bigger than the field text: ${echoStyle.size}`);
  await delay(1500);
  assert.equal(await page.locator('#ghost-layer .ghost').count(), 0, 'then it floats up and fades away');
  const editsBefore = edits().length;
  await page.locator('#draft').press('Backspace');
  await delay(80);
  assert.deepEqual(edits().slice(editsBefore).map(m => [m.delete ?? 0, m.text ?? '']), [[1, '']], 'the delete key deletes on the Mac');
  assert.ok((await chips()).includes('⌫'), 'the delete key drifts up too');
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  const enterBefore = messages.filter(m => m.type === 'enter').length, editsAtEnter = edits().length;
  await page.locator('#draft').press('Enter');
  await delay(80);
  assert.equal(messages.filter(m => m.type === 'enter').length, enterBefore + 1, 'return is a real Return press on the Mac');
  assert.equal(edits().length, editsAtEnter, 'return is never typed as a newline character');
  const enterMessage = messages.filter(m => m.type === 'enter').at(-1);
  assert.equal(enterMessage.v, 2); assert.ok(Number.isInteger(enterMessage.seq));
  assert.ok((await chips()).includes('↵'));
  assert.equal(await page.locator('#draft').evaluate(e => e === document.activeElement), true, 'typing keeps the native keyboard focused');
  assert.equal(messages.filter(m => m.type === 'paste').length, 0, 'live typing never falls back to the clipboard');
  assert.equal(messages.filter(m => ['click', 'move', 'scroll', 'drag'].includes(m.type)).length, beforeMode);
  await page.screenshot({ path: join(artifacts, 'phone-input.png') });
  await page.locator('#mode-toggle').click(); await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  // Composition events in one task: the candidate buffer stays on the phone, the commit reaches the Mac.
  await page.evaluate(() => {
    const field = document.querySelector('#draft'); field.value = 'zhong';
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    field.value = '最后选词 中文'; field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await delay(80);
  assert.equal(edits().filter(m => m.text).at(-1).text, '最后选词 中文');
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  assert.equal(messages.filter(m => m.type === 'paste').length, 0);
  // Dictation: recognised words reach the Mac while the phone keeps the marked text.
  const textsBefore = edits().filter(m => m.text).length;
  await page.evaluate(() => {
    const field = document.querySelector('#draft');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.value = '你好'; field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertDictationResult' }));
    field.value = '你好世界'; field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertDictationResult' }));
  });
  await delay(400);                                     // still speaking: the phrase stays local
  assert.equal(edits().filter(m => m.text).length, textsBefore, 'dictation waits for a pause');
  assert.equal(await page.locator('#draft').inputValue(), '你好世界', 'the phone holds the words');
  assert.equal(await page.locator('body').getAttribute('data-dictating'), 'true', 'pending words look like listening');
  await delay(1300);                                    // the speaker paused
  assert.deepEqual(edits().filter(m => m.text).slice(textsBefore).map(m => m.text), ['你好世界'], 'the paused phrase is typed once');
  assert.equal(await page.locator('body').getAttribute('data-dictating'), 'false');
  // Ending dictation only sends the words that are still pending.
  await page.evaluate(() => {
    const field = document.querySelector('#draft');
    field.value = '你好世界，今天';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertDictationResult' }));
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好世界，今天' }));
  });
  await delay(250);
  assert.deepEqual(edits().filter(m => m.text).slice(textsBefore).map(m => m.text), ['你好世界', '，今天'], 'only the pending words follow');
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  // Correcting a wrong pinyin must stay on the phone: deleting it is not a Mac delete.
  const correctionBefore = edits().length;
  await page.evaluate(() => {
    const field = document.querySelector('#draft');
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.value = 'she'; field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    field.value = 'sh'; field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'deleteContentBackward' }));
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    // iOS can deliver the trailing delete keys after the composition already ended.
    for (let index = 0; index < 3; index++) {
      field.value = ''; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
  });
  await delay(80);
  assert.equal(edits().length, correctionBefore, 'correcting pinyin never deletes on the Mac');
  assert.equal(await page.locator('#draft').inputValue(), sentinel);
  await delay(450);
  const settled = edits().length;
  await page.locator('#draft').press('Backspace');
  await delay(80);
  assert.deepEqual(edits().slice(settled).map(m => [m.delete ?? 0, m.text ?? '']), [[1, '']], 'once the IME settles, the delete key reaches the Mac');
  // Model the smaller visible area with the keyboard open; real iOS keyboard still needs a device.
  await page.setViewportSize({ width: 393, height: 330 });
  await page.waitForFunction(() => Math.abs(document.querySelector('#viewport').getBoundingClientRect().height - visualViewport.height) < 1 && visualViewport.height < 331);
  for (const selector of ['#draft', '#sync-hint', '#mode-toggle']) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 330, `${selector}: ${JSON.stringify(box)}`);
  }
  for (const selector of ['#paste', '#backspace']) assert.equal(await page.locator(selector).isVisible(), false);
  await page.screenshot({ path: join(artifacts, 'phone-input-compact.png') });
  await page.locator('#mode-toggle').click();
  assert.notEqual(await page.locator('#draft').evaluate(e => e === document.activeElement), true);
  await page.setViewportSize({ width: 393, height: 852 });
  // Dismissing the keyboard (the ✓ key or a tap outside) returns to the trackpad.
  await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'true');
  await page.locator('#draft').evaluate(e => e.blur());
  await page.waitForFunction(() => document.body.dataset.mode === 'touch');
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'false');
  // Tapping the trackpad closes the panel and the keyboard the same way.
  await page.locator('#mode-toggle').click();
  assert.equal(await page.locator('#mode-toggle').getAttribute('aria-pressed'), 'true');
  await page.mouse.click(40, 560);
  await page.waitForFunction(() => document.body.dataset.mode === 'touch');
  assert.equal(await page.locator('#text-mode').isVisible(), false, 'the panel hides again');
  assert.deepEqual(await page.locator('#surface').boundingBox(), { x: 0, y: 0, width: 393, height: 852 }, 'the trackpad never left');
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
  // "Tap, then press and drag": the press has to settle briefly, so a repeated swipe
  // straight after a stray tap keeps moving the pointer instead of dragging.
  await delay(200);
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
    assert.ok(Math.abs(scrolled.reduce((sum, m) => sum + m.dy, 0) - 80 * scrollSpeed * 0.4) < 0.01, 'both edges use the saved slower scroll multiplier');
  }
  // A contact beginning in the main panel remains pointer movement at the edge.
  const crossingStart = mouseMessages().length;
  await touch('touchStart', 100, 300); await touch('touchMove', 12, 340); await touch('touchEnd', 12, 340); await delay(50);
  assert.ok(mouseMessages().slice(crossingStart).every(m => m.type === 'move'));
  assert.ok(Math.abs(mouseMessages().slice(crossingStart).reduce((sum, m) => sum + m.dx, 0) + 88 * pointerSpeed) < 0.01);
  // The visible band is wider than the 28 px strip: a thumb that lands a few pixels off
  // the edge still scrolls, while horizontal motion and the centre keep moving the pointer.
  const bandStart = mouseMessages().length;
  await touch('touchStart', 50, 300); await touch('touchMove', 50, 340);
  assert.equal(await page.locator('#scroll-left').evaluate(e => e.classList.contains('touching')), true, 'the band lights the strip it scrolls');
  await touch('touchMove', 50, 380); await touch('touchEnd', 50, 380); await delay(50);
  const bandScroll = mouseMessages().slice(bandStart);
  assert.equal(bandScroll[0].phase, 'begin'); assert.equal(bandScroll.at(-1).phase, 'end');
  assert.ok(bandScroll.every(m => m.type === 'scroll' && m.dx === 0));
  assert.ok(Math.abs(bandScroll.reduce((sum, m) => sum + m.dy, 0) - 80 * scrollSpeed * 0.4) < 0.01, 'the band uses the same slower scroll multiplier');
  assert.equal(await page.locator('#scroll-left').evaluate(e => e.classList.contains('touching')), false, 'the highlight clears when the finger lifts');
  const outsideBand = mouseMessages().length;
  await touch('touchStart', 90, 300); await touch('touchMove', 90, 340); await touch('touchEnd', 90, 340); await delay(50);
  assert.ok(mouseMessages().slice(outsideBand).every(m => m.type === 'move'), 'past the band the trackpad still moves the pointer');
  const sideways = mouseMessages().length;
  await touch('touchStart', 50, 300); await touch('touchMove', 120, 306); await touch('touchEnd', 120, 306); await delay(50);
  assert.ok(mouseMessages().slice(sideways).every(m => m.type === 'move'), 'horizontal motion in the band keeps moving the pointer');
  const rightBand = mouseMessages().length;
  await touch('touchStart', 340, 300); await touch('touchMove', 340, 340); await touch('touchEnd', 340, 340); await delay(50);
  assert.ok(mouseMessages().slice(rightBand).every(m => m.type === 'scroll'), 'the right band scrolls as well');
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
  assert.ok(Math.abs(mouseMessages().slice(reversedStart).reduce((sum, m) => sum + m.dy, 0) + 50 * scrollSpeed * 0.4) < 0.01);
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
  assert.equal((await page.locator('#pointer-value').textContent()).trim(), '2.4×', 'a saved speed is restored');
  assert.ok(Number(await page.locator('#pointer-speed').inputValue()) > 50, 'a faster saved speed sits right of the middle');
  assert.equal(await page.locator('#draft').inputValue(), sentinel, 'the live-typing scratch buffer starts empty');
  await page.locator('#open-settings').click(); await page.locator('#reset').click();
  assert.equal(await page.locator('#pointer-speed').inputValue(), '50', 'reset returns to the middle');
  assert.equal((await page.locator('#pointer-value').textContent()).trim(), '1.5×');
  assert.equal((await page.locator('#scroll-value').textContent()).trim(), '0.3×');
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
  // The live-typing field only ever holds the scratch buffer, so select all of what is there.
  assert.equal(await page.locator('#draft').evaluate(e => { e.setSelectionRange(0, e.value.length); return e.selectionEnd - e.selectionStart; }), 1);
  assert.equal(await page.locator('#draft').inputValue(), sentinel, 'typing leaves the box empty for the next character');
  const cancelledSelection = await page.locator('#surface').evaluate(e => !e.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })));
  assert.equal(cancelledSelection, true);
  await page.locator('#mode-toggle').click();
  await page.evaluate(() => localStorage.setItem('sofapad-control-mode', 'unknown'));
  await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'connected');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'touch', 'obsolete mode preferences cannot restore remote');
  assert.deepEqual(errors, []);
  console.log('PASS: Chromium open access (no pairing, no cookie), 20 reloads, full trackpad, minimal mouse/keyboard toggle, input panel dropping over the trackpad, type-through one-line input (field cleared per commit, echo rests in the line then floats up and fades, chips for text and ⌫/↵, sentinel delete key, real Return key press, 512-byte chunks, deferred IME commit, pinyin correction stays local, dictation waiting for a pause then typing once, dismissing the keyboard returns to the trackpad), two controllers at once, 500 ms right-click and cancellation, double-tap drag, two/three fingers, both scroll edges with the wider decision band, cross-zone capture and 40% baseline, cancellation/mixed contacts, settings migration and reset, selection suppression, compact input and landscape. No system input generated.');
  console.log('Screenshots: build/validation/');
} finally {
  if (browser) await browser.close(); server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
}
