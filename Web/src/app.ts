import { GestureEngine, type Action } from './gesture.js';
import { ConnectionClient } from './connection.js';
import { TextSubmission } from './text-input.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = element<HTMLDivElement>('surface');
const textMode = element<HTMLElement>('text-mode');
const draft = element<HTMLTextAreaElement>('draft');
const pasteButton = element<HTMLButtonElement>('paste');
const modeButton = element<HTMLButtonElement>('mode-toggle');
const settingsButton = element<HTMLButtonElement>('open-settings');
const sheet = element<HTMLDialogElement>('settings');
const pointerSpeed = element<HTMLInputElement>('pointer-speed');
const scrollSpeed = element<HTMLInputElement>('scroll-speed');
const natural = element<HTMLInputElement>('natural');
const defaults = { pointer: 1.8, scroll: 1.4, natural: true };
let settings = { ...defaults }, inputMode = false, pasteTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const saved = JSON.parse(localStorage.getItem('sofapad-settings') || '{}');
  for (const key of ['pointer', 'scroll'] as const) if (typeof saved[key] === 'number' && saved[key] >= 0.3 && saved[key] <= 4) settings[key] = saved[key];
  if (typeof saved.natural === 'boolean') settings.natural = saved.natural;
} catch { /* Storage is optional; never store the text draft. */ }
function renderSettings() {
  pointerSpeed.value = String(settings.pointer); scrollSpeed.value = String(settings.scroll); natural.checked = settings.natural;
  element('pointer-value').textContent = settings.pointer.toFixed(1) + '×'; element('scroll-value').textContent = settings.scroll.toFixed(1) + '×';
}
function saveSettings() { try { localStorage.setItem('sofapad-settings', JSON.stringify(settings)); } catch {} renderSettings(); }
for (const [input, key] of [[pointerSpeed, 'pointer'], [scrollSpeed, 'scroll']] as const) input.addEventListener('input', () => { settings[key] = Number(input.value); saveSettings(); });
natural.addEventListener('change', () => { settings.natural = natural.checked; saveSettings(); });
element('reset').addEventListener('click', () => { settings = { ...defaults }; saveSettings(); });
renderSettings();

let pending: Action | undefined, frame = 0;
function flush() {
  cancelAnimationFrame(frame); frame = 0;
  const action = pending; pending = undefined; if (action) client.send(action);
}
function emit(action: Action) {
  if (action.type === 'click') { flush(); client.send(action); return; }
  const multiplier = action.type === 'scroll' ? settings.scroll * (settings.natural ? 1 : -1) : settings.pointer;
  action = { ...action, dx: action.dx * multiplier, dy: action.dy * multiplier };
  if (action.type !== 'move' && action.phase !== 'update') { flush(); client.send(action); return; }
  if (pending && pending.type === action.type) { pending.dx += action.dx; pending.dy += action.dy; }
  else { flush(); pending = action; }
  if (pending && (Math.abs(pending.dx) > 1800 || Math.abs(pending.dy) > 1800)) flush();
  if (!frame) frame = requestAnimationFrame(flush);
}
const gesture = new GestureEngine(emit);
function cancelGesture() {
  pending = undefined; cancelAnimationFrame(frame); frame = 0;
  gesture.reset(); surface.classList.remove('touching');
}
function renderPasteButton() { pasteButton.disabled = !client.enabled || !draft.value.length || submission.pending; }
const client = new ConnectionClient(update => {
  document.body.dataset.state = update.state;
  surface.setAttribute('aria-disabled', String(update.state !== 'connected'));
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
modeButton.addEventListener('click', () => {
  cancelGesture(); submission.cancelQueued(); inputMode = !inputMode;
  document.body.dataset.mode = inputMode ? 'input' : 'touch';
  surface.hidden = inputMode; textMode.hidden = !inputMode; settingsButton.hidden = inputMode;
  modeButton.textContent = inputMode ? '触控' : '输入'; modeButton.setAttribute('aria-pressed', String(inputMode));
  if (inputMode) draft.focus({ preventScroll: true }); // Must stay synchronous in this user gesture for iOS.
  else { draft.blur(); modeButton.blur(); }
});
surface.addEventListener('pointerdown', event => {
  if (!client.enabled || inputMode || sheet.open || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); surface.setPointerCapture(event.pointerId);
  gesture.down(event.pointerId, event.clientX, event.clientY, performance.now()); surface.classList.add('touching');
});
surface.addEventListener('pointermove', event => {
  if (!client.enabled || inputMode || sheet.open) return;
  event.preventDefault(); gesture.move(event.pointerId, event.clientX, event.clientY);
});
surface.addEventListener('pointerup', event => {
  if (client.enabled && !inputMode && !sheet.open) gesture.up(event.pointerId, event.clientX, event.clientY, performance.now());
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  surface.classList.remove('touching');
});
for (const type of ['pointercancel', 'lostpointercapture']) surface.addEventListener(type, event => {
  gesture.cancelContact((event as PointerEvent).pointerId); surface.classList.remove('touching');
});
for (const type of ['contextmenu', 'click', 'dblclick', 'selectstart']) surface.addEventListener(type, event => event.preventDefault());
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
window.addEventListener('resize', viewportChanged); viewportChanged(); renderPasteButton();
const pair = new URLSearchParams(location.hash.slice(1)).get('pair') || undefined;
if (location.hash) history.replaceState(null, '', location.pathname);
void client.connect(pair);
