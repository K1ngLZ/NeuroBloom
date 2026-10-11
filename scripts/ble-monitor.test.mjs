import test from 'node:test';
import assert from 'node:assert/strict';
import { BandRemoteMonitor } from '../ble/monitor.js';
import { BleCloudBridge } from '../ble/cloud.js';

const BASE_TIME = Date.parse('2026-10-11T12:00:00Z');
const iso = value => new Date(value).toISOString();
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const fail = status => Object.assign(new Error('request failed'), { status });
const session = (now = BASE_TIME, id = 'session-a') => ({ id, status: 'connected', lastSeen: iso(now), endedAt: null });
const reading = (now = BASE_TIME, id = 'session-a') => ({ bpm: 83, signal_quality: 95, measured_at: iso(now), received_at: iso(now), source: 'ble', ble_session_id: id });

function harness(handler, options = {}) {
  let current = BASE_TIME, timerId = 0;
  const calls = [], states = [], expired = [], timers = new Map();
  const client = new BandRemoteMonitor({
    childId: 'child-a', now: () => current,
    api(path, options) { const call = { path, ...options }; calls.push(call); return handler(call); },
    onState: value => states.push(value), onAuthExpired: value => expired.push(value),
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: current + delay }); return id; },
    clearTimer(id) { timers.delete(id); }, ...options
  });
  return { client, calls, states, expired, timers, time: () => current,
    advance(milliseconds) { current += milliseconds; },
    async next() {
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0] || [];
      assert.ok(timer, 'a scheduled timer exists');
      timers.delete(id); current = Math.max(current, timer.due); timer.callback(); await settle();
    }
  };
}

test('starts immediately, updates on the next 5-second poll and issues authenticated-profile GETs', async () => {
  let latest = null, connection = null;
  const h = harness(async call => call.path.endsWith('/ble/status') ? { session: connection } : { reading: latest });
  await h.client.start();
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.method === 'GET' && call.signal instanceof AbortSignal && call.path.startsWith('/api/children/child-a/')));
  assert.equal(h.client.state.connected, false);
  assert.equal(h.client.state.reading, null);
  assert.equal([...h.timers.values()][0].due - h.time(), 5000);
  connection = session(BASE_TIME + 5000); latest = reading(BASE_TIME + 5000);
  await h.next();
  assert.equal(h.calls.length, 4);
  assert.equal(h.client.state.connected, true);
  assert.equal(h.client.state.live, true);
  assert.equal(h.client.state.reading.bpm, 83);
  assert.equal(h.client.state.lastCheckedAt, iso(BASE_TIME + 5000));
  h.client.stop();
});

test('historical, mismatched, legacy and unreceived readings remain records rather than live data', async t => {
  for (const [name, patch] of [
    ['old measurement', { measured_at: iso(BASE_TIME - 15001) }],
    ['old receipt', { received_at: iso(BASE_TIME - 15001) }],
    ['different session', { ble_session_id: 'session-other' }],
    ['legacy source', { source: 'legacy' }],
    ['missing receipt', { received_at: undefined }]
  ]) await t.test(name, async () => {
    const expected = { ...reading(), ...patch };
    const h = harness(async call => call.path.endsWith('/ble/status') ? { session: session() } : { reading: expected });
    await h.client.start();
    assert.equal(h.client.state.connected, true);
    assert.equal(h.client.state.live, false);
    assert.deepEqual(h.client.state.reading, expected);
    h.client.stop();
  });
});

test('65-second heartbeat and 15-second measurement/receipt boundaries include a 30-second future tolerance', async t => {
  for (const [offset, connected, live] of [[-15000, true, true], [-15001, true, false], [-65000, true, false], [-65001, false, false], [30000, true, true], [30001, false, false]]) {
    await t.test(String(offset), async () => {
      const value = BASE_TIME + offset;
      const h = harness(async call => call.path.endsWith('/ble/status') ? { session: session(value) } : { reading: reading(value) });
      await h.client.start();
      assert.equal(h.client.state.connected, connected);
      assert.equal(h.client.state.live, live);
      h.client.stop();
    });
  }
});

