import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionClient } from '../dist/connection.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [], updates = [];
  class Socket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; sent = []; onclose = null; onmessage = null;
    constructor() { sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    ready(id = 'session-1', capabilities = ['backspace']) { this.onopen(); this.onmessage({ data: JSON.stringify({ type: 'ready', v: 2, sessionID: id, pasteEpoch: '11111111-2222-3333-4444-555555555555', name: 'Mac', permitted: true, doubleClickInterval: 0.5, ...(capabilities ? { capabilities } : {}) }) }); }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ name: 'Mac', authenticated: true }) }));
  const originalSocket = globalThis.WebSocket, originalLocation = globalThis.location;
  globalThis.WebSocket = Socket; globalThis.location = { protocol: 'http:', host: '127.0.0.1:9876' };
  let cancellations = 0;
  const client = new ConnectionClient(update => updates.push(update), () => cancellations++);
  t.after(() => { client.disconnect(); globalThis.WebSocket = originalSocket; globalThis.location = originalLocation; });
  return { client, sockets, updates, cancelled: () => cancellations };
}
test('input is gated by ready and permission, revocation stops it immediately', async t => {
  const { client, sockets, updates } = setup(t);
  const move = { type: 'move', dx: 1, dy: 2 };
  client.send(move); await client.connect(); const socket = sockets[0];
  client.send(move); assert.equal(socket.sent.length, 0);
  socket.ready(); client.send(move); assert.equal(socket.sent.at(-1).seq, 1);
  socket.receive({ type: 'status', permitted: false }); client.send(move); assert.equal(socket.sent.length, 2);
  socket.receive({ type: 'disconnect', reason: 'revoked' }); assert.equal(updates.at(-1).state, 'unpaired');
  t.mock.timers.tick(30000); assert.equal(sockets.length, 1);
});
test('manual disconnect survives background and foreground transitions', async t => {
  const { client, sockets } = setup(t); await client.connect(); sockets[0].ready(); client.disconnect();
  client.visibility(true); client.visibility(false); t.mock.timers.tick(30000);
  assert.equal(sockets.length, 1); assert.equal(client.enabled, false);
});
test('backpressure cancels input without replay on a new session', async t => {
  const { client, sockets, cancelled } = setup(t); await client.connect(); sockets[0].ready();
  sockets[0].bufferedAmount = 9000; client.send({ type: 'move', dx: 300, dy: 20 });
  assert.equal(client.enabled, false); assert.equal(sockets[0].sent.length, 1); assert.ok(cancelled() > 1);
  await client.connect(); sockets[1].ready('session-2');
  client.send({ type: 'click', button: 'left', count: 1 });
  assert.deepEqual(sockets[1].sent.at(-1), { type: 'click', button: 'left', count: 1, v: 2, sessionID: 'session-2', seq: 1 });
});
test('large deltas preserve their sum and obey server bounds', async t => {
  const { client, sockets } = setup(t); await client.connect(); sockets[0].ready();
  client.send({ type: 'scroll', phase: 'begin', dx: 4000, dy: -2000 });
  const events = sockets[0].sent.slice(1);
  assert.deepEqual(events.map(e => e.phase), ['begin', 'update', 'update']);
  assert.equal(events.reduce((sum, e) => sum + e.dx, 0), 4000);
  assert.ok(events.every(e => Math.abs(e.dx) <= 2000));
});
test('busy response does not keep reconnecting or steal control', async t => {
  const { client, sockets, updates } = setup(t); await client.connect();
  sockets[0].receive({ type: 'disconnect', reason: 'busy' });
  t.mock.timers.tick(30000); assert.equal(sockets.length, 1); assert.equal(updates.at(-1).state, 'busy');
});

