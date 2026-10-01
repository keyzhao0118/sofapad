import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardViewport } from '../dist/keyboard-viewport.js';
const size = (height, width = 393, scale = 1) => ({ height, width, scale });

test('native dismissal is detected after a keyboard-sized shrink and recovery', () => {
  const viewport = new KeyboardViewport(); viewport.open(size(800));
  assert.equal(viewport.update(size(480)), false); assert.equal(viewport.visible, true);
  assert.equal(viewport.update(size(520)), false); // candidate bar changes
  assert.equal(viewport.update(size(770)), true); assert.equal(viewport.visible, false);
  assert.equal(viewport.update(size(800)), false); // only once
});
test('browser toolbar resize and an attached hardware keyboard do not dismiss input', () => {
  const viewport = new KeyboardViewport(); viewport.open(size(800));
  for (const height of [760, 800, 720, 790]) assert.equal(viewport.update(size(height)), false);
  assert.equal(viewport.visible, false);
});
test('rotation or pinch zoom is not treated as a native keyboard dismissal', () => {
  for (const changed of [size(393, 852), size(790, 390, 1.1)]) {
    const viewport = new KeyboardViewport(); viewport.open(size(800)); viewport.update(size(480));
    assert.equal(viewport.update(changed), false); assert.equal(viewport.visible, false);
  }
});
test('explicit closing and reopening discards a previous keyboard observation', () => {
  const viewport = new KeyboardViewport(); viewport.open(size(800)); viewport.update(size(480));
  viewport.close(); assert.equal(viewport.update(size(800)), false);
  viewport.open(size(800)); assert.equal(viewport.update(size(800)), false);
});