test('expired heartbeat and ended session never report a connection even with a fresh saved reading', async t => {
  for (const value of [session(BASE_TIME - 65001), { ...session(), status: 'stale' }, { ...session(), status: 'ended' }, { ...session(), endedAt: iso(BASE_TIME) }, { ...session(), lastSeen: 'bad-date' }]) {
    await t.test(JSON.stringify(value), async () => {
      const h = harness(async call => call.path.endsWith('/ble/status') ? { session: value } : { reading: reading() });
      await h.client.start();
      assert.equal(h.client.state.connected, false);
      assert.equal(h.client.state.live, false);
      assert.ok(h.client.state.reading);
      h.client.stop();
    });
  }
});

test('invalid signal values are never displayed as readings', async t => {
  for (const patch of [{ bpm: 24 }, { bpm: 251 }, { bpm: '83' }, { bpm: 83.5 }, { signal_quality: -1 }, { signal_quality: 101 }, { signal_quality: 95.5 }, { measured_at: 'bad-date' }, { measured_at: iso(BASE_TIME + 30001) }]) {
    await t.test(JSON.stringify(patch), async () => {
      const h = harness(async call => call.path.endsWith('/ble/status') ? { session: session() } : { reading: { ...reading(), ...patch } });
      await h.client.start();
      assert.equal(h.client.state.reading, null);
      assert.equal(h.client.state.live, false);
      h.client.stop();
    });
  }
});

test('partial and total network failures keep a saved record but clear connected/live immediately', async () => {
  let broken = null;
  const h = harness(async call => {
    if (broken === 'both' || (broken === 'status' && call.path.endsWith('/ble/status')) || (broken === 'reading' && call.path.endsWith('/vitals/latest'))) throw new Error('offline');
    return call.path.endsWith('/ble/status') ? { session: session(h.time()) } : { reading: reading(h.time()) };
  });
  await h.client.start(); assert.equal(h.client.state.live, true);
  for (const failure of ['status', 'reading', 'both']) {
    broken = failure; await h.client.refresh();
    assert.equal(h.client.state.phase, 'offline');
    assert.equal(h.client.state.connected, false);
    assert.equal(h.client.state.live, false);
    assert.equal(h.client.state.reading.bpm, 83);
    assert.equal(h.client.state.session, null);
  }
  broken = null; await h.client.refresh();
  assert.equal(h.client.state.phase, 'online');
  assert.equal(h.client.state.live, true);
  h.client.stop();
});

test('normal aging retains the last historical record after both live data and heartbeat expire', async () => {
  const h = harness(async call => call.path.endsWith('/ble/status') ? { session: session() } : { reading: reading() });
  await h.client.start(); assert.equal(h.client.state.live, true);
  h.advance(16000); await h.client.refresh();
  assert.equal(h.client.state.live, false);
  assert.equal(h.client.state.connected, true);
  h.advance(50000); await h.client.refresh();
  assert.equal(h.client.state.connected, false);
  assert.equal(h.client.state.reading.bpm, 83);
  h.client.stop();
});

test('manual refresh and repeated start never overlap an outstanding polling batch', async () => {
  const status = deferred(), latest = deferred();
  const h = harness(call => call.path.endsWith('/ble/status') ? status.promise : latest.promise);
  const first = h.client.start(); await settle();
  assert.equal(h.client.refresh(), first);
  assert.equal(h.client.start(), first);
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 1, 'only the request deadline is scheduled while pending');
  status.resolve({ session: session() }); latest.resolve({ reading: reading() });
  await first;
  assert.equal(h.client.state.live, true);
  assert.equal(h.timers.size, 2, 'polling and freshness expiry are independent');
  h.client.stop();
});

test('live data expires at 15 seconds while a later poll remains pending', async () => {
  const status = deferred(), latest = deferred();
  let hold = false;
  const h = harness(call => hold ? (call.path.endsWith('/ble/status') ? status.promise : latest.promise)
    : Promise.resolve(call.path.endsWith('/ble/status') ? { session: session() } : { reading: reading() }));
  await h.client.start();
  hold = true; await h.next();
  assert.equal(h.time(), BASE_TIME + 5000);
  assert.equal(h.client.state.live, true);
  await h.next();
  assert.equal(h.time(), BASE_TIME + 15001);
  assert.equal(h.client.state.live, false);
  assert.equal(h.client.state.connected, true);
  assert.equal(h.states.at(-1).live, false, 'the UI receives the freshness change without another network response');
  assert.equal(h.client.state.reading.bpm, 83);
  assert.equal(h.calls.length, 4);
  h.client.stop();
  status.resolve({ session: session() }); latest.resolve({ reading: reading() }); await settle();
});

