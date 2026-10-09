import test from 'node:test';
import assert from 'node:assert/strict';
import { BleCloudBridge } from '../ble/cloud.js';

const BASE_TIME = Date.parse('2026-10-09T12:34:56Z');
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const fail = (status, message = 'request failed', extra = {}) => Object.assign(new Error(message), { status, ...extra });
const reading = (index = 1, time = BASE_TIME) => ({ readingId: uuid(index), bpm: 82, signalQuality: 95, measuredAt: new Date(time).toISOString() });
function harness(handler = async call => call.path.endsWith('/ble/sessions') ? { session: { id: uuid(100) } } : { accepted: true, saved: 1, duplicates: 0 }) {
  const calls = [], states = [], expired = [], timers = new Map();
  let current = BASE_TIME, timerId = 0, connections = 200;
  const client = new BleCloudBridge({
    childId: 'child-original', now: () => current, makeConnectionId: () => uuid(connections++),
    api(path, options) { const call = { path, body: JSON.parse(options.body), method: options.method }; calls.push(call); return handler(call, calls); },
    onState: state => states.push(state), onAuthExpired: detail => expired.push(detail),
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: current + delay }); return id; },
    clearTimer(id) { timers.delete(id); }
  });
  return { client, calls, states, expired, timers,
    time() { return current; }, advance(milliseconds) { current += milliseconds; },
    async next() {
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      timers.delete(id); current = Math.max(current, timer.due); timer.callback(); await settle();
    }
  };
}

test('session opens once, batches use captured child and only acknowledged readings leave the queue', async () => {
  const h = harness();
  h.client.setConnected(true, { deviceId: 'opaque-browser-device', deviceName: 'NeuroBand' });
  h.client.add(reading());
  await h.client.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].body.deviceId, 'opaque-browser-device');
  assert.equal(h.calls[1].body.sessionId, uuid(100));
  assert.deepEqual(h.calls[1].body.readings, [reading()]);
  assert.equal(h.client.state.pending, 0);
  assert.equal(h.client.state.phase, 'online');
  assert.ok(h.client.state.lastSavedAt);
  h.client.childId = 'another-child';
  h.client.add(reading(2)); await h.client.flush();
  assert.ok(h.calls.every(call => call.path.startsWith('/api/children/child-original/')));
  await h.client.stop();
});

test('lost session-open response retries the same connectionId to prevent duplicate sessions', async () => {
  let opens = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) { if (++opens === 1) throw new Error('connection lost'); return { session: { id: uuid(100) } }; }
    return { accepted: true, saved: 1, duplicates: 0 };
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  assert.equal(h.client.state.phase, 'offline');
  assert.equal(h.client.state.pending, 1);
  await h.next();
  const calls = h.calls.filter(call => call.path.endsWith('/ble/sessions'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.connectionId, calls[1].body.connectionId);
  assert.equal(h.client.state.pending, 0);
  await h.client.stop();
});

test('lost reading acknowledgement retries unchanged readingId and accepts server duplicate confirmation', async () => {
  let writes = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) return { session: { id: uuid(100) } };
    if (call.path.endsWith('/vitals/ble') && ++writes === 1) throw new Error('response lost');
    return { accepted: true, saved: 0, duplicates: 1 };
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  assert.equal(h.client.state.pending, 1);
  await h.next();
  const writesCalls = h.calls.filter(call => call.path.endsWith('/vitals/ble'));
  assert.deepEqual(writesCalls[0].body.readings, writesCalls[1].body.readings);
  assert.equal(h.client.state.pending, 0);
  assert.equal(h.client.add(reading()), false);
  await h.client.stop();
});

test('an expired idempotent open gets a new connectionId instead of becoming permanently blocked', async () => {
  let opens = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) {
      if (++opens === 1) throw fail(410);
      return { session: { id: uuid(100) } };
    }
    return { accepted: true, saved: 1, duplicates: 0 };
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  await h.next();
  const openCalls = h.calls.filter(call => call.path.endsWith('/ble/sessions'));
  assert.equal(openCalls.length, 2);
  assert.notEqual(openCalls[0].body.connectionId, openCalls[1].body.connectionId);
  assert.equal(h.client.state.pending, 0);
  await h.client.stop();
});

test('queue is bounded at 120 and expired data is dropped instead of being retried forever', async () => {
  const h = harness();
  for (let i = 1; i <= 130; i++) h.client.add(reading(i));
  assert.equal(h.client.state.pending, 120);
  h.client.setConnected(true); await h.client.flush();
  const first = h.calls.find(call => call.path.endsWith('/vitals/ble'));
  assert.equal(first.body.readings.length, 20);
  assert.equal(first.body.readings[0].readingId, uuid(11));
  assert.equal(h.client.state.pending, 100);
  h.advance(300001); await h.client.flush();
  assert.equal(h.client.state.pending, 0);
  assert.equal(h.calls.filter(call => call.path.endsWith('/vitals/ble')).length, 1);
  assert.equal(h.client.add(reading(500)), false);
  assert.equal(h.client.add({ ...reading(501, h.time()), bpm: 300 }), false);
  await h.client.stop();
});

