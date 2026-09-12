import test from 'node:test';
import assert from 'node:assert/strict';
import { SENTINEL, TransientInput, TextSubmission, isDictationText, isDictationType } from '../dist/text-input.js';

const edit = (remove, text) => ({ type: 'edit', edit: { delete: remove, text } });

function fakeTimers() {
  const jobs = new Map();
  let next = 0;
  return {
    schedule(run, ms) { jobs.set(++next, { run, ms }); return next; },
    cancel(handle) { jobs.delete(handle); },
    fire() { const all = [...jobs.values()]; jobs.clear(); all.forEach(job => job.run()); },
    pending: () => jobs.size,
  };
}
function setup(at = 0, timers = fakeTimers()) {
  const box = { value: '', setSelectionRange() {} };
  const sent = [], shown = [], clock = { at };
  const input = new TransientInput(box, action => { sent.push(action); return true; }, action => shown.push(action), () => clock.at, timers);
  input.reset();
  return { box, sent, shown, clock, input, timers };
}

test('type-through sends each committed change and leaves the field empty', () => {
  const { box, sent, shown, input } = setup();
  assert.equal(box.value, SENTINEL);
  assert.equal(input.consume('insertText'), null);                 // nothing committed yet
  box.value = SENTINEL + 'a';
  assert.deepEqual(input.consume('insertText'), edit(0, 'a'));
  assert.equal(box.value, SENTINEL, 'the typed character leaves the box'); // and lives in the chip stream
  box.value = SENTINEL + '你好';
  assert.deepEqual(input.consume('insertFromComposition'), edit(0, '你好'));
  box.value = SENTINEL + 'restored';
  assert.equal(input.consume('historyUndo'), null, 'undo never replays text');
  assert.equal(box.value, SENTINEL);
  assert.deepEqual(sent, [edit(0, 'a'), edit(0, '你好')]);
  assert.deepEqual(shown, sent);
});
test('the return key becomes a real Return press on the Mac', () => {
  const { box, sent, input } = setup();
  box.value = SENTINEL + '\n';
  assert.deepEqual(input.consume('insertLineBreak'), { type: 'enter' });
  assert.equal(box.value, SENTINEL, 'the newline does not stay in the box');
  input.macEnter();                                                // the keydown path
  assert.deepEqual(sent, [{ type: 'enter' }, { type: 'enter' }]);
  box.value = SENTINEL + '\n';
  assert.deepEqual(input.consume('insertFromPaste'), { type: 'enter' }, 'a pasted newline is a Return too');
  box.value = SENTINEL + 'a\nb';
  assert.deepEqual(input.consume('insertFromPaste'), edit(0, 'a\nb'), 'pasted text keeps its newlines as text');
});
test('the delete key on an empty box sends exactly one backspace', () => {
  const { box, sent, input } = setup();
  input.snapshot();                                                // beforeinput with an empty box
  box.value = '';                                                  // the delete key ate the sentinel
  assert.deepEqual(input.consume('deleteContentBackward'), edit(1, ''));
  assert.equal(box.value, SENTINEL, 'the sentinel is restored for the next key');
  input.macDelete();                                               // the keydown path sends without changing the box
  assert.equal(box.value, SENTINEL);
  assert.deepEqual(sent, [edit(1, ''), edit(1, '')]);
});
test('correcting pinyin inside a composition never deletes on the Mac', () => {
  const { box, sent, clock, input } = setup();
  box.value = SENTINEL + 'she'; input.observe();                   // compositionupdate keeps marked text
  input.snapshot(); box.value = SENTINEL + 'sh';                   // three delete keys shrink the pinyin
  assert.equal(input.consume('deleteContentBackward'), null);
  input.snapshot(); box.value = SENTINEL + 's';
  assert.equal(input.consume('deleteContentBackward'), null);
  input.snapshot(); box.value = SENTINEL;                          // the last one empties the buffer
  assert.equal(input.consume('deleteContentBackward'), null);
  assert.equal(box.value, SENTINEL);
  // iOS can end the composition and still deliver trailing deletes against an empty box.
  input.compositionEnded();
  input.snapshot(); box.value = '';
  assert.equal(input.consume('deleteContentBackward'), null);
  assert.equal(input.macDelete(), null, 'the keydown path stays quiet while the IME settles');
  clock.at += 100; input.snapshot(); box.value = '';
  assert.equal(input.consume('deleteContentBackward'), null);
  assert.deepEqual(sent, [], 'the IME corrected itself; the Mac saw nothing');
  // Once the IME has settled, the delete key reaches the Mac again.
  clock.at += 500; input.snapshot(); box.value = '';
  assert.deepEqual(input.consume('deleteContentBackward'), edit(1, ''));
  assert.deepEqual(sent, [edit(1, '')]);
});
test('dictation waits for a pause, then types the phrase once', () => {
  const { box, sent, input, timers } = setup();
  box.value = '你好'; input.dictate(box.value);
  box.value = '你好世界'; input.dictate(box.value);
  assert.deepEqual(sent, [], 'nothing leaves while the speaker keeps talking');
  assert.equal(input.pendingDictation, true);
  assert.equal(box.value, '你好世界', 'the words stay in the field');
  timers.fire();                                                   // the speaker paused
  assert.deepEqual(sent, [edit(0, '你好世界')]);
  assert.equal(input.pendingDictation, false);
  // Speaking on sends only the new phrase.
  box.value = '你好世界，今天'; input.dictate(box.value);
  timers.fire();
  assert.deepEqual(sent.at(-1), edit(0, '，今天'));
  // A late revision only rewrites words that were still on the phone.
  box.value = '你好世界，今田'; input.dictate(box.value);
  timers.fire();
  assert.deepEqual(sent.at(-1), edit(1, '田'));
  // Ending dictation must not send the same words twice.
  input.observe();
  assert.deepEqual(input.consume('insertFromComposition'), { type: 'echo', text: '你好世界，今田' });
  assert.equal(box.value, SENTINEL, 'the field clears once dictation ends');
  assert.deepEqual(sent.map(action => action.type), ['edit', 'edit', 'edit', 'echo']);
});
test('dictation detection keeps pinyin on the phone', () => {
  assert.equal(isDictationText('she'), false);
  assert.equal(isDictationText("xi'an"), false);
  assert.equal(isDictationText('hello world'), true);
  assert.equal(isDictationText('你好'), true);
  assert.equal(isDictationType('insertDictationResult'), true);
  assert.equal(isDictationType('insertFromDictation'), true);
  assert.equal(isDictationType('insertCompositionText'), false);
});
test('a committed candidate replaces the pinyin and reaches the Mac', () => {
  const { box, sent, input } = setup();
  box.value = SENTINEL + 'zhong'; input.observe();
  input.snapshot(); box.value = SENTINEL + '中';                   // shorter, but this is a commit
  assert.deepEqual(input.consume('insertFromComposition'), edit(0, '中'));
  assert.equal(box.value, SENTINEL);
  assert.deepEqual(sent, [edit(0, '中')]);
});

