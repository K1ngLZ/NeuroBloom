import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function actualBlock(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Production function boundaries must exist');
  return source.slice(first, last);
}
// Execute production glue unchanged; dependencies represent browser/service boundaries.
const portalCode = actualBlock('function leavePortal(', 'function updateDiagnostics(') +
  actualBlock('function bandIsCurrent(', 'async function showPortal(');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const packet = { readingId: '00000000-0000-4000-8000-000000000001', bpm: 82, signalQuality: 95, measuredAt: '2026-10-09T12:34:56.000Z' };

function harness({ request, close = () => Promise.resolve() } = {}) {
  const radios = [], clouds = [], requests = [], notices = [], trace = [], intervals = new Map(), elements = new Map();
  let inGesture = false, intervalId = 0, currentTime = Date.parse(packet.measuredAt), signins = 0;
  for (const id of ['liveBandBpm', 'liveBandQuality', 'readingState', 'bandStatus', 'bandPill', 'overviewBandState',
    'bandConnectionHint', 'connectBand', 'bandConnect2', 'bandDisconnect2', 'bandPending', 'overviewPersist', 'portalRoot']) {
    elements.set('#' + id, { textContent: '', disabled: false, classList: { toggle() {} }, remove() {} });
  }
  class RadioStub {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.device = { id: 'opaque-device', name: 'NeuroBand' };
      this.state = { phase: 'disconnected', notifications: false };
      radios.push(this);
    }
    connect() {
      assert.equal(inGesture, true, 'The native chooser must start inside the click');
      trace.push('chooser');
      this.state = { phase: 'subscribing', notifications: false, deviceName: 'NeuroBand' };
      this.callbacks.onState(this.state);
      return Promise.resolve().then(() => {
        this.callbacks.onReading(packet);
        this.state = { phase: 'connected', notifications: true, deviceName: 'NeuroBand' };
        this.callbacks.onState(this.state);
        return this.state;
      });
    }
    disconnect() { trace.push('radio-disconnect'); this.state = { phase: 'disconnected', notifications: false }; this.callbacks.onState(this.state); }
  }
  class CloudStub {
    constructor(options) { this.options = options; this.readings = []; this.connections = []; this.stops = 0; clouds.push(this); }
    add(reading) { this.readings.push(reading); }
    setConnected(connected, device) { this.connections.push({ connected, device }); }
    stop() { trace.push('cloud-close'); this.stops++; return close(this); }
  }
  class ClockDate extends Date { static now() { return currentTime; } }
  const location = { pathname: '/responsavel' };
  const context = vm.createContext({
    RadioStub, CloudStub, AbortController, Date: ClockDate, location,
    window: { isSecureContext: true, scrollTo() {} }, navigator: { bluetooth: {} },
    document: { body: { classList: { remove() {} } } },
    $: selector => elements.get(selector) || null,
    updateDiagnostics() {}, closeVisualSettings() {}, closeModal() {},
    setPortalRoute(view) { location.pathname = view === 'guardian' ? '/responsavel' : '/'; },
    signinForm() { signins++; }, notify(message) { notices.push(message); },
    api(path, options = {}) {
      const call = { path, options }; requests.push(call); trace.push('api:' + path);
      return request ? request(call) : Promise.resolve({});
    },
    setInterval(callback, milliseconds) { const id = ++intervalId; intervals.set(id, { callback, milliseconds }); return id; },
    clearInterval(id) { intervals.delete(id); }
  });
  vm.runInContext(`
    let activeChildId='child-a',bandContext=null,guardianRefreshTimer=null,guardianRefreshController=null;
    let BandClientClass=RadioStub,CloudBridgeClass=CloudStub,portalRequest=1;
    let diagnostics={api:'online',bluetooth:'suportado',device:'desconectada',gatt:'aguardando',notifications:'aguardando',lastPacket:'—',lastPersist:'—'};
    ${portalCode}
    function testState(){return {activeChildId,bandContext,portalRequest,guardianRefreshController,diagnostics:{...diagnostics}};}
    function enterChild(id){activeChildId=id;portalRequest++;location.pathname='/responsavel';}
  `, context, { filename: 'app.js (BLE portal functions)' });
  return { context, radios, clouds, requests, notices, trace, intervals, elements,
    click() { inGesture = true; try { context.connectBand(); } finally { inGesture = false; } },
    state() { return context.testState(); },
    signins() { return signins; },
    advance(milliseconds) { currentTime += milliseconds; },
    refreshInterval() { return [...intervals.values()].find(interval => interval.milliseconds === 8 * 60 * 1000); }
  };
}

test('portal starts the chooser synchronously even while the prior cloud session is still closing', async () => {
  const closing = deferred(), h = harness({ close: () => closing.promise });
  h.click(); assert.equal(h.trace.at(-1), 'chooser'); await settle();
  const old = h.state().bandContext;
  h.click();
  assert.equal(old.disposed, true);
  assert.equal(h.radios.length, 2);
  assert.equal(h.trace.at(-1), 'chooser');
  assert.equal(h.clouds[0].stops, 1);
  assert.equal(h.requests.length, 0, 'Cleanup must not wait for a backend request before opening the chooser');
  closing.resolve(); await settle(); await h.context.disconnectBand();
});

