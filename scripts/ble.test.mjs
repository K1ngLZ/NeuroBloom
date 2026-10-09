import test from 'node:test';
import assert from 'node:assert/strict';
import { BLE_SERVICE_UUID, BLE_DATA_UUID, decodeBandPacket, NeuroBandClient } from '../ble/neuroband.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function packet(bpm = 82, quality = 95, length = 3) {
  const value = new DataView(new ArrayBuffer(length));
  if (length >= 2) value.setUint16(0, bpm, true);
  if (length >= 3) value.setUint8(2, quality);
  return value;
}
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, target = this) { for (const callback of [...(this.listeners.get(type) || [])]) callback({ target }); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
function harness({ selection, start, connect, retryDelays, onReading, onError } = {}) {
  const states = [], readings = [], errors = [], timers = new Map(), requested = [];
  let timerId = 0, ids = 0;
  const characteristic = new Events();
  characteristic.startNotifications = async () => { if (start) await start(characteristic); return characteristic; };
  characteristic.notify = (value, target = characteristic) => { characteristic.value = value; characteristic.emit('characteristicvaluechanged', target); };
  const device = new Events();
  device.name = 'NeuroBand QA';
  const gatt = {
    connected: false, connections: 0, disconnects: 0, services: 0,
    async connect() { this.connections++; if (connect) await connect(this); this.connected = true; return this; },
    disconnect() { this.disconnects++; this.connected = false; device.emit('gattserverdisconnected'); },
    async getPrimaryService(uuid) {
      assert.equal(uuid, BLE_SERVICE_UUID); this.services++;
      return { async getCharacteristic(dataUuid) { assert.equal(dataUuid, BLE_DATA_UUID); return characteristic; } };
    }
  };
  device.gatt = gatt;
  const bluetooth = { requestDevice(options) { requested.push(options); return selection || Promise.resolve(device); } };
  const client = new NeuroBandClient({
    bluetooth, retryDelays,
    now: () => new Date('2026-10-09T12:34:56.000Z'),
    makeReadingId: () => `reading-${++ids}`,
    onState: state => states.push(state),
    onReading: reading => { readings.push(reading); return onReading?.(reading); },
    onError: error => { errors.push(error); return onError?.(error); },
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); }
  });
  return { client, device, gatt, characteristic, states, readings, errors, timers, requested,
    drop() { gatt.connected = false; device.emit('gattserverdisconnected'); },
    async retry() { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); await flush(); return timer.delay; }
  };
}

