const POLL_INTERVAL = 5000;
const REQUEST_TIMEOUT = 15000;
const HEARTBEAT_AGE = 65000;
const READING_AGE = 15000;
const FUTURE_TOLERANCE = 30000;

function timestamp(value) {
  return typeof value === 'string' && value ? Date.parse(value) : NaN;
}

function recent(value, now, maxAge) {
  const time = timestamp(value);
  return Number.isFinite(time) && now - time <= maxAge && time - now <= FUTURE_TOLERANCE;
}

function validReading(value, now) {
  if (!value || !Number.isInteger(value.bpm) || value.bpm < 25 || value.bpm > 250 ||
    !Number.isInteger(value.signal_quality) || value.signal_quality < 0 || value.signal_quality > 100 ||
    !Number.isFinite(timestamp(value.measured_at)) || timestamp(value.measured_at) - now > FUTURE_TOLERANCE) return null;
  return { ...value };
}

function validSession(value) {
  return value && typeof value.id === 'string' && value.id && ['connected', 'stale', 'ended'].includes(value.status)
    ? { ...value } : null;
}

function presence(session, reading, now) {
  const connected = Boolean(session?.status === 'connected' && !session.endedAt && recent(session.lastSeen, now, HEARTBEAT_AGE));
  const live = Boolean(connected && reading?.source === 'ble' && reading.ble_session_id === session.id &&
    recent(reading.measured_at, now, READING_AGE) && recent(reading.received_at, now, READING_AGE));
  return { connected, live };
}

function messageFor(connected, live, reading) {
  return live ? 'Recebendo leituras da NeuroBand pelo celular.' : connected
    ? 'O celular está conectado. Aguardando uma leitura atual da NeuroBand.' : reading
      ? 'Sem conexão ativa. A última leitura está disponível como registro.' : 'Aguardando o celular conectar a NeuroBand.';
}

