import type { PasteOutcome } from './connection.js';

export type TextEdit = { delete: number; text: string };
/** What one committed change sends: an edit, or a real Return press. */
export type InputAction = { type: 'edit'; edit: TextEdit } | { type: 'enter' } | { type: 'echo'; text: string };

/** WebKit reports dictation with these input types. */
const DICTATION_INPUT_TYPES = new Set(['insertDictationResult', 'insertFromDictation']);
export function isDictationType(inputType: string): boolean { return DICTATION_INPUT_TYPES.has(inputType); }

/** Dictation arrives as words; a pinyin or romaji preedit is plain Latin and must stay on the phone. */
export function isDictationText(value: string): boolean {
  return /[\s\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value);
}

/** Backspace deletes one user-perceived character on the Mac, not one UTF-16 unit. */
export function graphemeCount(value: string): number {
  if (!value) return 0;
  const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(value: string): Iterable<unknown> } }).Segmenter;
  if (!Ctor) return [...value].length;
  try {
    let count = 0;
    const iterator = new Ctor(undefined, { granularity: 'grapheme' }).segment(value)[Symbol.iterator]();
    while (!iterator.next().done) count++;
    return count;
  } catch { return [...value].length; }
}

/** Rewrites only the tail that differs, which is exactly what the Mac cursor needs. */
export function reconcile(previous: string, next: string): TextEdit | null {
  if (previous === next) return null;
  let common = 0;
  const shortest = Math.min(previous.length, next.length);
  while (common < shortest && previous[common] === next[common]) common++;
  if (common > 0 && common < previous.length) {
    const unit = previous.charCodeAt(common);
    if (unit >= 0xdc00 && unit <= 0xdfff) common--;   // never split a surrogate pair
  }
  return { delete: graphemeCount(previous.slice(common)), text: next.slice(common) };
}

/** A zero-width space stays in the field so an "empty" box still reports the delete key. */
export const SENTINEL = '\u200b';

type Field = { value: string; setSelectionRange(start: number, end: number): void };

/** Backspace bursts that follow an IME composition are the IME correcting itself. */
const IME_SETTLE_MS = 400;
/** How long a dictated phrase must stay unchanged before the speaker has finished it. */
export const DICTATION_SETTLE_MS = 1200;

type Timers = { schedule: (run: () => void, ms: number) => number; cancel: (handle: number) => void };
const browserTimers: Timers = {
  schedule: (run, ms) => window.setTimeout(run, ms) as unknown as number,
  cancel: handle => window.clearTimeout(handle),
};

/** Type-through input: every committed change leaves the field immediately as one edit.
 * The field is only a scratch buffer for the IME and the keyboard; what the user typed
 * lives on the Mac and in the fading stream above the box, never in the box itself. */
