import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let localDatabase = false;
try { localDatabase = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname); } catch {}

test('BLE persiste leituras no PostgreSQL com isolamento, sessão e reenvio seguro', {
  skip: !localDatabase && 'Configure um PostgreSQL local; testes nunca alteram banco remoto.',
}, async t => {
  const schema = `nb_ble_test_${crypto.randomBytes(10).toString('hex')}`;
  assert.match(schema, /^nb_ble_test_[a-f0-9]{20}$/);
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
  const apps = [];
  let schemaCreated = false;
  t.after(async () => {
    for (const item of apps) await item.close();
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const sql = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await pool.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  // Reapplying the migration must preserve readings and support an existing database.
  await pool.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  const config = readConfig({ DATABASE_URL: databaseUrl, JWT_SECRET: crypto.randomBytes(32).toString('hex'), FRONTEND_ORIGIN: 'http://localhost:5500' });
  async function newApp() {
    const result = await buildApp({ config, pool, logger: false });
    apps.push(result);
    await result.ready();
    return result;
  }
  let app = await newApp();
  const families = [];
  for (const suffix of ['one', 'two']) {
    const guardian = (await pool.query('INSERT INTO guardians(name,email,password_hash,consent_at) VALUES($1,$2,$3,now()) RETURNING id', ['Família fictícia', `ble-${suffix}@example.com`, 'hash-unused-in-token-fixture'])).rows[0];
    const child = (await pool.query('INSERT INTO children(guardian_id,display_name,kid_pin_hash) VALUES($1,$2,$3) RETURNING id', [guardian.id, 'Criança fictícia', 'hash-unused-in-token-fixture'])).rows[0];
    families.push({ guardianId: guardian.id, childId: child.id });
  }
  function guardianCookie(family = families[0]) { return `nb_session=${app.jwt.sign({ sub: family.guardianId, role: 'guardian' })}`; }
  function childCookie() { return `nb_kid_session=${app.jwt.sign({ sub: families[0].childId, guardianId: families[0].guardianId, role: 'child' })}`; }
  const base = `/api/children/${families[0].childId}`;
  function request(method, path, payload, cookie = guardianCookie()) {
    return app.inject({ method, url: `${base}${path}`, payload, headers: { cookie, origin: 'http://localhost:5500' } });
  }
  function reading(overrides = {}) { return { readingId: crypto.randomUUID(), bpm: 82, signalQuality: 90, measuredAt: new Date().toISOString(), ...overrides }; }
  async function countReadings() { return Number((await pool.query('SELECT count(*)::int AS count FROM vitals WHERE child_id=$1', [families[0].childId])).rows[0].count); }
  let sessionId;
  let firstReading;

  await t.test('responsável renova a sessão antes de expirar sem aceitar o cookie infantil', async () => {
    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: guardianCookie(), origin: 'http://localhost:5500' } });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.match(refreshed.headers['set-cookie'], /^nb_session=.*Max-Age=1200/);
    assert.match(refreshed.headers['set-cookie'], /HttpOnly/);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: childCookie() } })).statusCode, 401);
    const expired = `nb_session=${app.jwt.sign({ sub: families[0].guardianId, role: 'guardian' }, { expiresIn: -1 })}`;
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: expired } })).statusCode, 401);
    const initial = await request('GET', '/ble/status');
    assert.deepEqual(initial.json(), { session: null, connected: false });
  });

  await t.test('somente o responsável dono pode registrar a sessão BLE', async () => {
    const payload = { deviceId: 'browser-device-fixture-one', deviceName: 'NeuroBand', connectionId: crypto.randomUUID() };
    assert.equal((await request('POST', '/ble/sessions', payload, '')).statusCode, 401);
    assert.equal((await request('POST', '/ble/sessions', payload, childCookie())).statusCode, 401);
    assert.equal((await request('POST', '/ble/sessions', payload, guardianCookie(families[1]))).statusCode, 404);
    assert.equal((await request('GET', '/ble/status', undefined, guardianCookie(families[1]))).statusCode, 404);
    const response = await request('POST', '/ble/sessions', payload);
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().protocol.packetBytes, 3);
    assert.equal(response.json().protocol.serviceUuid, '7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000');
    assert.equal(response.json().protocol.dataUuid, '7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000');
    const sessions = await pool.query('SELECT * FROM ble_sessions WHERE child_id=$1 ORDER BY started_at DESC', [families[0].childId]);
    assert.equal(sessions.rowCount, 1);
    sessionId = sessions.rows[0].id;
    assert.equal(response.json().session.id, sessionId);
    assert.equal(sessions.rows[0].device_name, 'NeuroBand');
    assert.match(sessions.rows[0].device_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(sessions.rows[0].device_hash, payload.deviceId);
    assert.equal(sessions.rows[0].ended_at, null);
    assert.ok(sessions.rows[0].last_seen);
    const retried = await request('POST', '/ble/sessions', payload);
    assert.equal(retried.statusCode, 201, retried.body);
    assert.equal(retried.json().session.id, sessionId);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ble_sessions WHERE child_id=$1', [families[0].childId])).rows[0].count, 1);
  });
  await t.test('status e heartbeat distinguem sessão recente de conexão expirada', async () => {
    const status = await request('GET', '/ble/status');
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().connected, true);
    assert.equal(status.json().session.status, 'connected');
    assert.ok(status.body.includes(sessionId));
    assert.ok(!status.body.includes('browser-device-fixture-one'));
    await pool.query("UPDATE ble_sessions SET last_seen=now()-interval '70 seconds' WHERE id=$1", [sessionId]);
    const stale = await request('GET', '/ble/status');
    assert.equal(stale.statusCode, 200, stale.body);
    assert.equal(stale.json().connected, false);
    assert.equal(stale.json().session.status, 'stale');
    const heartbeat = await request('POST', `/ble/sessions/${sessionId}/heartbeat`, {});
    assert.equal(heartbeat.statusCode, 200, heartbeat.body);
    const row = (await pool.query('SELECT last_seen FROM ble_sessions WHERE id=$1', [sessionId])).rows[0];
    assert.ok(Date.now() - new Date(row.last_seen).getTime() < 10000);
    assert.equal((await request('POST', `/ble/sessions/${sessionId}/heartbeat`, {}, guardianCookie(families[1]))).statusCode, 404);
  });
  await t.test('lote salva origem, sessão, identificador e deduplica reenvios', async () => {
    firstReading = reading();
    const payload = { sessionId, readings: [firstReading, reading({ bpm: 84 })] };
    const accepted = await request('POST', '/vitals/ble', payload);
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.deepEqual(accepted.json(), { accepted: true, saved: 2, duplicates: 0 });
    assert.equal(await countReadings(), 2);
    const row = (await pool.query('SELECT * FROM vitals WHERE child_id=$1 AND client_reading_id=$2', [families[0].childId, firstReading.readingId])).rows[0];
    assert.equal(row.source, 'ble');
    assert.equal(row.ble_session_id, sessionId);
    assert.equal(row.bpm, firstReading.bpm);
    assert.equal(row.signal_quality, firstReading.signalQuality);
    assert.equal(new Date(row.measured_at).toISOString(), firstReading.measuredAt);
    const retry = await request('POST', '/vitals/ble', payload);
    assert.equal(retry.statusCode, 202, retry.body);
    assert.deepEqual(retry.json(), { accepted: true, saved: 0, duplicates: 2 });
    assert.equal(await countReadings(), 2);
    assert.ok((await pool.query('SELECT last_packet_at FROM ble_sessions WHERE id=$1', [sessionId])).rows[0].last_packet_at);
  });
  await t.test('requisições concorrentes com os mesmos identificadores salvam cada leitura uma vez', async () => {
    const payload = { sessionId, readings: [reading(), reading()] };
    const before = await countReadings();
    const results = await Promise.all([request('POST', '/vitals/ble', payload), request('POST', '/vitals/ble', payload)]);
    for (const response of results) assert.equal(response.statusCode, 202, response.body);
    assert.equal(results.reduce((sum, response) => sum + response.json().saved, 0), 2);
    assert.equal(await countReadings(), before + 2);
  });
  await t.test('sessão sem atividade por cinco minutos não recebe novos pacotes', async () => {
    const before = await countReadings();
    await pool.query("UPDATE ble_sessions SET last_seen=now()-interval '310 seconds' WHERE id=$1", [sessionId]);
    try {
      const expired = await request('POST', '/vitals/ble', { sessionId, readings: [reading()] });
      assert.equal(expired.statusCode, 410, expired.body);
      assert.equal(await countReadings(), before);
    } finally {
      await pool.query('UPDATE ble_sessions SET last_seen=now() WHERE id=$1', [sessionId]);
    }
  });
  await t.test('inválidos rejeitam todo o lote e impedem leituras de outro dono', async () => {
    const before = await countReadings();
    for (const invalid of [
      reading({ bpm: 251 }), reading({ signalQuality: 101 }), reading({ readingId: 'bad-id' }),
      reading({ measuredAt: new Date(Date.now() + 35000).toISOString() }),
      reading({ measuredAt: new Date(Date.now() - 310000).toISOString() }),
    ]) {
      const response = await request('POST', '/vitals/ble', { sessionId, readings: [reading(), invalid] });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(await countReadings(), before);
    }
    assert.equal((await request('POST', '/vitals/ble', { sessionId, readings: [] })).statusCode, 400);
    assert.equal((await request('POST', '/vitals/ble', { sessionId, readings: Array.from({ length: 21 }, () => reading()) })).statusCode, 400);
    assert.equal((await request('POST', '/vitals/ble', { sessionId, readings: [reading()] }, childCookie())).statusCode, 401);
    assert.equal((await request('POST', '/vitals/ble', { sessionId, readings: [reading()] }, guardianCookie(families[1]))).statusCode, 404);
    const wrongChild = await app.inject({ method: 'POST', url: `/api/children/${families[1].childId}/vitals/ble`, headers: { cookie: guardianCookie(families[1]) }, payload: { sessionId, readings: [reading()] } });
    assert.equal(wrongChild.statusCode, 404, wrongChild.body);
    assert.equal(await countReadings(), before);
  });
  await t.test('falha de banco no meio do lote desfaz todas as inserções da transação', async () => {
    const before = await countReadings();
    const previous = (await pool.query('SELECT last_packet_at FROM ble_sessions WHERE id=$1', [sessionId])).rows[0].last_packet_at;
    await pool.query('ALTER TABLE vitals ADD CONSTRAINT ble_test_rollback CHECK (bpm <> 129)');
    try {
      const result = await request('POST', '/vitals/ble', { sessionId, readings: [reading({ bpm: 128 }), reading({ bpm: 129 })] });
      assert.equal(result.statusCode, 500, result.body);
      assert.equal(await countReadings(), before);
      const after = (await pool.query('SELECT last_packet_at FROM ble_sessions WHERE id=$1', [sessionId])).rows[0].last_packet_at;
      assert.equal(new Date(after).getTime(), new Date(previous).getTime());
    } finally {
      await pool.query('ALTER TABLE vitals DROP CONSTRAINT ble_test_rollback');
    }
  });
  await t.test('histórico e última leitura continuam persistidos em outra instância', async () => {
    const latest = await request('GET', '/vitals/latest');
    assert.equal(latest.statusCode, 200, latest.body);
    assert.equal(latest.json().reading.source, 'ble');
    assert.equal(latest.json().reading.ble_session_id, sessionId);
    const history = await request('GET', '/vitals?limit=20');
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().readings.length, 4);
    assert.ok(history.json().readings.every(item => item.source === 'ble' && item.ble_session_id === sessionId));
    await app.close();
    app = await newApp();
    const persisted = await request('GET', '/vitals?limit=20');
    assert.equal(persisted.json().readings.length, 4);
  });
  await t.test('encerrar a sessão bloqueia pacotes e heartbeat sem apagar o histórico', async () => {
    const ended = await request('POST', `/ble/sessions/${sessionId}/end`, {});
    assert.equal(ended.statusCode, 200, ended.body);
    assert.ok((await pool.query('SELECT ended_at FROM ble_sessions WHERE id=$1', [sessionId])).rows[0].ended_at);
    assert.equal((await request('POST', '/vitals/ble', { sessionId, readings: [reading()] })).statusCode, 409);
    assert.equal((await request('POST', `/ble/sessions/${sessionId}/heartbeat`, {})).statusCode, 409);
    assert.equal(await countReadings(), 4);
    assert.equal((await request('POST', `/ble/sessions/${sessionId}/end`, {}, guardianCookie(families[1]))).statusCode, 404);
    assert.equal((await request('POST', `/ble/sessions/${sessionId}/end`, {})).statusCode, 200);
    const status = await request('GET', '/ble/status');
    assert.equal(status.json().connected, false);
    assert.equal(status.json().session.status, 'ended');
  });
  await t.test('corrida entre leitura e encerramento mantém a conexão encerrada ao concluir', async () => {
    const family = families[1];
    const cookie = guardianCookie(family);
    const secondBase = `/api/children/${family.childId}`;
    const created = await app.inject({ method: 'POST', url: `${secondBase}/ble/sessions`, headers: { cookie }, payload: { deviceId: 'browser-device-fixture-two', deviceName: 'NeuroBand' } });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().session.id;
    const incoming = reading();
    const [ingested, ended] = await Promise.all([
      app.inject({ method: 'POST', url: `${secondBase}/vitals/ble`, headers: { cookie }, payload: { sessionId: id, readings: [incoming] } }),
      app.inject({ method: 'POST', url: `${secondBase}/ble/sessions/${id}/end`, headers: { cookie }, payload: {} }),
    ]);
    assert.ok([202, 409].includes(ingested.statusCode), ingested.body);
    assert.equal(ended.statusCode, 200, ended.body);
    assert.ok((await pool.query('SELECT ended_at FROM ble_sessions WHERE id=$1', [id])).rows[0].ended_at);
    const count = (await pool.query('SELECT count(*)::int AS count FROM vitals WHERE child_id=$1', [family.childId])).rows[0].count;
    assert.equal(count, ingested.statusCode === 202 ? 1 : 0);
    const late = await app.inject({ method: 'POST', url: `${secondBase}/vitals/ble`, headers: { cookie }, payload: { sessionId: id, readings: [reading()] } });
    assert.equal(late.statusCode, 409, late.body);
  });
  await t.test('formato legado permanece compatível e exclusão do perfil remove os dados', async () => {
    const payload = { bpm: 86, signalQuality: 80, measuredAt: new Date().toISOString() };
    const legacy = await request('POST', '/vitals/ble', payload);
    assert.equal(legacy.statusCode, 202, legacy.body);
    assert.equal(await countReadings(), 5);
    await pool.query('DELETE FROM guardians WHERE id=$1', [families[0].guardianId]);
    assert.equal(await countReadings(), 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ble_sessions WHERE child_id=$1', [families[0].childId])).rows[0].count, 0);
    assert.equal((await request('GET', '/ble/status')).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: guardianCookie() } })).statusCode, 401);
  });
});
