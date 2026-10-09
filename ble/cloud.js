const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE = 5 * 60 * 1000;
const MAX_PENDING = 120;
const BATCH_SIZE = 20;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function createConnectionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class BleCloudBridge {
  constructor({ api, childId, onState = () => {}, onAuthExpired = () => {},
    now = Date.now, makeConnectionId = createConnectionId,
    setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis)
  } = {}) {
    if (typeof api !== 'function' || typeof childId !== 'string' || !childId) throw new TypeError('API e perfil infantil são obrigatórios.');
    this.api = api;
    this.childId = childId;
    this.path = '/api/children/' + encodeURIComponent(childId);
    this.onState = onState;
    this.onAuthExpired = onAuthExpired;
    this.now = () => Number(now());
    this.makeConnectionId = makeConnectionId;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this._queue = [];
    this._seen = new Map();
    this._generation = 0;
    this._stopped = false;
    this._connected = false;
    this._everConnected = false;
    this._blocked = false;
    this._sessionId = null;
    this._connectionId = null;
    this._device = {};
    this._opening = null;
    this._busy = null;
    this._flushTimer = null;
    this._flushDue = 0;
    this._heartbeatTimer = null;
    this._heartbeatDue = false;
    this._retryAttempt = 0;
    this._retryUntil = 0;
    this._flushRequested = false;
    this._stopPromise = null;
    this._state = { phase: 'pending', pending: 0, lastSavedAt: null, message: 'Aguardando conexão com a NeuroBand.' };
  }

  get state() { return { ...this._state }; }

  _callback(callback, value) {
    try {
      const result = callback(value);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {}
  }

  _emit(patch = {}) {
    this._state = { ...this._state, ...patch, pending: this._queue.length };
    this._callback(this.onState, this.state);
  }

  _prune() {
    const oldest = this.now() - MAX_AGE;
    this._queue = this._queue.filter(reading => Date.parse(reading.measuredAt) >= oldest);
    for (const [id, measuredAt] of this._seen) if (measuredAt < oldest) this._seen.delete(id);
    while (this._seen.size > MAX_PENDING * 2) this._seen.delete(this._seen.keys().next().value);
  }

  add(reading) {
    if (this._stopped) return false;
    const measuredAt = Date.parse(reading?.measuredAt), current = this.now();
    if (!UUID.test(reading?.readingId || '') || !Number.isInteger(reading?.bpm) || reading.bpm < 25 || reading.bpm > 250 ||
      !Number.isInteger(reading?.signalQuality) || reading.signalQuality < 0 || reading.signalQuality > 100 ||
      !Number.isFinite(measuredAt) || measuredAt < current - MAX_AGE || measuredAt > current + 30000) return false;
    this._prune();
    if (this._seen.has(reading.readingId)) return false;
    this._seen.set(reading.readingId, measuredAt);
    this._queue.push({ readingId: reading.readingId, bpm: reading.bpm, signalQuality: reading.signalQuality, measuredAt: new Date(measuredAt).toISOString() });
    if (this._queue.length > MAX_PENDING) this._queue.splice(0, this._queue.length - MAX_PENDING);
    this._emit({ phase: this._state.phase === 'offline' ? 'offline' : 'pending', message: 'Leituras aguardando confirmação do servidor.' });
    this._scheduleFlush(this._queue.length >= BATCH_SIZE ? 0 : 5000);
    return true;
  }

  setConnected(connected, { deviceId, deviceName } = {}) {
    if (this._stopped) return;
    this._connected = Boolean(connected);
    if (!this._connected) {
      this._cancelHeartbeat();
      this._emit({ phase: this._queue.length ? 'pending' : this._state.phase, message: 'Pulseira desconectada. Leituras recebidas continuam aguardando envio.' });
      if (this._queue.length) this._scheduleFlush(5000);
      return;
    }
    this._everConnected = true;
    this._blocked = false;
    if (typeof deviceId === 'string' && deviceId) this._device.deviceId = deviceId.slice(0, 200);
    if (typeof deviceName === 'string' && deviceName) this._device.deviceName = deviceName.slice(0, 80);
    this._emit({ phase: this._sessionId ? 'online' : 'connecting', message: this._sessionId ? 'NeuroBand conectada ao servidor.' : 'Conectando a NeuroBand ao servidor.' });
    this._scheduleFlush(0);
    this._scheduleHeartbeat();
  }

  _cancelHeartbeat() {
    if (this._heartbeatTimer !== null) this.clearTimer(this._heartbeatTimer);
    this._heartbeatTimer = null;
    this._heartbeatDue = false;
  }

  _clearTimers() {
    if (this._flushTimer !== null) this.clearTimer(this._flushTimer);
    this._flushTimer = null;
    this._cancelHeartbeat();
  }

  _scheduleFlush(delay) {
    if (this._stopped || this._blocked) return;
    const due = Math.max(this.now() + delay, this._retryUntil);
    if (this._flushTimer !== null && this._flushDue <= due) return;
    if (this._flushTimer !== null) this.clearTimer(this._flushTimer);
    this._flushDue = due;
    this._flushTimer = this.setTimer(() => { this._flushTimer = null; this.flush(); }, Math.max(0, due - this.now()));
  }

  _scheduleHeartbeat(delay = 25000) {
    if (this._stopped || this._blocked || !this._connected || !this._sessionId || this._heartbeatTimer !== null) return;
    this._heartbeatTimer = this.setTimer(() => {
      this._heartbeatTimer = null;
      this._heartbeatDue = true;
      this.flush();
    }, Math.max(delay, this._retryUntil - this.now()));
  }

  async _open(generation) {
    if (this._connectionId === null) this._connectionId = this.makeConnectionId();
    this._emit({ phase: 'connecting', message: 'Conectando a NeuroBand ao servidor.' });
    if (generation !== this._generation || this._stopped) return null;
    const pending = Promise.resolve(this.api(this.path + '/ble/sessions', {
      method: 'POST', body: JSON.stringify({ ...this._device, connectionId: this._connectionId })
    })).then(response => {
      if (typeof response?.session?.id !== 'string' || !response.session.id) throw new Error('O servidor não confirmou a sessão BLE.');
      return response.session.id;
    });
    this._opening = pending;
    try {
      const id = await pending;
      if (generation !== this._generation || this._stopped) return null;
      this._sessionId = id;
      return id;
    } finally { if (this._opening === pending) this._opening = null; }
  }

  flush() {
    if (this._stopped || this._blocked) return Promise.resolve();
    if (this._retryUntil > this.now()) { this._scheduleFlush(this._retryUntil - this.now()); return Promise.resolve(); }
    if (this._flushTimer !== null) this.clearTimer(this._flushTimer);
    this._flushTimer = null;
    if (this._busy) { this._flushRequested = true; return this._busy; }
    const generation = this._generation;
    this._busy = this._tick(generation).finally(() => {
      this._busy = null;
      if (generation !== this._generation || this._stopped || this._blocked) return;
      const requested = this._flushRequested; this._flushRequested = false;
      if (this._queue.length || this._heartbeatDue || (!this._sessionId && this._connected)) this._scheduleFlush(requested ? 0 : 5000);
      this._scheduleHeartbeat();
    });
    return this._busy;
  }

  async _tick(generation) {
    let operation = 'open', batch = [];
    try {
      this._prune();
      if (!this._sessionId && (this._connected || (this._everConnected && this._queue.length))) await this._open(generation);
      if (generation !== this._generation || this._stopped) return;
      if (!this._sessionId) { this._emit(); return; }
      if (this._queue.length) {
        operation = 'readings';
        batch = this._queue.slice(0, BATCH_SIZE);
        const response = await this.api(this.path + '/vitals/ble', {
          method: 'POST', body: JSON.stringify({ sessionId: this._sessionId, readings: batch })
        });
        if (generation !== this._generation || this._stopped) return;
        if (response?.accepted !== true) throw new Error('O servidor não confirmou as leituras BLE.');
        const accepted = new Set(batch.map(reading => reading.readingId));
        this._queue = this._queue.filter(reading => !accepted.has(reading.readingId));
        this._emit({ lastSavedAt: new Date(this.now()).toISOString() });
      }
      if (this._heartbeatDue && this._connected) {
        operation = 'heartbeat';
        await this.api(this.path + '/ble/sessions/' + encodeURIComponent(this._sessionId) + '/heartbeat', { method: 'POST', body: '{}' });
        if (generation !== this._generation || this._stopped) return;
        this._heartbeatDue = false;
      }
      this._retryAttempt = 0; this._retryUntil = 0;
      this._emit({ phase: this._queue.length || !this._connected ? 'pending' : 'online', message: this._queue.length ? 'Leituras aguardando confirmação do servidor.' : this._connected ? 'NeuroBand conectada ao servidor.' : 'Leituras recebidas foram enviadas.' });
    } catch (error) {
      if (generation !== this._generation || this._stopped) return;
      if (error.status === 401) { this._expireAuth(); return; }
      if ([409, 410].includes(error.status)) {
        this._sessionId = null; this._connectionId = null;
        this._cancelHeartbeat();
        this._retryAttempt = 0; this._retryUntil = 0;
        this._emit({ phase: 'pending', message: 'Renovando a sessão da NeuroBand.' });
        this._flushRequested = true;
        return;
      }
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        if (operation === 'readings' && error.status === 400) {
          const invalid = new Set(batch.map(reading => reading.readingId));
          this._queue = this._queue.filter(reading => !invalid.has(reading.readingId));
        } else this._blocked = true;
        this._emit({ phase: 'offline', message: error.message || 'O servidor recusou a operação BLE.' });
        return;
      }
      const suggested = Number(error.retryAfterMs) || Number(error.retryAfter) * 1000;
      const delay = error.status === 429 && suggested > 0 ? suggested : error.status === 429 ? 30000 : RETRY_DELAYS[Math.min(this._retryAttempt++, RETRY_DELAYS.length - 1)];
      this._retryUntil = this.now() + delay;
      this._emit({ phase: 'offline', message: error.status === 429 ? 'Aguardando o servidor liberar novos envios.' : 'Sem confirmação do servidor. As leituras aguardam uma nova tentativa.' });
      this._scheduleFlush(delay);
    }
  }

  _expireAuth() {
    this._stopped = true;
    this._generation += 1;
    this._clearTimers();
    this._queue = []; this._seen.clear();
    this._sessionId = null;
    this._emit({ phase: 'stopped', message: 'A sessão da conta terminou. Entre novamente para conectar a NeuroBand.' });
    this._callback(this.onAuthExpired, { childId: this.childId });
  }

  stop() {
    if (this._stopPromise) return this._stopPromise;
    const existing = this._sessionId, opening = this._opening;
    this._stopped = true;
    this._generation += 1;
    this._connected = false;
    this._clearTimers();
    this._queue = []; this._seen.clear();
    this._sessionId = null;
    this._emit({ phase: 'stopped', message: 'Conexão com o servidor encerrada.' });
    this._stopPromise = (async () => {
      let late = null;
      if (opening) { try { late = await opening; } catch {} }
      for (const id of new Set([existing, late].filter(Boolean))) {
        try { await this.api(this.path + '/ble/sessions/' + encodeURIComponent(id) + '/end', { method: 'POST', body: '{}' }); } catch {}
      }
    })();
    return this._stopPromise;
  }
}
