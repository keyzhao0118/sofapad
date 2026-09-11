import { GestureEngine, type Action } from './gesture.js';
import { ConnectionClient } from './connection.js';
import { TextSubmission } from './text-input.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = element<HTMLDivElement>('surface');
const textMode = element<HTMLElement>('text-mode');
const touchMode = element<HTMLElement>('touch-mode');
const scrollEdges = document.querySelectorAll<HTMLElement>('.scroll-edge');
const touchTargets = [surface, ...scrollEdges];
const draft = element<HTMLTextAreaElement>('draft');
const pasteButton = element<HTMLButtonElement>('paste');
const modeButton = element<HTMLButtonElement>('mode-toggle');
const settingsButton = element<HTMLButtonElement>('open-settings');
const backspaceButton = element<HTMLButtonElement>('backspace');
const sheet = element<HTMLDialogElement>('settings');
const pointerSpeed = element<HTMLInputElement>('pointer-speed');
const scrollSpeed = element<HTMLInputElement>('scroll-speed');
const natural = element<HTMLInputElement>('natural');
const defaults = { pointer: 1.8, scroll: 1.4, natural: true };
// Apply to saved multipliers too, so existing users receive the slower baseline.
const scrollBaseScale = 0.4;
let settings = { ...defaults }, inputMode = false, pasteTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const saved = JSON.parse(localStorage.getItem('sofapad-settings') || '{}');
  for (const key of ['pointer', 'scroll'] as const) if (typeof saved[key] === 'number' && saved[key] >= 0.3 && saved[key] <= 4) settings[key] = saved[key];
  if (typeof saved.natural === 'boolean') settings.natural = saved.natural;
  // Discard obsolete mode preferences while retaining trackpad handfeel.
  localStorage.removeItem('sofapad-control-mode');
  localStorage.setItem('sofapad-settings', JSON.stringify(settings));
} catch { /* Storage is optional; never store the text draft. */ }
function renderSettings() {
  const speed = settings.pointer;
  pointerSpeed.value = String(speed); scrollSpeed.value = String(settings.scroll); natural.checked = settings.natural;
  element('pointer-value').textContent = speed.toFixed(1) + '×'; element('scroll-value').textContent = settings.scroll.toFixed(1) + '×';
}
function renderMode() {
  document.body.dataset.mode = inputMode ? 'input' : 'touch';
  touchMode.hidden = inputMode; textMode.hidden = !inputMode;
  settingsButton.hidden = inputMode;
  backspaceButton.hidden = !inputMode;
  if (!inputMode) window.getSelection()?.removeAllRanges();
  const label = inputMode ? '切换到触控板模式' : '切换到输入模式';
  modeButton.setAttribute('aria-label', label); modeButton.title = label;
  modeButton.setAttribute('aria-pressed', String(inputMode));
}
function saveSettings() { try { localStorage.setItem('sofapad-settings', JSON.stringify(settings)); } catch {} renderSettings(); }
pointerSpeed.addEventListener('input', () => { settings.pointer = Number(pointerSpeed.value); saveSettings(); });
scrollSpeed.addEventListener('input', () => { settings.scroll = Number(scrollSpeed.value); saveSettings(); });
natural.addEventListener('change', () => { settings.natural = natural.checked; saveSettings(); });
element('reset').addEventListener('click', () => {
  settings = { ...defaults }; saveSettings();
});
renderSettings();