test('reads final IME text after compositionend and final input; preserves draft and focus-independent state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let draft = 'zhong'; const sent = [], notices = [];
  const input = new TextSubmission(() => draft, async text => { sent.push(text); return 'executed'; }, m => notices.push(m));
  input.compositionStart(); await input.submit(); await input.submit(); assert.equal(sent.length, 0);
  input.compositionEnd(); draft = '  中文 👩🏽‍💻\ne\u0301  \n';
  t.mock.timers.tick(0); await Promise.resolve();
  assert.deepEqual(sent, [draft]); assert.ok(notices.includes('粘贴指令已执行')); assert.equal(input.pending, false);
});
test('mode change or background cancels queued composition without ghost paste', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let sent = 0;
  const input = new TextSubmission(() => 'draft', async () => { sent++; return 'executed'; }, () => {});
  input.compositionStart(); await input.submit(); input.compositionEnd(); input.cancelQueued();
  t.mock.timers.tick(0); assert.equal(sent, 0); assert.equal(input.pending, false);
});
test('empty input is disabled, whitespace remains valid, repeated clicks do not duplicate', async () => {
  let draft = '', finish; const sent = [];
  const input = new TextSubmission(() => draft, text => { sent.push(text); return new Promise(resolve => { finish = resolve; }); }, () => {});
  await input.submit(); assert.equal(sent.length, 0);
  draft = ' \n '; const pending = input.submit(); await input.submit(); assert.equal(sent.length, 1);
  finish('uncertain'); await pending; assert.equal(draft, ' \n '); assert.equal(input.pending, false);
});
test('unexpected send failure retains draft and exposes uncertainty', async () => {
  const notices = [], draft = 'keep this';
  const input = new TextSubmission(() => draft, async () => { throw new Error('closed'); }, m => notices.push(m));
  await input.submit(); assert.ok(notices.includes('请查看电视确认是否已粘贴')); assert.equal(input.pending, false); assert.equal(draft, 'keep this');
});
