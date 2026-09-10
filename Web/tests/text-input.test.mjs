import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSubmission } from '../dist/text-input.js';

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
