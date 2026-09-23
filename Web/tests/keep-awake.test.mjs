import test from 'node:test';
import assert from 'node:assert/strict';
import { KeepAwake } from '../dist/keep-awake.js';

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function lock() {
  return { released: false, listener() {}, addEventListener(_, run) { this.listener = run; },
    async release() { this.released = true; this.listener(); } };
}
function video() {
  return { paused: true, plays: 0, async play() { this.plays++; this.paused = false; }, pause() { this.paused = true; } };
}

test('native lease is deduplicated and released on background, reacquired on return', async () => {
  const leases = [], states = [];
  const awake = new KeepAwake(async () => { const value = lock(); leases.push(value); return value; },
    () => { throw Error('native must not use video'); }, state => states.push(state));
  awake.visibility(true); awake.resume(true); awake.resume(true); await settle();
  assert.equal(leases.length, 1); assert.equal(states.at(-1), 'native');
  awake.visibility(false); assert.equal(leases[0].released, true); assert.equal(states.at(-1), 'paused');
  awake.visibility(true); await settle(); assert.equal(leases.length, 2);
});

test('a late native grant cannot keep a hidden page awake', async () => {
  let resolve; const lease = lock(); const states = [];
  const awake = new KeepAwake(() => new Promise(done => { resolve = done; }), video, state => states.push(state));
  awake.visibility(true); awake.visibility(false); resolve(lease); await settle();
  assert.equal(lease.released, true); assert.equal(states.at(-1), 'paused');
});

test('returning before an old request resolves releases that lease and requests a fresh one', async () => {
  let resolve, count = 0; const old = lock(), fresh = lock();
  const awake = new KeepAwake(() => ++count === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve(fresh), video, () => {});
  awake.visibility(true); awake.visibility(false); awake.visibility(true); resolve(old); await settle();
  assert.equal(old.released, true); assert.equal(fresh.released, false); assert.equal(count, 2);
  awake.visibility(false); assert.equal(fresh.released, true);
});

test('system denial or revocation waits for interaction instead of spinning or bypassing it with video', async () => {
  let count = 0; const lease = lock(), states = [];
  const awake = new KeepAwake(async () => { if (++count === 1) throw Error('low power'); return lease; },
    () => { throw Error('must respect native denial'); }, state => states.push(state));
  awake.visibility(true); await settle(); assert.equal(count, 1); assert.equal(states.at(-1), 'blocked');
  awake.resume(true); await settle(); assert.equal(count, 2); assert.equal(states.at(-1), 'native');
  await lease.release(); await settle(); assert.equal(count, 2); assert.equal(states.at(-1), 'blocked');
});

test('HTTP fallback starts synchronously on the first gesture, pauses in background and resumes', async () => {
  const clip = video(), states = []; let made = 0;
  const awake = new KeepAwake(undefined, () => { made++; return clip; }, state => states.push(state));
  awake.visibility(true); assert.equal(made, 0); assert.equal(states.at(-1), 'waiting');
  awake.resume(true); assert.equal(clip.plays, 1, 'play occurs inside the gesture stack');
  awake.resume(true); await settle(); assert.equal(clip.plays, 1); assert.equal(states.at(-1), 'video');
  awake.visibility(false); assert.equal(clip.paused, true);
  awake.resume(true); assert.equal(clip.plays, 1, 'hidden touches cannot restart playback');
  awake.visibility(true); await settle(); assert.equal(clip.plays, 2); assert.equal(made, 1);
});

test('blocked media playback can retry on a later touch', async () => {
  const clip = video(), states = []; let first = true;
  clip.play = async () => { if (first) { first = false; throw Error('NotAllowedError'); } clip.paused = false; };
  const awake = new KeepAwake(undefined, () => clip, state => states.push(state));
  awake.visibility(true); awake.resume(true); await settle(); assert.equal(states.at(-1), 'blocked');
  awake.resume(true); await settle(); assert.equal(states.at(-1), 'video');
});

test('pending video playback is stopped even when it resolves after pagehide', async () => {
  let resolve; const clip = video(), states = [];
  clip.play = () => new Promise(done => { resolve = () => { clip.paused = false; done(); }; });
  const awake = new KeepAwake(undefined, () => clip, state => states.push(state));
  awake.visibility(true); awake.resume(true); awake.visibility(false); resolve(); await settle();
  assert.equal(clip.paused, true); assert.equal(states.at(-1), 'paused');
});

test('turning the switch off releases a pending lease and stays off after returning', async () => {
  const lease = lock(); let resolve, requests = 0;
  const states = [], awake = new KeepAwake(() => { requests++; return new Promise(done => { resolve = done; }); }, video, state => states.push(state));
  awake.visibility(true); awake.setEnabled(false); resolve(lease); await settle();
  assert.equal(lease.released, true); assert.equal(states.at(-1), 'disabled');
  awake.visibility(false); awake.visibility(true); awake.resume(true); await settle();
  assert.equal(requests, 1); assert.equal(states.at(-1), 'disabled');
});
test('video switch pauses immediately, can re-enable, and never starts while disabled', async () => {
  const clip = video(), awake = new KeepAwake(undefined, () => clip, () => {});
  awake.visibility(true); awake.resume(true); await settle();
  awake.setEnabled(false); assert.equal(clip.paused, true);
  awake.resume(true); assert.equal(clip.plays, 1);
  awake.setEnabled(true); await settle(); assert.equal(clip.plays, 2);
});
test('HTTP MP4 avoids WebKit loop exclusion, seeks before ending and preserves audio', async t => {
  const { createWakeVideo } = await import('../dist/keep-awake.js');
  const clip = Object.assign(new EventTarget(), { paused: false, seeking: false, currentTime: 0, loop: true, muted: false, setAttribute() {} });
  const original = globalThis.document, states = [];
  globalThis.document = { hidden: false, createElement: () => clip };
  t.after(() => { globalThis.document = original; });
  createWakeVideo(state => states.push(state));
  assert.equal(clip.loop, false); assert.equal(clip.muted, false);
  const media = Buffer.from(clip.src.split(',')[1], 'base64');
  assert.ok(media.includes(Buffer.from('soun')) && media.includes(Buffer.from('vide')));
  clip.currentTime = 0.8; clip.dispatchEvent(new Event('timeupdate'));
  assert.ok(clip.currentTime >= 0 && clip.currentTime < 0.5);
  clip.seeking = true; clip.currentTime = 0.8; clip.dispatchEvent(new Event('timeupdate')); assert.equal(clip.currentTime, 0.8);
  clip.dispatchEvent(new Event('ended')); assert.equal(states.at(-1), 'blocked');
  globalThis.document.hidden = true; states.length = 0; clip.dispatchEvent(new Event('pause')); assert.equal(states.length, 0);
});
