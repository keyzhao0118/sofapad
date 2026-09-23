import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardTransition } from '../dist/keyboard-transition.js';
function setup() {
  let time = 0, id = 0; const frames = new Map(), values = [];
  const motion = new KeyboardTransition(p => values.push(p), run => { frames.set(++id, run); return id; }, key => frames.delete(key), () => time);
  return { motion, values, frames, step(ms) { time += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(run => run(time)); } };
}
test('panel and glyph progress monotonically and settle at exact endpoints', () => {
  const { motion, values, frames, step } = setup();
  motion.show(true); step(70); step(70); step(140);
  assert.ok(values[0] > 0 && values[0] < values[1]); assert.equal(values.at(-1), 1); assert.equal(frames.size, 0);
  motion.show(false); step(70); assert.ok(values.at(-1) < 1 && values.at(-1) > 0); step(210);
  assert.equal(values.at(-1), 0); assert.equal(frames.size, 0);
});
test('rapid reversal continues from the current position, cancels stale completion', () => {
  const { motion, values, frames, step } = setup();
  motion.show(true); step(50); const partial = values.at(-1);
  motion.show(false); step(0); assert.equal(values.at(-1), partial); step(30); assert.ok(values.at(-1) < partial);
  const closing = values.at(-1); motion.show(true); step(0); assert.equal(values.at(-1), closing);
  step(280); assert.equal(values.at(-1), 1); assert.equal(frames.size, 0);
});
test('reduced motion interrupts an in-flight animation and applies final state synchronously', () => {
  const { motion, values, frames, step } = setup();
  motion.show(true); step(60); motion.show(false, true);
  assert.equal(values.at(-1), 0); assert.equal(frames.size, 0); step(1000); assert.equal(values.at(-1), 0);
  motion.show(true, true); assert.equal(values.at(-1), 1);
});
