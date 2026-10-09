import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only fictional QA profiles and synthetic packets. No physical pairing claim.
// Passwords, PINs, cookies and browser device identifiers stay in memory.
export async function smokeBleOnline(baseUrl) {
  const origin = new URL(baseUrl).origin;
  assert.equal(new URL(baseUrl).protocol, 'https:');
  const families = [];
  async function request(route, { jar = new Map(), method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(origin + route, {
      method, signal: AbortSignal.timeout(30000),
      headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([key, value]) => key + '=' + value).join('; ') } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal(response.status, status, method + ' ' + route + ': status inesperado');
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], index = pair.indexOf('=');
      const key = pair.slice(0, index), value = pair.slice(index + 1);
      if (value) { assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); jar.set(key, value); }
      else jar.delete(key);
    }
    return response.json();
  }
  const health = await request('/api/health');
  assert.equal(health.ok, true);
  for (let i = 0; i < 2; i++) {
    const jar = new Map(), pin = randomBytes(8).toString('hex');
    const result = await request('/api/auth/signup', { jar, method: 'POST', status: 201, body: {
      guardianName: 'Responsável QA BLE', childName: 'Perfil fictício BLE', consent: true,
      email: 'ble-qa-' + randomUUID() + '@example.com', password: randomBytes(24).toString('base64url'), kidPin: pin
    } });
    families.push({ jar, pin, childId: result.child.id });
  }
  const [own, other] = families, prefix = '/api/children/' + own.childId;
  let sessionId;
  try {
    await request('/api/auth/refresh', { jar: own.jar, method: 'POST' });
    assert.equal((await request(prefix + '/ble/status', { jar: own.jar })).session, null);
    const registration = { deviceId: 'synthetic-qa-' + randomUUID(), deviceName: 'NeuroBand-QA', connectionId: randomUUID() };
    const opened = await request(prefix + '/ble/sessions', { jar: own.jar, method: 'POST', body: registration, status: 201 });
    sessionId = opened.session.id;
    assert.equal(opened.protocol.packetBytes, 3);
    assert.equal((await request(prefix + '/ble/sessions', { jar: own.jar, method: 'POST', body: registration, status: 201 })).session.id, sessionId);
    assert.equal((await request(prefix + '/ble/status', { jar: own.jar })).connected, true);
    await request(prefix + '/ble/status', { jar: other.jar, status: 404 });
    const readings = [72, 73].map(bpm => ({ readingId: randomUUID(), bpm, signalQuality: 90, measuredAt: new Date().toISOString() }));
    const body = { sessionId, readings };
    await request(prefix + '/vitals/ble', { method: 'POST', body, status: 401 });
    await request(prefix + '/vitals/ble', { jar: other.jar, method: 'POST', body, status: 404 });
    await request(prefix + '/kid-login', { jar: own.jar, method: 'POST', body: { pin: own.pin } });
    const childOnly = new Map([['nb_kid_session', own.jar.get('nb_kid_session')]]);
    await request(prefix + '/vitals/ble', { jar: childOnly, method: 'POST', body, status: 401 });
    const accepted = await request(prefix + '/vitals/ble', { jar: own.jar, method: 'POST', body, status: 202 });
    assert.deepEqual(accepted, { accepted: true, saved: 2, duplicates: 0 });
    assert.deepEqual(await request(prefix + '/vitals/ble', { jar: own.jar, method: 'POST', body, status: 202 }), { accepted: true, saved: 0, duplicates: 2 });
    const history = await request(prefix + '/vitals', { jar: own.jar });
    assert.equal(history.readings.length, 2);
    assert.ok(history.readings.every(reading => reading.source === 'ble' && reading.ble_session_id === sessionId));
    assert.deepEqual(new Set(history.readings.map(reading => reading.client_reading_id)), new Set(readings.map(reading => reading.readingId)));
    await request(prefix + '/vitals/ble', { jar: own.jar, method: 'POST', status: 400,
      body: { sessionId, readings: [{ ...readings[0], readingId: randomUUID(), measuredAt: new Date(Date.now() - 360000).toISOString() }] } });
    await request(prefix + '/ble/sessions/' + sessionId + '/heartbeat', { jar: own.jar, method: 'POST', body: {} });
    await request(prefix + '/ble/sessions/' + sessionId + '/end', { jar: other.jar, method: 'POST', body: {}, status: 404 });
    await request(prefix + '/ble/sessions/' + sessionId + '/end', { jar: own.jar, method: 'POST', body: {} });
    await request(prefix + '/ble/sessions/' + sessionId + '/end', { jar: own.jar, method: 'POST', body: {} });
    const ended = await request(prefix + '/ble/status', { jar: own.jar });
    assert.equal(ended.connected, false); assert.equal(ended.session.status, 'ended');
    await request(prefix + '/vitals/ble', { jar: own.jar, method: 'POST', body, status: 409 });
    return { origin, checks: 'sessão BLE, abertura idempotente, lote, deduplicação, histórico persistente, isolamento de famílias/papéis, timestamps, heartbeat e encerramento', physicalPairing: 'não testado — pacotes sintéticos' };
  } finally {
    if (sessionId) await request(prefix + '/ble/sessions/' + sessionId + '/end', { jar: own.jar, method: 'POST', body: {} }).catch(() => {});
    for (const family of families) {
      if (family.jar.has('nb_kid_session')) await request('/api/children/logout', { jar: family.jar, method: 'POST' }).catch(() => {});
      await request('/api/auth/logout', { jar: family.jar, method: 'POST' }).catch(() => {});
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  try { console.log(JSON.stringify(await smokeBleOnline(process.argv[2]), null, 2)); }
  catch (error) { console.error('Verificação BLE online falhou:', error.message); process.exitCode = 1; }
}