test('paste preserves exact text and matches acknowledgements; concurrent send is refused', async t => {
  const { client, sockets } = setup(t); await client.connect(); const socket = sockets[0]; socket.ready();
  const text = '  中文 👨‍👩‍👧‍👦 e\u0301\nsecond line\n';
  const pending = client.paste(text), message = socket.sent.at(-1);
  assert.equal(message.text, text); assert.equal(message.type, 'paste'); assert.match(message.requestID, /^11111111-2222-3333-4444-555555555555:[0-9a-f]{32}$/);
  assert.equal(await client.paste('again'), 'busy');
  socket.receive({ type: 'pasteResult', requestID: 'wrong', status: 'executed' });
  assert.equal(await client.paste('again'), 'busy');
  socket.receive({ type: 'pasteResult', requestID: message.requestID, status: 'executed' });
  assert.equal(await pending, 'executed');
});
test('disconnect or missing acknowledgement is uncertain and reconnect never replays text', async t => {
  const { client, sockets } = setup(t); await client.connect(); sockets[0].ready();
  const sent = client.paste('once'); sockets[0].onclose(); assert.equal(await sent, 'uncertain');
  await client.connect(); sockets[1].ready('session-2'); assert.equal(sockets[1].sent.some(m => m.type === 'paste'), false);
  const timeout = client.paste('new user action'); t.mock.timers.tick(6000); assert.equal(await timeout, 'uncertain');
});
test('unsent and oversized text is reported without truncation or queued send', async t => {
  const { client, sockets } = setup(t); assert.equal(await client.paste('offline'), 'not_sent');
  await client.connect(); sockets[0].ready();
  for (const text of ['中'.repeat(4001), '\u0001'.repeat(3000)]) assert.equal(await client.paste(text), 'too_large');
  assert.equal(sockets[0].sent.length, 1);
  sockets[0].bufferedAmount = 9000; assert.equal(await client.paste('blocked'), 'not_sent');
});
test('host sleep reconnects automatically, while an explicit host disconnect does not', async t => {
  const { client, sockets, updates } = setup(t); await client.connect(); sockets[0].ready();
  sockets[0].receive({ type: 'disconnect', reason: 'host_paused' }); assert.equal(updates.at(-1).state, 'offline');
  client.visibility(true); client.visibility(false); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(sockets.length, 2); sockets[1].ready('session-2');
  sockets[1].receive({ type: 'disconnect', reason: 'host_disconnect' });
  client.visibility(true); client.visibility(false); t.mock.timers.tick(30000); assert.equal(sockets.length, 2);
});
test('backspace requires readiness, host capability and permission, and sends once without replay', async t => {
  const { client, sockets } = setup(t); assert.equal(client.backspace(), false);
  await client.connect(); sockets[0].ready('old-host', null);
  assert.equal(client.canBackspace, false); assert.equal(client.backspace(), false);
  await client.connect(); sockets[1].ready(); assert.equal(client.canBackspace, true);
  assert.equal(client.backspace(), true);
  assert.deepEqual(sockets[1].sent.at(-1), { type: 'backspace', v: 2, sessionID: 'session-1', seq: 1 });
  sockets[1].receive({ type: 'status', permitted: false }); assert.equal(client.backspace(), false);
  assert.equal(sockets[1].sent.filter(m => m.type === 'backspace').length, 1);
  sockets[1].onclose(); await client.connect(); sockets[2].ready('session-2');
  assert.equal(sockets[2].sent.some(m => m.type === 'backspace'), false);
});
test('backspace is not queued behind paste or a congested connection', async t => {
  const { client, sockets } = setup(t); await client.connect(); const socket = sockets[0]; socket.ready();
  const paste = client.paste('draft'), id = socket.sent.at(-1).requestID;
  assert.equal(client.backspace(), false);
  socket.receive({ type: 'pasteResult', requestID: id, status: 'executed' }); await paste;
  assert.equal(client.canBackspace, true); socket.bufferedAmount = 9000;
  assert.equal(client.backspace(), false); assert.equal(socket.sent.some(m => m.type === 'backspace'), false);
  await client.connect(); sockets[1].ready('session-2'); assert.equal(sockets[1].sent.length, 1);
});
