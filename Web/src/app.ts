import { GestureEngine, type Action, type EdgeSide } from './gesture.js';
import { ConnectionClient } from './connection.js';
import { TransientInput, TextSubmission, isDictationText, isDictationType, type InputAction, type TextEdit } from './text-input.js';
import { formatSpeed, positionOf, speedRanges, valueAt } from './settings-range.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = element<HTMLDivElement>('surface');
const textMode = element<HTMLElement>('text-mode');
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
const defaults = { pointer: speedRanges.pointer.middle, scroll: speedRanges.scroll.middle, natural: true };
// Apply to saved multipliers too, so existing users receive the slower baseline.
const scrollBaseScale = 0.4;
let settings = { ...defaults }, inputMode = false, pasteTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const saved = JSON.parse(localStorage.getItem('sofapad-settings') || '{}');
  for (const key of ['pointer', 'scroll'] as const) {
    const range = speedRanges[key];
    // Saved handfeel survives upgrades; anything outside the slider is clamped, not dropped.
    if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) settings[key] = valueAt(positionOf(saved[key], range), range);
  }
  if (typeof saved.natural === 'boolean') settings.natural = saved.natural;
  // Discard obsolete mode preferences while retaining trackpad handfeel.
  localStorage.removeItem('sofapad-control-mode');
  localStorage.setItem('sofapad-settings', JSON.stringify(settings));
} catch { /* Storage is optional; never store the text draft. */ }
function renderSettings() {
  natural.checked = settings.natural;
  for (const [input, key] of [[pointerSpeed, 'pointer'], [scrollSpeed, 'scroll']] as const) {
    const range = speedRanges[key], text = formatSpeed(settings[key]) + '×';
    input.value = String(Math.round(positionOf(settings[key], range)));
    input.setAttribute('aria-valuetext', text);
    element(key === 'pointer' ? 'pointer-value' : 'scroll-value').textContent = text;
  }
}
function renderMode() {
  document.body.dataset.mode = inputMode ? 'input' : 'touch';
  // The trackpad stays mounted; input mode only drops the panel in from the top.
  textMode.hidden = !inputMode;
  settingsButton.hidden = inputMode;
  if (!inputMode) window.getSelection()?.removeAllRanges();
  const label = inputMode ? '切换到触控板模式' : '切换到输入模式';
  modeButton.setAttribute('aria-label', label); modeButton.title = label;
  modeButton.setAttribute('aria-pressed', String(inputMode));
  renderInputState();
}
function saveSettings() { try { localStorage.setItem('sofapad-settings', JSON.stringify(settings)); } catch {} renderSettings(); }
pointerSpeed.addEventListener('input', () => { settings.pointer = valueAt(Number(pointerSpeed.value), speedRanges.pointer); saveSettings(); });
scrollSpeed.addEventListener('input', () => { settings.scroll = valueAt(Number(scrollSpeed.value), speedRanges.scroll); saveSettings(); });
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
// A band scroll starts on the trackpad, so the strip it belongs to lights up instead.
const gesture = new GestureEngine(emit, side => {
  for (const edge of scrollEdges) edge.classList.toggle('touching', side !== undefined && edge.dataset.side === side);
});
function cancelGesture() {
  pending = undefined; cancelAnimationFrame(frame); frame = 0;
  gesture.reset();
  for (const target of touchTargets) target.classList.remove('touching');
}
// Committed characters leave the box at once and drift up as fading chips.
function pushGhost(label: string) {
  const stream = element('ghost-layer');
  const chip = document.createElement('span');
  chip.className = 'ghost'; chip.textContent = label;
  stream.append(chip);
  while (stream.childElementCount > 24) stream.firstElementChild?.remove();
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
}
function sendInput(action: InputAction) {
  const sent = action.type === 'echo' ? true                  // already typed while dictating
    : action.type !== 'enter' ? client.edit(action.edit.delete, action.edit.text)
    : client.canEnter ? client.enter() : client.edit(0, '\n'); // old hosts still get a newline
  renderDictationState();
  return sent;
}
function announceInput(action: InputAction) {
  if (action.type === 'enter') { pushGhost('↵'); return; }
  announceEdit(action.type === 'echo' ? { delete: 0, text: action.text } : action.edit);
}
function announceEdit(edit: TextEdit) {
  for (let index = 0; index < Math.min(edit.delete, 4); index++) pushGhost('⌫');
  if (edit.delete > 4) pushGhost(`⌫×${edit.delete}`);
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    pushGhost(buffer.length > 16 ? `${buffer.slice(0, 16)}…` : buffer);
    buffer = '';
  };
  for (const character of edit.text) {
    if (character === '\n') { flush(); pushGhost('↵'); } else buffer += character;
  }
  flush();
}
// Dictated words sit dimmed in the field until the speaker pauses; then they are typed.
function renderDictationState() {
  const dictating = client.canEdit && transient.pendingDictation;
  document.body.dataset.dictating = String(dictating);
  // An old Mac app cannot receive a real Return, so say so instead of failing quietly.
  element('sync-hint').textContent = dictating ? '正在聆听…停顿一下就会发送'
    : client.canEnter ? '输入会实时同步到 Mac 光标处'
    : '输入会实时同步（更新 Mac App 后回车可发送 Return）';
}
// Live typing turns the field into a scratch buffer; older hosts keep the manual controls.
const draftPlaceholder = draft.placeholder;
let liveReady = false;
function renderInputState() {
  const liveTyping = client.canEdit;
  if (liveTyping !== liveReady) { liveReady = liveTyping; if (liveTyping) transient.reset(); else draft.value = ''; }
  pasteButton.hidden = liveTyping;
  backspaceButton.hidden = !inputMode || liveTyping;
  element('sync-hint').hidden = !inputMode || !liveTyping;
  element('ghost-layer').hidden = !liveTyping;
  document.body.dataset.live = String(liveTyping);
  renderDictationState();
  draft.placeholder = liveTyping ? '' : draftPlaceholder;
  draft.readOnly = liveTyping && !client.enabled;
  pasteButton.disabled = !client.enabled || !draft.value.length || submission.pending;
  backspaceButton.disabled = !client.canBackspace || submission.pending;
}
const client = new ConnectionClient(update => {
  document.body.dataset.state = update.state;
  for (const target of touchTargets) target.setAttribute('aria-disabled', String(update.state !== 'connected'));
  element('connection-notice').hidden = update.state === 'connected';
  element('detail').textContent = update.detail;
  element('retry').hidden = !['paused', 'error', 'offline'].includes(update.state);
  if (update.name) document.title = `${update.name} · SofaPad`;
  if (update.doubleClickMs) gesture.doubleClickMs = update.doubleClickMs;
  if (update.preview !== undefined) element('preview').hidden = !update.preview;
  // A fresh session cannot know the Mac field, so start from an empty scratch buffer.
  if (update.state === 'connected' && !composing) transient.reset();
  renderInputState();
}, cancelGesture);
const transient = new TransientInput(draft, sendInput, announceInput);
const submission = new TextSubmission(() => draft.value, text => client.paste(text), message => {
  if (message) {
    clearTimeout(pasteTimer); element('paste-notice').textContent = message; element('paste-notice').hidden = false;
    if (message === '粘贴指令已执行') pasteTimer = setTimeout(() => { element('paste-notice').hidden = true; }, 2400);
  }
  renderInputState();
});
let composing = false;
draft.addEventListener('beforeinput', () => { if (client.canEdit) transient.snapshot(); });
draft.addEventListener('input', event => {
  const input = event as InputEvent, inputType = input.inputType || '', composingNow = composing || input.isComposing;
  if (client.canEdit) {
    // IME candidates stay on the phone, but dictation is real words: type them as they arrive.
    if (isDictationType(inputType) || (composingNow && isDictationText(draft.value))) transient.dictate(draft.value);
    else if (composingNow) transient.observe();
    else transient.consume(inputType);
  }
  renderInputState();
});
// The delete key is decided before the field changes, so correcting pinyin stays local.
draft.addEventListener('keydown', event => {
  if (!client.canEdit) return;
  // The return key stays with the IME while candidates are open.
  if (event.key === 'Enter') {
    if (composing || event.isComposing) return;       // the IME confirms the candidate
    if (transient.macEnter()) event.preventDefault();
    return;
  }
  if (event.key !== 'Backspace') return;
  if (composing || event.isComposing || transient.pending()) return;
  if (transient.macDelete()) event.preventDefault();
});
draft.addEventListener('compositionstart', () => { composing = true; submission.compositionStart(); });
draft.addEventListener('compositionupdate', () => { composing = true; if (client.canEdit) transient.observe(); });
draft.addEventListener('compositionend', () => {
  composing = false; submission.compositionEnd(); transient.compositionEnded();
  // The final input event lands after compositionend; take whatever it left behind.
  if (client.canEdit) setTimeout(() => { if (!composing) transient.consume('insertFromComposition'); }, 0);
});
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
function setInputMode(next: boolean) {
  if (inputMode === next) return;
  cancelGesture(); submission.cancelQueued(); inputMode = next;
  renderMode();
  if (inputMode) { if (client.canEdit) transient.reset(); draft.focus({ preventScroll: true }); } // focus must stay synchronous for iOS
  else { draft.blur(); modeButton.blur(); }
}
modeButton.addEventListener('click', () => setInputMode(!inputMode));
// Dismissing the keyboard (the ✓ key or a tap outside) leaves keyboard mode. The mode
// button toggles the mode itself, so wait a moment and only act if nothing else did.
draft.addEventListener('blur', () => {
  if (!inputMode) return;
  setTimeout(() => {
    if (inputMode && document.activeElement !== draft && document.visibilityState === 'visible') setInputMode(false);
  }, 250);
});
function canUseTrackpad() { return client.enabled && !inputMode && !sheet.open; }
function cssLength(name: string, fallback: number) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
// The visible gradient is wider than the strip; a vertical drag starting anywhere in
// that band scrolls, so aiming a thumb a few pixels off the edge still works.
const edgeBand = cssLength('--edge-band', 76);
function edgeSide(x: number): EdgeSide | undefined {
  if (x <= edgeBand) return 'left';
  if (x >= surface.clientWidth - edgeBand) return 'right';
  return undefined;
}
for (const target of touchTargets) {
  const zone = target === surface ? 'pointer' : 'scroll';
  target.addEventListener('pointerdown', event => {
    if (!canUseTrackpad() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); target.setPointerCapture(event.pointerId);
    gesture.down(event.pointerId, event.clientX, event.clientY, performance.now(), zone, edgeSide(event.clientX));
    if (canUseTrackpad()) target.classList.add('touching');
  });
  target.addEventListener('pointermove', event => {
    if (!canUseTrackpad()) return;
    event.preventDefault(); gesture.move(event.pointerId, event.clientX, event.clientY, performance.now());
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
// Tapping the trackpad (or anywhere outside the panel) closes it and the keyboard.
element('viewport').addEventListener('pointerdown', event => {
  if (!inputMode) return;
  const target = event.target as HTMLElement;
  if (target.closest('#text-mode, .floating')) return;
  event.preventDefault();
  setInputMode(false);
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
window.addEventListener('resize', viewportChanged); viewportChanged(); renderInputState(); renderMode();
// Any device on the local network can open this address and take control.
if (location.hash) history.replaceState(null, '', location.pathname);
void client.connect();