test('401 drops queued child data, cancels timers and requires authentication before restarting', async () => {
  const h = harness(async () => { throw fail(401); });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  assert.equal(h.client.state.phase, 'stopped');
  assert.equal(h.client.state.pending, 0);
  assert.equal(h.expired.length, 1);
  assert.equal(h.timers.size, 0);
  const requests = h.calls.length;
  h.client.setConnected(true); assert.equal(h.client.add(reading(2)), false); await h.client.flush();
  assert.equal(h.calls.length, requests);
});

test('stop during pending session creation closes the late session without resurrecting callbacks', async () => {
  const opening = deferred();
  const h = harness(async call => call.path.endsWith('/ble/sessions') ? opening.promise : {});
  h.client.setConnected(true); const flushing = h.client.flush(); await settle();
  const stopping = h.client.stop(); const count = h.states.length;
  assert.equal(h.client.state.phase, 'stopped');
  assert.equal(h.timers.size, 0);
  opening.resolve({ session: { id: uuid(100) } });
  await flushing; await stopping;
  assert.equal(h.states.length, count);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].path.endsWith('/' + uuid(100) + '/end'));
  await h.client.stop(); assert.equal(h.calls.length, 2);
});

test('only one upload is in flight and new samples survive acknowledgement of the prior batch', async () => {
  const uploading = deferred(); let writes = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) return { session: { id: uuid(100) } };
    if (call.path.endsWith('/vitals/ble') && ++writes === 1) return uploading.promise;
    return { accepted: true, saved: 1, duplicates: 0 };
  });
  h.client.setConnected(true); await h.client.flush();
  h.client.add(reading()); const first = h.client.flush(); await settle();
  h.client.add(reading(2)); const second = h.client.flush();
  assert.equal(writes, 1); assert.equal(first, second);
  uploading.resolve({ accepted: true, saved: 1, duplicates: 0 }); await first;
  assert.equal(h.client.state.pending, 1);
  await h.next();
  assert.equal(writes, 2); assert.equal(h.client.state.pending, 0);
  const batches = h.calls.filter(call => call.path.endsWith('/vitals/ble'));
  assert.equal(batches[1].body.readings[0].readingId, uuid(2));
  await h.client.stop();
});

for (const status of [409, 410]) test(`expired/ended session ${status} opens a new session and retries the same packet`, async () => {
  let opens = 0, writes = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) return { session: { id: uuid(100 + ++opens) } };
    if (call.path.endsWith('/vitals/ble') && ++writes === 1) throw fail(status);
    return { accepted: true, saved: 1, duplicates: 0 };
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  assert.equal(h.client.state.pending, 1);
  await h.next();
  assert.equal(opens, 2);
  const openCalls = h.calls.filter(call => call.path.endsWith('/ble/sessions'));
  assert.notEqual(openCalls[0].body.connectionId, openCalls[1].body.connectionId);
  const packets = h.calls.filter(call => call.path.endsWith('/vitals/ble'));
  assert.deepEqual(packets[0].body.readings, packets[1].body.readings);
  assert.notEqual(packets[0].body.sessionId, packets[1].body.sessionId);
  assert.equal(h.client.state.pending, 0);
  await h.client.stop();
});

test('radio disconnection stops heartbeat but does not discard already received buffered samples', async () => {
  const h = harness(); h.client.setConnected(true); await h.client.flush();
  assert.ok(h.timers.size > 0);
  h.client.add(reading()); h.client.setConnected(false); await h.client.flush();
  assert.equal(h.client.state.pending, 0);
  assert.equal(h.calls.filter(call => call.path.endsWith('/vitals/ble')).length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith('/heartbeat')).length, 0);
  assert.equal(h.timers.size, 0);
  h.client.setConnected(true); await h.client.flush();
  assert.equal(h.calls.filter(call => call.path.endsWith('/ble/sessions')).length, 1);
  await h.next();
  assert.equal(h.calls.filter(call => call.path.endsWith('/heartbeat')).length, 1);
  await h.client.stop();
});

test('429 respects retry-after even when another sample or an explicit flush arrives', async () => {
  let writes = 0;
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) return { session: { id: uuid(100) } };
    if (call.path.endsWith('/vitals/ble') && ++writes === 1) throw fail(429, 'slow down', { retryAfter: 12 });
    return { accepted: true, saved: 2, duplicates: 0 };
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  h.client.add(reading(2)); await h.client.flush();
  assert.equal(writes, 1);
  assert.equal(Math.min(...[...h.timers.values()].map(timer => timer.due)) - h.time(), 12000);
  await h.next(); assert.equal(writes, 2); assert.equal(h.client.state.pending, 0);
  await h.client.stop();
});

test('rejected 400 batch is discarded and malformed session-open requests do not loop', async () => {
  const h = harness(async call => {
    if (call.path.endsWith('/ble/sessions')) return { session: { id: uuid(100) } };
    if (call.path.endsWith('/vitals/ble')) throw fail(400);
    return {};
  });
  h.client.setConnected(true); h.client.add(reading()); await h.client.flush();
  assert.equal(h.client.state.pending, 0);
  h.client.setConnected(false); assert.equal(h.timers.size, 0);
  await h.client.stop();
  const blocked = harness(async () => { throw fail(400); });
  blocked.client.setConnected(true); blocked.client.add(reading()); await blocked.client.flush();
  blocked.client.add(reading(2)); await blocked.client.flush();
  assert.equal(blocked.calls.length, 1);
  assert.equal(blocked.timers.size, 0);
  await blocked.client.stop();
});