test('first notification is assigned to the captured child and old callbacks cannot enter the next account', async () => {
  const h = harness(); h.click(); await settle();
  assert.equal(h.clouds[0].options.childId, 'child-a');
  assert.equal(h.clouds[0].readings.length, 1);
  assert.equal(h.elements.get('#liveBandBpm').textContent, 82);
  const old = h.radios[0], oldCloud = h.clouds[0];
  h.context.enterChild('child-b'); h.click(); await settle();
  assert.equal(h.clouds[1].options.childId, 'child-b');
  assert.equal(h.clouds[1].readings.length, 1);
  const notices = h.notices.length, oldConnections = oldCloud.connections.length;
  old.callbacks.onReading({ ...packet, bpm: 99 });
  old.callbacks.onState({ phase: 'connected', deviceName: 'Old pulseira' });
  old.callbacks.onError({ kind: 'packet' });
  oldCloud.options.onAuthExpired();
  assert.equal(oldCloud.readings.length, 1);
  assert.equal(oldCloud.connections.length, oldConnections);
  assert.equal(h.clouds[1].readings.length, 1);
  assert.equal(h.elements.get('#liveBandBpm').textContent, 82);
  assert.equal(h.notices.length, notices);
  assert.equal(h.state().activeChildId, 'child-b');
  assert.equal(h.signins(), 0);
  await h.context.disconnectBand();
});

test('leaving the portal ignores late packets and clears reading watchdogs', async () => {
  const h = harness(); h.click(); await settle();
  const radio = h.radios[0]; h.context.leavePortal();
  assert.equal(h.state().activeChildId, null);
  assert.equal(h.intervals.size, 0);
  const count = h.clouds[0].readings.length;
  radio.callbacks.onReading({ ...packet, bpm: 99 });
  assert.equal(h.clouds[0].readings.length, count);
  assert.equal(h.elements.get('#liveBandBpm').textContent, 82);
  assert.equal(h.clouds[0].stops, 1);
  await settle();
});

test('logout before the first asynchronous notification cannot attach that packet to the next child', async () => {
  const h = harness(); h.click();
  h.context.leavePortal(); h.context.enterChild('child-b'); h.click();
  await settle();
  assert.equal(h.clouds[0].options.childId, 'child-a');
  assert.equal(h.clouds[0].readings.length, 0);
  assert.equal(h.clouds[1].options.childId, 'child-b');
  assert.equal(h.clouds[1].readings.length, 1);
  assert.equal(h.state().activeChildId, 'child-b');
  assert.equal(h.notices.filter(message => message.startsWith('NeuroBand conectada.')).length, 1);
  await h.context.disconnectBand();
});

test('stale live readings stop displaying as current after fifteen seconds', async () => {
  const h = harness(); h.click(); await settle();
  h.advance(15001); h.context.expireBandReading(h.state().bandContext);
  assert.equal(h.elements.get('#liveBandBpm').textContent, '—');
  assert.equal(h.elements.get('#liveBandQuality').textContent, '—');
  assert.equal(h.elements.get('#readingState').textContent, 'AGUARDANDO');
  await h.context.disconnectBand();
});

test('guardian refresh starts immediately, repeats every eight minutes and never overlaps', async () => {
  const pending = deferred(), h = harness({ request: () => pending.promise });
  h.context.startGuardianRefresh('child-a');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/api/auth/refresh');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.equal(h.refreshInterval().milliseconds, 480000);
  h.refreshInterval().callback(); assert.equal(h.requests.length, 1);
  pending.resolve({}); await settle();
  h.refreshInterval().callback(); assert.equal(h.requests.length, 2);
  h.context.stopGuardianRefresh();
  assert.equal(h.intervals.size, 0);
});

test('portal exit cancels an in-flight refresh and a late 401 cannot prompt for login', async () => {
  const pending = deferred(), h = harness({ request: () => pending.promise });
  h.context.startGuardianRefresh('child-a');
  const signal = h.requests[0].options.signal;
  h.context.leavePortal();
  assert.equal(signal.aborted, true);
  assert.equal(h.intervals.size, 0);
  pending.reject(Object.assign(new Error('expired'), { status: 401 })); await settle();
  assert.equal(h.signins(), 0);
  assert.equal(h.notices.length, 0);
});

test('old account refresh failure cannot eject a new account even when the child id is the same', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const h = harness({ request: () => ++calls === 1 ? old.promise : fresh.promise });
  h.context.startGuardianRefresh('child-a');
  h.context.leavePortal(); h.context.enterChild('child-a'); h.context.startGuardianRefresh('child-a');
  const signal = h.requests[1].options.signal;
  old.reject(Object.assign(new Error('old account expired'), { status: 401 })); await settle();
  assert.equal(h.state().activeChildId, 'child-a');
  assert.equal(h.signins(), 0); assert.equal(signal.aborted, false);
  h.refreshInterval().callback(); assert.equal(h.requests.length, 2, 'An old finally must not clear the new controller');
  fresh.resolve({}); await settle();
  h.context.stopGuardianRefresh();
});

test('current 401 ends the portal refresh and requests authentication exactly once', async () => {
  const h = harness({ request: async () => { throw Object.assign(new Error('expired'), { status: 401 }); } });
  h.context.startGuardianRefresh('child-a'); await settle();
  assert.equal(h.state().activeChildId, null);
  assert.equal(h.signins(), 1);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.notices.length, 1);
});

test('guardian logout closes the BLE cloud session before invalidating the authentication cookie', async () => {
  const closing = deferred(), h = harness({ close: () => closing.promise });
  h.click(); await settle(); h.context.startGuardianRefresh('child-a'); await settle();
  const button = { disabled: false }, pending = h.context.logoutPortal(button, '/api/auth/logout', 'Saiu');
  assert.equal(button.disabled, true);
  assert.equal(h.radios[0].state.phase, 'disconnected');
  assert.equal(h.requests.some(call => call.path === '/api/auth/logout'), false);
  assert.equal(h.intervals.size, 0);
  closing.resolve(); await pending;
  assert.equal(h.requests.at(-1).path, '/api/auth/logout');
  assert.equal(button.disabled, false);
  assert.equal(h.state().activeChildId, null);
  assert.equal(h.notices.at(-1), 'Saiu');
});