let pending: Action | undefined, frame = 0;
function flush() {
  cancelAnimationFrame(frame); frame = 0;
  const action = pending; pending = undefined; if (action) client.send(action);
}
function emit(action: Action) {
  if (action.type === 'click') { flush(); client.send(action); return; }
  action = scaleMotion(action, settings.pointer);
  if (action.type !== 'move' && action.phase !== 'update') { flush(); client.send(action); return; }
  if (pending && pending.type === action.type) { pending.dx += action.dx; pending.dy += action.dy; }
  else { flush(); pending = action; }
  if (pending && (Math.abs(pending.dx) > 1800 || Math.abs(pending.dy) > 1800)) flush();
  if (!frame) frame = requestAnimationFrame(flush);
}
function scaleMotion(action: Exclude<Action, { type: 'click' }>, speed: number) {
  const multiplier = action.type === 'scroll' ? scrollBaseScale * settings.scroll * (settings.natural ? 1 : -1) : speed;
  return { ...action, dx: action.dx * multiplier, dy: action.dy * multiplier };
}
const gesture = new GestureEngine(emit);
function cancelGesture() {
  pending = undefined; cancelAnimationFrame(frame); frame = 0;
  gesture.reset();
  for (const target of touchTargets) target.classList.remove('touching');
}
function renderPasteButton() {
  pasteButton.disabled = !client.enabled || !draft.value.length || submission.pending;
  backspaceButton.disabled = !client.canBackspace || submission.pending;
}
const client = new ConnectionClient(update => {
  document.body.dataset.state = update.state;
  for (const target of touchTargets) target.setAttribute('aria-disabled', String(update.state !== 'connected'));
  element('connection-notice').hidden = update.state === 'connected';
  element('detail').textContent = update.detail;
  element('retry').hidden = !['busy', 'paused', 'error', 'offline'].includes(update.state);
  if (update.name) document.title = `${update.name} · SofaPad`;
  if (update.doubleClickMs) gesture.doubleClickMs = update.doubleClickMs;
  if (update.preview !== undefined) element('preview').hidden = !update.preview;
  renderPasteButton();
}, cancelGesture);
const submission = new TextSubmission(() => draft.value, text => client.paste(text), message => {
  if (message) {
    clearTimeout(pasteTimer); element('paste-notice').textContent = message; element('paste-notice').hidden = false;
    if (message === '粘贴指令已执行') pasteTimer = setTimeout(() => { element('paste-notice').hidden = true; }, 2400);
  }
  renderPasteButton();
});
draft.addEventListener('input', renderPasteButton);
draft.addEventListener('compositionstart', () => submission.compositionStart());
draft.addEventListener('compositionend', () => submission.compositionEnd());
pasteButton.addEventListener('pointerdown', event => event.preventDefault());
pasteButton.addEventListener('click', () => {
  void submission.submit();
  if (submission.composing) draft.blur();
});
backspaceButton.addEventListener('pointerdown', event => event.preventDefault());
backspaceButton.addEventListener('click', () => {
  if (!inputMode || sheet.open || submission.pending) return;
  client.backspace();
});
modeButton.addEventListener('click', () => {
  cancelGesture(); submission.cancelQueued(); inputMode = !inputMode;
  renderMode();
  if (inputMode) draft.focus({ preventScroll: true }); // Must stay synchronous in this user gesture for iOS.
  else { draft.blur(); modeButton.blur(); }
});
function canUseTrackpad() { return client.enabled && !inputMode && !sheet.open; }
for (const target of touchTargets) {
  const zone = target === surface ? 'pointer' : 'scroll';
  target.addEventListener('pointerdown', event => {
    if (!canUseTrackpad() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); target.setPointerCapture(event.pointerId);
    gesture.down(event.pointerId, event.clientX, event.clientY, performance.now(), zone);
    if (canUseTrackpad()) target.classList.add('touching');
  });
  target.addEventListener('pointermove', event => {
    if (!canUseTrackpad()) return;
    event.preventDefault(); gesture.move(event.pointerId, event.clientX, event.clientY);
  });
  target.addEventListener('pointerup', event => {
    if (canUseTrackpad()) { gesture.up(event.pointerId, event.clientX, event.clientY, performance.now()); flush(); }
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    target.classList.remove('touching');
  });
  for (const type of ['pointercancel', 'lostpointercapture']) target.addEventListener(type, event => {
    pending = undefined; cancelAnimationFrame(frame); frame = 0;
    gesture.cancelContact((event as PointerEvent).pointerId); target.classList.remove('touching');
  });
  for (const type of ['contextmenu', 'click', 'dblclick', 'selectstart']) target.addEventListener(type, event => event.preventDefault());
}
// Keep native selection in the editor, while control surfaces and chrome never
// produce the browser's selection/callout/drag feedback on repeated taps.
for (const type of ['selectstart', 'contextmenu', 'dragstart']) document.addEventListener(type, event => {
  if (inputMode && event.target === draft) return;
  event.preventDefault();
});
settingsButton.addEventListener('click', () => { cancelGesture(); sheet.showModal(); });
element('close-settings').addEventListener('click', () => sheet.close());
element('retry').addEventListener('click', () => { void client.connect(); });
function visibility(hidden: boolean) {
  if (hidden) { cancelGesture(); submission.cancelQueued(); }
  client.visibility(hidden);
}
document.addEventListener('visibilitychange', () => visibility(document.hidden));
window.addEventListener('pagehide', () => visibility(true));
window.addEventListener('pageshow', event => { if (event.persisted) visibility(false); });
window.addEventListener('online', () => client.networkChanged());
window.addEventListener('offline', () => client.networkChanged());
window.addEventListener('orientationchange', cancelGesture);
screen.orientation?.addEventListener('change', cancelGesture);
function viewportChanged() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--view-height', `${viewport?.height ?? innerHeight}px`);
  document.documentElement.style.setProperty('--view-top', `${viewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener('resize', viewportChanged);
window.visualViewport?.addEventListener('scroll', viewportChanged);
window.addEventListener('resize', viewportChanged); viewportChanged(); renderPasteButton(); renderMode();
const pair = new URLSearchParams(location.hash.slice(1)).get('pair') || undefined;
if (location.hash) history.replaceState(null, '', location.pathname);
void client.connect(pair);