test('BLE packet validates exact v1 length, byte order, signal quality and boundaries', () => {
  assert.deepEqual(decodeBandPacket(packet(25, 0)), { bpm: 25, signalQuality: 0 });
  assert.deepEqual(decodeBandPacket(packet(250, 100)), { bpm: 250, signalQuality: 100 });
  for (const value of [null, {}, packet(24), packet(251), packet(82, 101), packet(82, 90, 2), packet(82, 90, 4)]) {
    assert.equal(decodeBandPacket(value), null);
  }
  const buffer = new Uint8Array([255, 82, 0, 96, 255]);
  assert.deepEqual(decodeBandPacket(buffer.subarray(1, 4)), { bpm: 82, signalQuality: 96 });
  const detached = packet(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.equal(decodeBandPacket(detached), null);
});

test('device picker opens in the same gesture and grants only the NeuroBand service', async () => {
  const h = harness(), pending = h.client.connect();
  assert.equal(h.requested.length, 1);
  assert.deepEqual(h.requested[0].optionalServices, [BLE_SERVICE_UUID]);
  assert.equal(h.states[0].phase, 'selecting');
  await pending;
  assert.equal(h.client.state.phase, 'connected');
  assert.equal(h.client.state.notifications, true);
  const copy = h.client.state; copy.phase = 'error'; assert.equal(h.client.state.phase, 'connected');
  h.client.disconnect();
});

test('notification listener is ready for the first packet during subscription', async () => {
  const h = harness({ start: characteristic => {
    assert.equal(characteristic.count('characteristicvaluechanged'), 1);
    characteristic.notify(packet());
  } });
  await h.client.connect();
  assert.deepEqual(h.readings, [{ bpm: 82, signalQuality: 95, measuredAt: '2026-10-09T12:34:56.000Z', readingId: 'reading-1' }]);
  h.characteristic.notify(packet(90, 80));
  assert.equal(h.readings[1].readingId, 'reading-2');
  h.client.disconnect();
});

test('unrecognized characteristic and malformed packets never produce a reading', async () => {
  const h = harness(); await h.client.connect();
  h.characteristic.notify(packet(), {});
  h.characteristic.notify(packet(300));
  h.characteristic.notify(packet(82, 95, 4));
  assert.equal(h.readings.length, 0);
  assert.equal(h.errors.length, 2);
  assert.ok(h.errors.every(event => event.kind === 'packet'));
  h.client.disconnect();
});

test('failed notification setup releases listeners and the GATT connection', async () => {
  const h = harness({ start: () => { throw new Error('not supported'); } });
  await assert.rejects(h.client.connect(), /not supported/);
  assert.equal(h.client.state.phase, 'error');
  assert.equal(h.gatt.connected, false);
  assert.equal(h.characteristic.count('characteristicvaluechanged'), 0);
  assert.equal(h.device.count('gattserverdisconnected'), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.errors.filter(event => event.kind === 'transport').length, 1);
});

test('logout cancels a pending picker without connecting a late selected device', async () => {
  const selection = deferred(), h = harness({ selection: selection.promise });
  const pending = h.client.connect(); h.client.disconnect();
  selection.resolve(h.device);
  assert.equal(await pending, null);
  assert.equal(h.gatt.connections, 0);
  assert.equal(h.client.state.phase, 'disconnected');
  assert.equal(h.client.device, null);
});

test('logout while GATT connects closes late transport and blocks discovery and stale samples', async () => {
  const connecting = deferred(), h = harness({ connect: () => connecting.promise });
  const pending = h.client.connect(); await flush();
  assert.equal(h.gatt.connections, 1);
  h.client.disconnect(); connecting.resolve();
  assert.equal(await pending, null);
  assert.equal(h.gatt.connected, false);
  assert.equal(h.gatt.services, 0);
  assert.equal(h.client.state.phase, 'disconnected');
  assert.equal(h.device.count('gattserverdisconnected'), 0);
  assert.equal(h.timers.size, 0);
});

test('GATT operations remain serialized when a second selection replaces an in-flight connect', async () => {
  const first = deferred(); let calls = 0;
  const h = harness({ connect: () => ++calls === 1 ? first.promise : undefined });
  const old = h.client.connect(); await flush();
  const next = h.client.connect(); await flush();
  assert.equal(h.requested.length, 2);
  assert.equal(h.gatt.connections, 1);
  first.resolve();
  assert.equal(await old, null);
  await next;
  assert.equal(h.gatt.connections, 2);
  assert.equal(h.client.state.phase, 'connected');
  assert.equal(h.gatt.services, 1);
  assert.equal(h.device.count('gattserverdisconnected'), 1);
  h.client.disconnect();
});

test('separate controllers share the device mutex so late cleanup cannot disconnect the replacement', async () => {
  const first = deferred(); let calls = 0;
  const h = harness({ connect: () => ++calls === 1 ? first.promise : undefined });
  const old = h.client.connect(); await flush();
  h.client.disconnect();
  const next = new NeuroBandClient({ bluetooth: { requestDevice: () => Promise.resolve(h.device) } });
  const replacing = next.connect(); await flush();
  assert.equal(h.gatt.connections, 1);
  first.resolve();
  assert.equal(await old, null); await replacing;
  assert.equal(h.gatt.connections, 2);
  assert.equal(h.gatt.connected, true);
  assert.equal(next.state.phase, 'connected');
  assert.equal(h.device.count('gattserverdisconnected'), 1);
  next.disconnect();
});

test('disconnect retries use backoff and stop after the configured failure limit', async () => {
  let calls = 0;
  const h = harness({ retryDelays: [10, 30], connect: () => { if (++calls > 1) throw new Error('out of range'); } });
  await h.client.connect(); h.drop();
  assert.equal(h.client.state.phase, 'reconnecting');
  assert.equal(await h.retry(), 10);
  assert.equal(h.client.state.reconnectAttempts, 1);
  assert.equal(await h.retry(), 30);
  assert.equal(h.client.state.reconnectAttempts, 2);
  assert.equal(h.client.state.phase, 'error');
  assert.equal(h.gatt.connections, 3);
  assert.equal(h.timers.size, 0);
  assert.equal(h.gatt.connected, false);
  assert.equal(h.device.count('gattserverdisconnected'), 0);
});

test('automatic reconnect reuses permission and old notification handlers stay inert', async () => {
  const h = harness(); await h.client.connect();
  const staleHandler = [...h.characteristic.listeners.get('characteristicvaluechanged')][0];
  h.drop(); await h.retry();
  assert.equal(h.client.state.phase, 'connected');
  assert.equal(h.requested.length, 1);
  assert.equal(h.characteristic.count('characteristicvaluechanged'), 1);
  h.characteristic.value = packet(); staleHandler({ target: h.characteristic });
  assert.equal(h.readings.length, 0);
  h.characteristic.notify(packet()); assert.equal(h.readings.length, 1);
  h.client.disconnect(); staleHandler({ target: h.characteristic });
  assert.equal(h.readings.length, 1);
});

test('manual disconnect cancels scheduled reconnection and prevents later reading delivery', async () => {
  const h = harness(); await h.client.connect(); h.drop();
  const delayed = [...h.timers.values()][0].callback;
  h.client.disconnect(); delayed(); await flush();
  h.characteristic.notify(packet()); h.device.emit('gattserverdisconnected');
  assert.equal(h.gatt.connections, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.readings.length, 0);
  assert.equal(h.client.state.phase, 'disconnected');
});

test('asynchronous view failures are handled without breaking notifications or cleanup', async () => {
  const h = harness({ onReading: async () => { throw new Error('cloud unavailable'); }, onError: async () => { throw new Error('view unavailable'); } });
  await h.client.connect(); h.characteristic.notify(packet()); await flush();
  assert.equal(h.client.state.phase, 'connected');
  assert.equal(h.errors.at(-1).kind, 'callback');
  h.client.disconnect();
  assert.equal(h.gatt.connected, false);
});

test('canceled picker and unsupported browser end predictably without retry loops', async () => {
  const cancelled = new Error('cancelled'); cancelled.name = 'NotFoundError';
  const h = harness({ selection: Promise.reject(cancelled) });
  await assert.rejects(h.client.connect(), { name: 'NotFoundError' });
  assert.equal(h.client.state.phase, 'disconnected');
  assert.equal(h.errors.length, 0);
  const client = new NeuroBandClient({ bluetooth: null });
  await assert.rejects(client.connect(), /Web Bluetooth/);
  assert.equal(client.state.phase, 'error');
});
