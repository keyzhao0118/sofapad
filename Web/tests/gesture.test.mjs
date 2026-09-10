import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureEngine } from '../dist/gesture.js';

function setup() { const events = []; const engine = new GestureEngine(e => events.push(e)); return { engine, events }; }
function tap(e, time = 0, id = 1) { e.down(id, 100, 100, time); e.up(id, 102, 100, time + 60); }
test('double tap is two clicks with counts 1,2, never a third click', () => {
  const { engine, events } = setup(); tap(engine); tap(engine, 180);
  assert.deepEqual(events.map(e => e.count), [1, 2]);
});
test('double click uses the interval supplied by the Mac', () => {
  const { engine, events } = setup(); engine.doubleClickMs = 200; tap(engine); tap(engine, 250);
  assert.deepEqual(events.map(e => e.count), [1, 1]);
});
test('movement accumulates slop and never emits a click on release', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.move(1, 14, 10); engine.move(1, 22, 12); engine.move(1, 30, 15); engine.up(1, 30, 15, 100);
  assert.equal(events.some(e => e.type === 'click'), false);
  assert.equal(events.reduce((sum, e) => sum + e.dx, 0), 20);
  assert.equal(events.reduce((sum, e) => sum + e.dy, 0), 5);
});
test('two finger tap fires one right click after both contacts lift', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 40, 10, 30); engine.up(1, 11, 10, 80);
  assert.equal(events.length, 0); engine.up(2, 40, 10, 100);
  assert.deepEqual(events, [{ type: 'click', button: 'right', count: 1 }]);
});
test('late second finger can scroll but cannot right click', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 40, 10, 180); engine.up(1, 10, 10, 200); engine.up(2, 40, 10, 220);
  assert.deepEqual(events, []);
});
test('diagonal scroll closes once; remaining finger is ignored', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 40, 10, 30);
  engine.move(1, 30, 30); engine.move(2, 60, 30); engine.up(1, 30, 30, 100);
  engine.move(2, 100, 80); engine.up(2, 100, 80, 150);
  assert.equal(events[0].phase, 'begin'); assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.filter(e => e.phase === 'end').length, 1); assert.ok(events.every(e => e.type === 'scroll'));
  assert.equal(events.reduce((s, e) => s + e.dx, 0), 20); assert.equal(events.reduce((s, e) => s + e.dy, 0), 20);
});
test('third contact cancels scroll and suppresses all trailing contacts', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 40, 10, 20); engine.move(1, 30, 30); engine.down(3, 80, 10, 80);
  engine.up(3, 80, 10, 100); engine.up(1, 30, 30, 120); engine.up(2, 40, 10, 130);
  assert.deepEqual(events.map(e => e.phase), ['begin', 'cancel']);
});
test('cancellation resets double tap, reset accepts a fresh contact', () => {
  const { engine, events } = setup(); tap(engine); engine.down(1, 100, 100, 100); engine.cancel(); engine.up(1, 100, 100, 150); engine.reset(); tap(engine, 200);
  assert.deepEqual(events.map(e => e.count), [1, 1]);
});
test('a long press and a moving final contact cannot become a right tap', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.up(1, 10, 10, 500);
  engine.down(1, 10, 10, 600); engine.down(2, 40, 10, 620); engine.up(1, 10, 10, 650); engine.move(2, 70, 20); engine.up(2, 70, 20, 700);
  assert.deepEqual(events, []);
});
test('pinching without center motion cannot become a right click', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 50, 10, 20);
  engine.move(1, 5, 10); engine.move(2, 55, 10); engine.move(1, 0, 10); engine.move(2, 60, 10);
  engine.up(1, 0, 10, 120); engine.up(2, 60, 10, 130); assert.ok(events.every(e => e.type !== 'click'));
});
test('pointercancel blocks a remaining finger; normal capture loss preserves double tap', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.down(2, 40, 10, 20);
  engine.cancelContact(1); engine.move(2, 90, 80); engine.up(2, 90, 80, 130);
  assert.equal(events.length, 0); tap(engine, 200); engine.cancelContact(1); tap(engine, 380);
  assert.deepEqual(events.map(e => e.count), [1, 2]);
});

function three(engine) {
  engine.down(1, 10, 100, 0); engine.down(2, 40, 100, 45); engine.down(3, 70, 100, 130);
}
test('staggered three fingers start one drag; first lift ends it and trailing contacts are ignored', () => {
  const { engine, events } = setup(); three(engine);
  engine.move(1, 13, 100); assert.equal(events.length, 0);
  engine.move(1, 40, 100); engine.move(2, 70, 100); engine.move(3, 100, 100);
  engine.up(2, 70, 100, 300); const ended = events.length;
  engine.move(1, 80, 100); engine.up(1, 80, 100, 350); engine.up(3, 100, 100, 370);
  assert.equal(events.length, ended); assert.equal(events[0].phase, 'begin'); assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.filter(e => e.phase === 'begin').length, 1); assert.ok(events.every(e => e.type === 'drag'));
  assert.equal(events.reduce((sum, e) => sum + e.dx, 0), 30);
  tap(engine, 500); assert.equal(events.at(-1).type, 'click');
});
test('three-finger tap and a late third finger emit no click or drag', () => {
  const { engine, events } = setup(); three(engine);
  engine.up(1, 10, 100, 150); engine.up(2, 40, 100, 160); engine.up(3, 70, 100, 170);
  engine.down(1, 10, 100, 300); engine.down(2, 40, 100, 340); engine.down(3, 70, 100, 550);
  engine.move(1, 100, 100); engine.up(1, 100, 100, 580); engine.up(2, 40, 100, 590); engine.up(3, 70, 100, 600);
  assert.deepEqual(events, []);
});
test('fourth contact, cancellation, reset and capture loss release drag exactly once', () => {
  for (const cancel of [e => e.down(4, 110, 100, 160), e => e.cancel(), e => e.reset(), e => e.cancelContact(2)]) {
    const { engine, events } = setup(); three(engine); engine.move(1, 40, 100); cancel(engine);
    engine.up(1, 40, 100, 180); engine.up(2, 40, 100, 190); engine.up(3, 70, 100, 200); engine.up(4, 110, 100, 210);
    assert.deepEqual(events.map(e => e.phase), ['begin', 'cancel']);
  }
});
