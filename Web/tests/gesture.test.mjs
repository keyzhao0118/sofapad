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
test('release after the tap window before the hold timer fires does nothing; two-finger right click stays available', () => {
  const { engine, events } = setup(); engine.down(1, 10, 10, 0); engine.up(1, 10, 10, 450);
  engine.down(1, 10, 10, 600); engine.down(2, 40, 10, 620); engine.up(1, 10, 10, 650); engine.move(2, 70, 20); engine.up(2, 70, 20, 700);
  assert.deepEqual(events, []);
  engine.down(1, 10, 10, 800); engine.down(2, 40, 10, 820); engine.up(1, 10, 10, 850); engine.up(2, 40, 10, 870);
  assert.deepEqual(events, [{ type: 'click', button: 'right', count: 1 }]);
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

test('stationary hold fires one right click at 500 ms and suppresses trailing motion and release', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, events } = setup(); engine.down(1, 100, 100, 0);
  t.mock.timers.tick(499); assert.deepEqual(events, []);
  engine.move(1, 103, 102); t.mock.timers.tick(1);
  assert.deepEqual(events, [{ type: 'click', button: 'right', count: 1 }]);
  t.mock.timers.tick(5000); engine.move(1, 150, 100); engine.up(1, 150, 100, 5500);
  assert.equal(events.length, 1);
  tap(engine, 6000); assert.deepEqual(events.at(-1), { type: 'click', button: 'left', count: 1 });
});
test('motion, additional contacts, cancellation and release disarm a pending right click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const interrupt of [e => e.move(1, 120, 100), e => e.down(2, 150, 100, 50), e => e.cancel(), e => e.reset(), e => e.cancelContact(1), e => e.up(1, 100, 100, 300)]) {
    const { engine, events } = setup(); engine.down(1, 100, 100, 0); interrupt(engine);
    t.mock.timers.tick(1000); assert.equal(events.some(e => e.type === 'click' && e.button === 'right'), false);
    engine.reset();
  }
});
test('tap then hold and move drags, preserving total displacement without an extra second click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, events } = setup(); tap(engine); engine.down(1, 100, 100, 180);
  t.mock.timers.tick(800); assert.equal(events.length, 1); // Second tap reserves drag, not long-press right-click.
  engine.move(1, 104, 100); assert.equal(events.length, 1);
  engine.move(1, 120, 110); engine.move(1, 140, 120); engine.up(1, 140, 120, 1100);
  assert.deepEqual(events.filter(e => e.type === 'click'), [{ type: 'click', button: 'left', count: 1 }]);
  const drag = events.filter(e => e.type === 'drag');
  assert.equal(drag[0].phase, 'begin'); assert.equal(drag.at(-1).phase, 'end');
  assert.equal(drag.reduce((sum, e) => sum + e.dx, 0), 40); assert.equal(drag.reduce((sum, e) => sum + e.dy, 0), 20);
  tap(engine, 1200); assert.equal(events.at(-1).count, 1); // Drag ends the earlier double-click chain.
});
test('second tap must join within time and position bounds before becoming a drag', () => {
  for (const [time, x] of [[700, 100], [180, 200]]) {
    const { engine, events } = setup(); tap(engine); engine.down(1, x, 100, time);
    engine.move(1, x + 30, 100); engine.up(1, x + 30, 100, time + 80);
    assert.ok(events.some(e => e.type === 'move')); assert.equal(events.some(e => e.type === 'drag'), false);
  }
});
test('additional finger during tap-drag cancels once and blocks the remaining contacts', () => {
  const { engine, events } = setup(); tap(engine); engine.down(1, 100, 100, 180); engine.move(1, 120, 100);
  engine.down(2, 200, 100, 240); engine.move(1, 180, 100); engine.move(2, 250, 100);
  engine.up(1, 180, 100, 300); engine.up(2, 250, 100, 320);
  assert.deepEqual(events.map(e => e.type === 'click' ? 'click' : e.phase), ['click', 'begin', 'cancel']);
});
test('tap-drag uses the same reset and capture-loss release paths as three-finger drag', () => {
  for (const cancel of [e => e.reset(), e => e.cancel(), e => e.cancelContact(1)]) {
    const { engine, events } = setup(); tap(engine); engine.down(1, 100, 100, 180); engine.move(1, 130, 100);
    cancel(engine); engine.up(1, 130, 100, 300);
    assert.deepEqual(events.map(e => e.type === 'click' ? 'click' : e.phase), ['click', 'begin', 'cancel']);
  }
});
test('holding and releasing a second tap without moving adds no click or drag; two rapid taps remain a double click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, events } = setup(); tap(engine); engine.down(1, 100, 100, 180); t.mock.timers.tick(800); engine.up(1, 100, 100, 980);
  assert.deepEqual(events, [{ type: 'click', button: 'left', count: 1 }]);
  tap(engine, 1200); tap(engine, 1380); assert.deepEqual(events.map(e => e.count), [1, 1, 2]);
});

