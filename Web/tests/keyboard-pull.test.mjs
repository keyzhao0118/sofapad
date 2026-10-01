import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardPull } from '../dist/keyboard-pull.js';

test('a tap remains a click, and small thumb jitter does not become a pull', () => {
  const pull = new KeyboardPull();
  pull.begin(100, 100, 0); pull.move(102, 104, 100);
  assert.deepEqual(pull.end(120), { dismiss: false, moved: false });
});
test('a deliberate downward pull dismisses and suppresses the following click', () => {
  const pull = new KeyboardPull();
  pull.begin(100, 100, 0);
  assert.ok(Math.abs(pull.move(105, 150, 400) - 27.5) < 0.001);
  assert.deepEqual(pull.end(500), { dismiss: true, moved: true });
});
test('short downward flick dismisses, while a paused short drag settles back', () => {
  const pull = new KeyboardPull();
  pull.begin(100, 100, 0); pull.move(100, 124, 32);
  assert.equal(pull.end(40).dismiss, true);
  pull.begin(100, 100, 0); pull.move(100, 124, 32);
  assert.deepEqual(pull.end(250), { dismiss: false, moved: true });
});
test('horizontal and upward intent cannot later turn into dismissal', () => {
  for (const [x, y] of [[125, 101], [100, 80]]) {
    const pull = new KeyboardPull(); pull.begin(100, 100, 0);
    assert.equal(pull.move(x, y, 100), 0);
    assert.equal(pull.move(100, 180, 200), 0);
    assert.deepEqual(pull.end(210), { dismiss: false, moved: true });
  }
});
test('cancellation cannot dismiss, and the next gesture starts clean', () => {
  const pull = new KeyboardPull(); pull.begin(100, 100, 0);
  pull.move(100, 200, 100); pull.cancel();
  assert.equal(pull.end(110).dismiss, false);
  pull.begin(100, 100, 200);
  assert.deepEqual(pull.end(220), { dismiss: false, moved: false });
});
test('pull feedback has a bounded travel distance', () => {
  const pull = new KeyboardPull(); pull.begin(0, 0, 0);
  assert.equal(pull.move(0, 800, 1000), 40);
});
