export const BLE_SERVICE_UUID = '7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000';
export const BLE_DATA_UUID = '7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000';
const deviceGattQueues = new WeakMap();

// NeuroBand v1: uint16 little-endian BPM followed by uint8 signal quality.
export function decodeBandPacket(value) {
  try {
    let view;
    if (value instanceof DataView) view = value;
    else if (value instanceof ArrayBuffer) view = new DataView(value);
    else if (ArrayBuffer.isView(value)) view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    if (!view || view.byteLength !== 3) return null;
    const bpm = view.getUint16(0, true), signalQuality = view.getUint8(2);
    return bpm >= 25 && bpm <= 250 && signalQuality <= 100 ? { bpm, signalQuality } : null;
  } catch { return null; }
}

function readingId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class NeuroBandClient {
  constructor({
    bluetooth = globalThis.navigator?.bluetooth,
    onState = () => {}, onReading = () => {}, onError = () => {},
    now = () => new Date(), makeReadingId = readingId,
    setTimer = globalThis.setTimeout.bind(globalThis),
    clearTimer = globalThis.clearTimeout.bind(globalThis),
    retryDelays = [1000, 2000, 4000, 8000, 12000]
  } = {}) {
    this.bluetooth = bluetooth;
    this.onState = onState;
    this.onReading = onReading;
    this.onError = onError;
    this.now = now;
    this.makeReadingId = makeReadingId;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.retryDelays = [...retryDelays];
    this._generation = 0;
    this._device = null;
    this._connection = null;
    this._retryTimer = null;
    this._gattQueue = Promise.resolve();
    this._state = { phase: 'disconnected', reconnectAttempts: 0, deviceName: '', notifications: false, error: null };
  }

  get state() { return { ...this._state }; }
  get device() { return this._device; }

  _callback(callback, value) {
    try {
      const pending = callback(value);
      if (pending && typeof pending.then === 'function') pending.catch(error => this._error('callback', error));
    } catch (error) { this._error('callback', error); }
  }

  _error(kind, error) {
    try {
      const pending = this.onError({ kind, error });
      if (pending && typeof pending.then === 'function') pending.catch(() => {});
    } catch { /* A view callback cannot disrupt Bluetooth cleanup. */ }
  }

  _setState(patch) {
    this._state = { ...this._state, ...patch };
    this._callback(this.onState, this.state);
  }

  _cancelRetry() {
    if (this._retryTimer !== null) this.clearTimer(this._retryTimer);
    this._retryTimer = null;
  }

  _dispose(connection, disconnect = false) {
    if (!connection) return;
    connection.active = false;
    connection.device.removeEventListener('gattserverdisconnected', connection.onDisconnect);
    connection.characteristic?.removeEventListener('characteristicvaluechanged', connection.onData);
    if (this._connection === connection) this._connection = null;
    if (disconnect) {
      try { if (connection.device.gatt?.connected) connection.device.gatt.disconnect(); } catch {}
    }
  }

  _current(generation, device, connection) {
    return this._generation === generation && this._device === device &&
      this._connection === connection && connection.active;
  }

  _guard(generation, device, connection) {
    if (this._current(generation, device, connection)) return true;
    this._dispose(connection, true);
    return false;
  }

  _queueGatt(device, operation) {
    // A new controller can select the same device while an old connect settles.
    const pending = Promise.all([this._gattQueue, deviceGattQueues.get(device)]).then(operation);
    this._gattQueue = pending.catch(() => {});
    deviceGattQueues.set(device, this._gattQueue);
    return pending;
  }

  // requestDevice must run directly inside the button gesture, before any await.
  connect({ manual = true } = {}) {
    if (!manual) {
      const generation = this._generation, device = this._device;
      if (!device) return Promise.resolve(null);
      return this._queueGatt(device, () => this._connectDevice(device, generation, true));
    }
    this._generation += 1;
    const generation = this._generation;
    this._cancelRetry();
    this._dispose(this._connection, true);
    this._device = null;
    this._setState({ phase: 'selecting', reconnectAttempts: 0, deviceName: '', notifications: false, error: null });
    if (generation !== this._generation) return Promise.resolve(null);
    let selection;
    try {
      if (!this.bluetooth?.requestDevice) throw new Error('Web Bluetooth não está disponível. Use Chrome ou Edge em HTTPS.');
      selection = this.bluetooth.requestDevice({
        filters: [{ namePrefix: 'NeuroBand' }, { services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID]
      });
    } catch (error) { selection = Promise.reject(error); }
    return Promise.resolve(selection).then(device => {
      if (generation !== this._generation) return null;
      this._device = device;
      this._setState({ deviceName: String(device.name || 'NeuroBand').slice(0, 80) });
      return this._queueGatt(device, () => this._connectDevice(device, generation, false));
    }).catch(error => {
      if (generation !== this._generation) return null;
      const cancelled = error.name === 'NotFoundError';
      this._setState({ phase: cancelled ? 'disconnected' : 'error', notifications: false, error: cancelled ? null : error.message });
      if (!cancelled) this._error('transport', error);
      throw error;
    });
  }

  async _connectDevice(device, generation, reconnecting) {
    if (generation !== this._generation || device !== this._device) return null;
    this._dispose(this._connection, true);
    const connection = { device, characteristic: null, active: true, onData: null, onDisconnect: null };
    connection.onDisconnect = () => {
      if (!this._current(generation, device, connection)) return;
      this._dispose(connection);
      this._scheduleReconnect(generation);
    };
    device.addEventListener('gattserverdisconnected', connection.onDisconnect);
    this._connection = connection;
    this._setState({ phase: 'connecting', notifications: false, error: null });
    try {
      if (!this._guard(generation, device, connection)) return null;
      const server = await device.gatt.connect();
      if (!this._guard(generation, device, connection)) return null;
      this._setState({ phase: 'discovering' });
      if (!this._guard(generation, device, connection)) return null;
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      if (!this._guard(generation, device, connection)) return null;
      const characteristic = await service.getCharacteristic(BLE_DATA_UUID);
      if (!this._guard(generation, device, connection)) return null;
      connection.characteristic = characteristic;
      connection.onData = event => {
        if (!this._current(generation, device, connection) || event.target !== characteristic) return;
        const packet = decodeBandPacket(characteristic.value);
        if (!packet) { this._error('packet', new Error('A NeuroBand enviou um pacote BLE inválido.')); return; }
        try {
          this._callback(this.onReading, { ...packet, measuredAt: this.now().toISOString(), readingId: this.makeReadingId() });
        } catch (error) { this._error('callback', error); }
      };
      characteristic.addEventListener('characteristicvaluechanged', connection.onData);
      this._setState({ phase: 'subscribing' });
      if (!this._guard(generation, device, connection)) return null;
      await characteristic.startNotifications();
      if (!this._guard(generation, device, connection)) return null;
      this._setState({ phase: 'connected', reconnectAttempts: 0, notifications: true, error: null });
      return this._current(generation, device, connection) ? this.state : null;
    } catch (error) {
      if (!this._current(generation, device, connection)) { this._dispose(connection, true); return null; }
      this._dispose(connection, true);
      if (reconnecting) { this._scheduleReconnect(generation, error); this._error('transport', error); }
      throw error;
    }
  }

  _scheduleReconnect(generation, error = null) {
    if (generation !== this._generation || !this._device || this._retryTimer !== null) return;
    const attempts = this._state.reconnectAttempts;
    if (attempts >= this.retryDelays.length) {
      this._setState({ phase: 'error', notifications: false, error: 'Não foi possível reconectar a NeuroBand. Aproxime a pulseira e conecte novamente.' });
      return;
    }
    this._setState({ phase: 'reconnecting', notifications: false, error: error?.message || null });
    if (generation !== this._generation || !this._device) return;
    this._retryTimer = this.setTimer(() => {
      this._retryTimer = null;
      if (generation !== this._generation || !this._device) return;
      this._setState({ reconnectAttempts: attempts + 1 });
      this.connect({ manual: false }).catch(() => {});
    }, this.retryDelays[attempts]);
  }

  disconnect() {
    this._generation += 1;
    this._cancelRetry();
    this._dispose(this._connection, true);
    this._device = null;
    this._setState({ phase: 'disconnected', reconnectAttempts: 0, deviceName: '', notifications: false, error: null });
  }
}