test('edge scroll accumulates vertical slop, stays vertical across the panel and ends once', () => {
  const { engine, events } = setup(); engine.down(1, 12, 100, 0, 'scroll');
  engine.move(1, 80, 103); assert.deepEqual(events, []);
  engine.move(1, 120, 110); engine.move(1, 180, 130); engine.move(1, 190, 125); engine.up(1, 210, 120, 150);
  assert.equal(events[0].phase, 'begin'); assert.equal(events.at(-1).phase, 'end');
  assert.ok(events.every(e => e.type === 'scroll' && e.dx === 0));
  assert.equal(events.reduce((sum, e) => sum + e.dy, 0), 20);
  assert.equal(events.filter(e => e.phase === 'end').length, 1);
});
test('edge taps, holds and horizontal motion cannot click, drag or move the pointer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, events } = setup();
  for (const duration of [60, 180, 2000]) {
    engine.down(1, 380, 100, 0, 'scroll'); engine.move(1, 200, 100);
    t.mock.timers.tick(duration); engine.up(1, 200, 100, duration);
  }
  assert.deepEqual(events, []);
});
test('edge contact breaks the preceding double-tap chain', () => {
  const { engine, events } = setup(); tap(engine);
  engine.down(1, 100, 100, 100, 'scroll'); engine.up(1, 100, 100, 130); tap(engine, 180);
  assert.deepEqual(events.map(e => e.count), [1, 1]);
});
test('main panel contact stays pointer movement when it reaches an edge', () => {
  const { engine, events } = setup(); engine.down(1, 100, 100, 0);
  engine.move(1, 12, 160); engine.up(1, 12, 170, 100);
  assert.ok(events.every(e => e.type === 'move')); assert.equal(events.reduce((sum, e) => sum + e.dx, 0), -88);
});
test('a second contact cancels edge scroll and blocks both contacts until lifted', () => {
  for (const zone of ['pointer', 'scroll']) {
    const { engine, events } = setup(); engine.down(1, 12, 100, 0, 'scroll'); engine.move(1, 12, 140);
    engine.down(2, 380, 100, 50, zone); engine.move(1, 12, 180); engine.move(2, 380, 150);
    engine.up(1, 12, 180, 100); engine.up(2, 380, 150, 120);
    assert.deepEqual(events.map(e => e.phase), ['begin', 'cancel']);
    tap(engine, 700); assert.equal(events.at(-1).count, 1);
  }
});
test('edge joins cancel pending holds and active drags without generating right clicks', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, events } = setup(); engine.down(1, 100, 100, 0); engine.down(2, 12, 100, 30, 'scroll');
  t.mock.timers.tick(1000); engine.up(1, 100, 100, 1030); engine.up(2, 12, 100, 1050);
  assert.deepEqual(events, []); tap(engine, 1200); engine.down(1, 100, 100, 1380); engine.move(1, 150, 100);
  engine.down(2, 12, 100, 1400, 'scroll'); engine.up(1, 150, 100, 1500); engine.up(2, 12, 100, 1510);
  assert.deepEqual(events.map(e => e.type === 'click' ? e.button : e.phase), ['left', 'begin', 'cancel']);
});
test('edge capture loss or reset cancels exactly once', () => {
  for (const cancel of [e => e.cancelContact(1), e => e.reset(), e => e.cancel()]) {
    const { engine, events } = setup(); engine.down(1, 12, 100, 0, 'scroll'); engine.move(1, 12, 150);
    cancel(engine); engine.cancelContact(1); engine.up(1, 12, 150, 200);
    assert.deepEqual(events.map(e => e.phase), ['begin', 'cancel']);
  }
});
test('synchronous connection loss during emission never revives or repeatedly releases a gesture', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const start of [e => { e.down(1, 12, 100, 0, 'scroll'); e.move(1, 12, 150); }, e => { three(e); e.move(1, 40, 100); }, e => { e.down(1, 100, 100, 0); t.mock.timers.tick(500); }]) {
    const events = []; const engine = new GestureEngine(e => { events.push(e); engine.reset(); });
    start(engine); engine.move(1, 100, 200); engine.up(1, 100, 200, 1000); t.mock.timers.tick(1000);
    assert.ok(events.length <= 2); assert.ok(events.filter(e => e.phase === 'cancel').length <= 1);
  }
});