test('heartbeat expires at 65 seconds even when there is no new network reply', async () => {
  const status = deferred(), latest = deferred();
  let hold = false;
  const h = harness(call => hold ? (call.path.endsWith('/ble/status') ? status.promise : latest.promise)
    : Promise.resolve(call.path.endsWith('/ble/status') ? { session: session(BASE_TIME - 60000) } : { reading: reading(BASE_TIME - 60000) }));
  await h.client.start();
  assert.equal(h.client.state.connected, true);
  hold = true; await h.next(); await h.next();
  assert.equal(h.time(), BASE_TIME + 5001);
  assert.equal(h.client.state.connected, false);
  assert.equal(h.states.at(-1).connected, false);
  assert.equal(h.client.state.reading.bpm, 83);
  h.client.stop();
  status.resolve({ session: session() }); latest.resolve({ reading: reading() }); await settle();
});

test('timeout aborts transports and schedules a retry only when both aborted requests settle', async () => {
  const h = harness(call => new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const pending = h.client.start(); await settle();
  await h.next(); await pending;
  assert.ok(h.calls.every(call => call.signal.aborted));
  assert.equal(h.client.state.phase, 'offline');
  assert.equal(h.client.state.live, false);
  assert.equal([...h.timers.values()][0].due - h.time(), 5000);
  h.client.stop();
});

test('a transport ignoring abort cannot overlap requests or revive a timed-out connection', async () => {
  const status = deferred(), latest = deferred();
  const h = harness(call => call.path.endsWith('/ble/status') ? status.promise : latest.promise);
  const pending = h.client.start(); await settle();
  await h.next();
  assert.equal(h.client.state.phase, 'offline');
  assert.equal(h.timers.size, 0, 'no poll is scheduled until the transport settles');
  assert.equal(h.client.refresh(), pending);
  assert.equal(h.calls.length, 2);
  status.resolve({ session: session(h.time()) }); latest.resolve({ reading: reading(h.time()) });
  await pending;
  assert.equal(h.client.state.phase, 'offline');
  assert.equal(h.client.state.live, false);
  assert.equal(h.timers.size, 1);
  h.client.stop();
});

test('stop aborts pending requests, clears child data and ignores late replies permanently', async () => {
  const status = deferred(), latest = deferred();
  const h = harness(call => call.path.endsWith('/ble/status') ? status.promise : latest.promise);
  const pending = h.client.start(); await settle();
  h.client.stop();
  assert.ok(h.calls.every(call => call.signal.aborted));
  assert.equal(h.timers.size, 0);
  const events = h.states.length;
  status.resolve({ session: session() }); latest.resolve({ reading: reading() }); await pending;
  assert.equal(h.states.length, events);
  assert.equal(h.client.state.phase, 'stopped');
  assert.equal(h.client.state.session, null);
  assert.equal(h.client.state.reading, null);
  await h.client.start(); await h.client.refresh();
  assert.equal(h.calls.length, 2);
  h.client.stop(); assert.equal(h.states.length, events);
});

test('401 and 403 stop immediately, clear previously visible data and expire authentication only once', async t => {
  for (const status of [401, 403]) await t.test(String(status), async () => {
    let expire = false;
    const h = harness(async call => {
      if (expire) throw fail(status);
      return call.path.endsWith('/ble/status') ? { session: session() } : { reading: reading() };
    });
    await h.client.start(); assert.equal(h.client.state.live, true);
    expire = true; await h.client.refresh();
    assert.equal(h.expired.length, 1);
    assert.deepEqual(h.expired[0], { childId: 'child-a' });
    assert.equal(h.client.state.phase, 'stopped');
    assert.equal(h.client.state.reading, null);
    assert.equal(h.client.state.session, null);
    assert.equal(h.timers.size, 0);
    const calls = h.calls.length; await h.client.start(); await h.client.refresh();
    assert.equal(h.calls.length, calls);
    assert.equal(h.expired.length, 1);
  });
});

test('one authentication rejection expires immediately even while the other request is delayed', async () => {
  const latest = deferred();
  const h = harness(call => call.path.endsWith('/ble/status') ? Promise.reject(fail(401)) : latest.promise);
  const pending = h.client.start(); await settle();
  assert.equal(h.expired.length, 1);
  assert.equal(h.client.state.phase, 'stopped');
  assert.ok(h.calls.every(call => call.signal.aborted));
  latest.resolve({ reading: reading() }); await pending;
  assert.equal(h.client.state.reading, null);
  assert.equal(h.timers.size, 0);
});

test('profile paths stay captured and late data from a stopped monitor cannot appear in a different profile', async () => {
  const status = deferred(), latest = deferred();
  const old = harness(call => call.path.endsWith('/ble/status') ? status.promise : latest.promise, { childId: 'child/a with spaces' });
  const pending = old.client.start(); await settle();
  old.client.childId = 'child-b';
  assert.ok(old.calls.every(call => call.path.startsWith('/api/children/child%2Fa%20with%20spaces/')));
  old.client.stop();
  const fresh = harness(async () => ({ session: null, reading: null }), { childId: 'child-b' });
  await fresh.client.start();
  status.resolve({ session: session() }); latest.resolve({ reading: reading() }); await pending;
  assert.equal(old.client.state.reading, null);
  assert.equal(fresh.client.state.reading, null);
  assert.ok(fresh.calls.every(call => call.path.startsWith('/api/children/child-b/')));
  fresh.client.stop();
});

test('phone cloud writes reach two independent monitors through the same API without browser Bluetooth', async () => {
  const store = new Map([['child-a', { session: null, reading: null }], ['child-b', { session: null, reading: null }]]);
  const api = async (path, options) => {
    const match = path.match(/^\/api\/children\/([^/]+)(\/.*)$/), child = match && store.get(decodeURIComponent(match[1]));
    if (!child) throw fail(404);
    const suffix = match[2];
    if (options.method === 'GET') return suffix === '/ble/status' ? { session: child.session } : { reading: child.reading };
    const body = JSON.parse(options.body);
    if (suffix === '/ble/sessions') { child.session = session(); return { session: child.session }; }
    if (suffix === '/vitals/ble') {
      const value = body.readings.at(-1);
      child.reading = { bpm: value.bpm, signal_quality: value.signalQuality, measured_at: value.measuredAt, received_at: iso(BASE_TIME), source: 'ble', ble_session_id: body.sessionId };
      return { accepted: true };
    }
    if (suffix.endsWith('/end')) child.session = { ...child.session, status: 'ended', endedAt: iso(BASE_TIME) };
    return { ok: true };
  };
  const pc = harness(() => {}, { api }), second = harness(() => {}, { api }), otherChild = harness(() => {}, { api, childId: 'child-b' });
  await Promise.all([pc.client.start(), second.client.start(), otherChild.client.start()]);
  assert.equal(pc.client.state.reading, null);
  let timer = 0;
  const phone = new BleCloudBridge({ api, childId: 'child-a', now: () => BASE_TIME,
    makeConnectionId: () => '00000000-0000-4000-8000-000000000100', setTimer: () => ++timer, clearTimer: () => {} });
  phone.setConnected(true, { deviceId: 'fictitious-phone-device', deviceName: 'NeuroBand fixture' });
  phone.add({ readingId: '00000000-0000-4000-8000-000000000001', bpm: 89, signalQuality: 97, measuredAt: iso(BASE_TIME) });
  await phone.flush();
  await Promise.all([pc.client.refresh(), second.client.refresh(), otherChild.client.refresh()]);
  assert.equal(pc.client.state.live, true);
  assert.equal(pc.client.state.reading.bpm, 89);
  assert.equal(second.client.state.live, true);
  assert.equal(second.client.state.reading.bpm, 89);
  assert.equal(otherChild.client.state.reading, null);
  pc.client.stop();
  assert.equal(second.client.state.live, true, 'stopping a PC observer does not end the phone bridge');
  await phone.stop(); await second.client.refresh();
  assert.equal(second.client.state.connected, false);
  assert.equal(second.client.state.live, false);
  assert.equal(second.client.state.reading.bpm, 89);
  second.client.stop(); otherChild.client.stop();
});

test('snapshot mutations and rejected UI callbacks cannot alter stored readings or stop polling', async () => {
  const h = harness(async call => call.path.endsWith('/ble/status') ? { session: session() } : { reading: reading() }, { onState: () => Promise.reject(new Error('UI error')) });
  await h.client.start();
  const snapshot = h.client.state;
  snapshot.reading.bpm = 250; snapshot.session.status = 'ended'; snapshot.live = false;
  assert.equal(h.client.state.reading.bpm, 83);
  assert.equal(h.client.state.session.status, 'connected');
  await h.next();
  assert.equal(h.client.state.live, true);
  h.client.stop();
});