/** Reads the authenticated child's cloud data; it never connects to Bluetooth. */
export class BandRemoteMonitor {
  constructor({ api, childId, onState = () => {}, onAuthExpired = () => {}, now = Date.now,
    setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis)
  } = {}) {
    if (typeof api !== 'function' || typeof childId !== 'string' || !childId) throw new TypeError('API e perfil infantil são obrigatórios.');
    this.api = api;
    this.childId = childId;
    this.path = '/api/children/' + encodeURIComponent(childId);
    this.onState = onState;
    this.onAuthExpired = onAuthExpired;
    this.now = () => Number(now());
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this._started = false;
    this._closed = false;
    this._authExpired = false;
    this._generation = 0;
    this._busy = null;
    this._controller = null;
    this._pollTimer = null;
    this._timeoutTimer = null;
    this._expiryTimer = null;
    this._state = {
      session: null, reading: null, connected: false, live: false, phase: 'stopped', lastCheckedAt: null,
      message: 'Acompanhamento remoto ainda não iniciado.'
    };
  }

  get state() {
    const current = presence(this._state.session, this._state.reading, this.now());
    return { ...this._state, connected: this._state.connected && current.connected, live: this._state.live && current.live,
      session: this._state.session ? { ...this._state.session } : null,
      reading: this._state.reading ? { ...this._state.reading } : null };
  }

  _callback(callback, value) {
    try {
      const result = callback(value);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {}
  }

  _emit(patch) {
    this._state = { ...this._state, ...patch };
    this._callback(this.onState, this.state);
  }

  _clearTimers() {
    if (this._pollTimer !== null) this.clearTimer(this._pollTimer);
    if (this._timeoutTimer !== null) this.clearTimer(this._timeoutTimer);
    this._cancelExpiry();
    this._pollTimer = this._timeoutTimer = null;
  }

  _cancelExpiry() {
    if (this._expiryTimer !== null) this.clearTimer(this._expiryTimer);
    this._expiryTimer = null;
  }

  _scheduleExpiry() {
    this._cancelExpiry();
    if (this._closed || !this._state.connected) return;
    const { session, reading, live } = this._state, now = this.now();
    const due = [timestamp(session.lastSeen) + HEARTBEAT_AGE + 1];
    if (live) due.push(timestamp(reading.measured_at) + READING_AGE + 1, timestamp(reading.received_at) + READING_AGE + 1);
    this._expiryTimer = this.setTimer(() => {
      this._expiryTimer = null;
      if (this._closed) return;
      const current = presence(this._state.session, this._state.reading, this.now());
      this._emit({ ...current, message: messageFor(current.connected, current.live, this._state.reading) });
      this._scheduleExpiry();
    }, Math.max(0, Math.min(...due) - now));
  }

  start() {
    if (this._closed) return Promise.resolve(this.state);
    this._started = true;
    return this.refresh();
  }

  refresh() {
    if (this._closed || !this._started) return Promise.resolve(this.state);
    if (this._busy) return this._busy;
    if (this._pollTimer !== null) this.clearTimer(this._pollTimer);
    this._pollTimer = null;
    const generation = this._generation, controller = new AbortController();
    this._controller = controller;
    let timedOut = false;
    const current = () => !this._closed && generation === this._generation;
    this._timeoutTimer = this.setTimer(() => {
      this._timeoutTimer = null;
      if (!current()) return;
      timedOut = true;
      controller.abort();
      this._cancelExpiry();
      this._emit({ phase: 'offline', connected: false, live: false, session: null,
        lastCheckedAt: new Date(this.now()).toISOString(),
        message: 'O servidor demorou para responder. A última leitura não indica conexão ativa.' });
    }, REQUEST_TIMEOUT);

    // Wait for both transports to settle even after abort. A transport that ignores
    // its signal must not create overlapping polling requests or revive live data.
    const requests = ['/ble/status', '/vitals/latest'].map(suffix => Promise.resolve()
      .then(() => current() ? this.api(this.path + suffix, { method: 'GET', signal: controller.signal }) : null)
      .catch(error => {
        if (current() && [401, 403].includes(error?.status)) this._expireAuth();
        throw error;
      }));
    const task = Promise.allSettled(requests).then(results => {
      if (!current() || timedOut) return this.state;
      const now = this.now(), lastCheckedAt = new Date(now).toISOString();
      if (results.some(result => result.status === 'rejected')) {
        const reading = results[1].status === 'fulfilled' ? validReading(results[1].value?.reading, now) : null;
        this._cancelExpiry();
        this._emit({ phase: 'offline', connected: false, live: false, session: null,
          reading: reading || this._state.reading, lastCheckedAt,
          message: 'Sem confirmação do servidor. A última leitura não indica conexão ativa.' });
        return this.state;
      }
      const session = validSession(results[0].value?.session), reading = validReading(results[1].value?.reading, now);
      const { connected, live } = presence(session, reading, now);
      this._emit({ phase: 'online', session, reading, connected, live, lastCheckedAt,
        message: messageFor(connected, live, reading) });
      this._scheduleExpiry();
      return this.state;
    }).finally(() => {
      if (this._busy !== task) return;
      this._busy = null;
      if (this._timeoutTimer !== null) this.clearTimer(this._timeoutTimer);
      this._timeoutTimer = null;
      if (this._controller === controller) this._controller = null;
      if (!current()) return;
      this._pollTimer = this.setTimer(() => {
        this._pollTimer = null;
        this.refresh();
      }, POLL_INTERVAL);
    });
    this._busy = task;
    return task;
  }

  _expireAuth() {
    if (this._authExpired) return;
    this._authExpired = true;
    this.stop('A sessão da conta terminou. Entre novamente para acompanhar a NeuroBand.');
    this._callback(this.onAuthExpired, { childId: this.childId });
  }

  stop(message = 'Acompanhamento remoto encerrado.') {
    if (this._closed) return;
    this._closed = true;
    this._generation += 1;
    this._clearTimers();
    this._controller?.abort();
    this._controller = null;
    this._emit({ phase: 'stopped', session: null, reading: null, connected: false, live: false, lastCheckedAt: null, message });
  }
}