export class TransientInput {
  private last = SENTINEL;
  private composedAt = Number.NEGATIVE_INFINITY;
  private dictating = '';      // recognised words still waiting for a pause
  private flushed = '';        // words already typed on the Mac in this dictation
  private settle?: number;     // fires when the speaker pauses
  constructor(private field: Field, private send: (action: InputAction) => boolean,
    private announce: (action: InputAction) => void, private now: () => number = () => performance.now(),
    private timers: Timers = browserTimers) {}
  /** Return the field to an empty, ready-to-type state without sending anything. */
  reset() {
    if (this.settle !== undefined) this.timers.cancel(this.settle);
    this.settle = undefined; this.dictating = ''; this.flushed = '';
    this.field.value = SENTINEL;
    this.last = SENTINEL;
    this.field.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }
  /** True while recognised words are still waiting on the phone. */
  get pendingDictation(): boolean { return this.dictating !== this.flushed; }
  /** Field text that has not reached the Mac yet; IME marked text counts as content. */
  pending(): string {
    const value = this.field.value;
    return value.startsWith(SENTINEL) ? value.slice(SENTINEL.length) : value;
  }
  /** Record the field after an event we leave to the IME (composition updates). */
  observe() { this.last = this.field.value; }
  /** Record the field before an event mutates it, so delete decisions see the real state. */
  snapshot() { this.last = this.field.value; }
  /** The IME just finished; its trailing deletes must not reach the Mac. */
  compositionEnded() { this.composedAt = this.now(); }
  /** One backspace for a delete key pressed on an otherwise empty box, unless the IME is settling. */
  macDelete(): InputAction | null {
    if (this.now() - this.composedAt <= IME_SETTLE_MS) return null;
    this.reset();
    return this.emit({ type: 'edit', edit: { delete: 1, text: '' } });
  }
  /** Dictation holds the recognised words until the speaker pauses: that phrase is final
   * enough to type, and late corrections then only touch what is still on the phone. */
  dictate(value: string): void {
    this.dictating = value.startsWith(SENTINEL) ? value.slice(SENTINEL.length) : value;
    if (this.settle !== undefined) this.timers.cancel(this.settle);
    this.settle = undefined;
    if (!this.dictating) return;
    this.settle = this.timers.schedule(() => { this.settle = undefined; this.flushDictation(); }, DICTATION_SETTLE_MS);
  }
  /** Send the phrase that is waiting, if the speaker has moved on. Returns the edit sent. */
  flushDictation(): InputAction | null {
    const edit = reconcile(this.flushed, this.dictating);
    this.flushed = this.dictating;
    if (!edit) return null;
    return this.emit({ type: 'edit', edit });
  }
  /** A real Return press for the phone's return key. */
  macEnter(): InputAction | null {
    this.reset();
    return this.emit({ type: 'enter' });
  }
  /** Consume one committed input event; returns the action that was sent, if any. */
  consume(inputType: string): InputAction | null {
    const previous = this.last, value = this.field.value, streamed = this.flushed;
    this.reset();
    if (inputType.startsWith('history')) return null; // Undo/redo must not replay text.
    if (previous === SENTINEL && value.length < SENTINEL.length) {
      // The box was already empty, so this delete key targets the Mac. Correcting pinyin
      // leaves marked text in the field first, and the settling window covers the rest.
      if (this.now() - this.composedAt <= IME_SETTLE_MS) return null;
      return this.emit({ type: 'edit', edit: { delete: 1, text: '' } });
    }
    if (inputType.startsWith('delete')) return null; // an IME delete never types text
    const pending = value.startsWith(SENTINEL) ? value.slice(SENTINEL.length) : value;
    if (streamed) {
      // Dictation already reached the Mac: send only a late revision, then let the whole
      // phrase drift up as the field clears.
      const edit = reconcile(streamed, pending);
      if (edit) return this.emit({ type: 'edit', edit });
      return pending ? this.emit({ type: 'echo', text: pending }) : null;
    }
    if (!pending) return null;
    // The return key inserts a line break, but the Mac should see a real Return press.
    const lineBreak = inputType === 'insertLineBreak' || inputType === 'insertParagraph' || pending === '\n';
    return this.emit(lineBreak ? { type: 'enter' } : { type: 'edit', edit: { delete: 0, text: pending } });
  }
  private emit(action: InputAction, announce = true): InputAction | null {
    if (!this.send(action)) return null;
    if (announce) this.announce(action);
    return action;
  }
}

export const pasteMessages: Record<PasteOutcome, string> = {
  executed: '粘贴指令已执行', uncertain: '请查看电视确认是否已粘贴',
  not_sent: '尚未发送，请连接 Mac 后重试', permission: '请在 Mac 上授予辅助功能权限',
  clipboard_failed: 'Mac 剪贴板写入失败，未执行粘贴', unavailable: '粘贴指令未执行，请在 Mac 上检查权限',
  busy: '请等待当前操作完成', too_large: '文字过长，请缩短后重试（不会自动截断）',
  expired: 'Mac 已重新启动，请确认电视内容后重新发送', id_conflict: '请求编号冲突，未再次执行',
  limit: '本次服务的文本请求已达上限，请重新启动 Mac 服务进程',
};

/** A draft stays in the textarea. IME completion is read on the following task,
 * after the final input event, never from the candidate/composition buffer. */
export class TextSubmission {
  composing = false;
  private queued = false;
  private sending = false;
  private commitTimer?: ReturnType<typeof setTimeout>;
  get pending() { return this.queued || this.sending; }
  constructor(private read: () => string, private send: (text: string) => Promise<PasteOutcome>,
    private update: (message: string) => void) {}
  compositionStart() { this.composing = true; }
  compositionEnd() {
    this.composing = false;
    if (this.queued) this.commitTimer = setTimeout(() => { this.queued = false; void this.submit(); }, 0);
  }
  async submit() {
    if (this.pending) return;
    if (this.composing) { this.queued = true; this.update('请完成选词后粘贴'); return; }
    const text = this.read(); if (!text) return;
    this.sending = true; this.update('正在发送…');
    try { this.update(pasteMessages[await this.send(text)]); }
    catch { this.update(pasteMessages.uncertain); }
    finally { this.sending = false; this.update(''); }
  }
  cancelQueued() { this.queued = false; clearTimeout(this.commitTimer); this.update(''); }
}
