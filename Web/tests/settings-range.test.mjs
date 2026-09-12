import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSpeed, positionOf, speedRanges, valueAt } from '../dist/settings-range.js';

test('the saved handfeel sits exactly in the middle of its slider', () => {
  for (const [key, expected] of [['pointer', 1.5], ['scroll', 0.3]]) {
    const range = speedRanges[key];
    assert.equal(range.middle, expected);
    assert.equal(positionOf(range.middle, range), 50);
    assert.equal(valueAt(50, range), expected);
  }
});
test('both ends of the travel are reachable and extend the old 0.3-4.0 range', () => {
  for (const range of [speedRanges.pointer, speedRanges.scroll]) {
    assert.equal(valueAt(0, range), range.low);
    assert.equal(valueAt(100, range), range.high);
    assert.ok(range.low < 0.3, 'slower than the old minimum');
    assert.ok(range.high > 4, 'faster than the old maximum');
  }
});
test('the scale is monotonic and round-trips through the slider position', () => {
  for (const range of [speedRanges.pointer, speedRanges.scroll]) {
    let previous = 0;
    for (let position = 0; position <= 100; position++) {
      const value = valueAt(position, range);
      assert.ok(value > previous, 'value grows with the position');
      previous = value;
      assert.ok(Math.abs(positionOf(value, range) - position) < 1.5, 'round-trip stays on the same step');
    }
  }
});
test('out-of-range values clamp instead of escaping the slider', () => {
  for (const range of [speedRanges.pointer, speedRanges.scroll]) {
    assert.equal(positionOf(range.low / 10, range), 0);
    assert.equal(positionOf(range.high * 10, range), 100);
    assert.equal(valueAt(-20, range), range.low);
    assert.equal(valueAt(180, range), range.high);
  }
});
test('speed labels stay short and readable', () => {
  assert.equal(formatSpeed(1.5), '1.5');
  assert.equal(formatSpeed(0.3), '0.3');
  assert.equal(formatSpeed(0.05), '0.05');
  assert.equal(formatSpeed(5), '5.0');
});
