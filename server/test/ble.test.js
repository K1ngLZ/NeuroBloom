import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { batchSchema, isReadingTimeValid, readingSchema, registrationSchema } from '../src/ble.js';

const guardianId = '00000000-0000-4000-8000-000000000101';
const childId = '00000000-0000-4000-8000-000000000102';
const sessionId = '00000000-0000-4000-8000-000000000103';
const config = readConfig({ DATABASE_URL: 'postgres://test@127.0.0.1/test', JWT_SECRET: 'ble-test-secret-only-never-used-in-production-123456', FRONTEND_ORIGIN: 'http://localhost:5500' });
async function setup(t, query = async () => { throw new Error('Unauthenticated requests must never query the database'); }) {
  const app = await buildApp({ config, pool: { query }, logger: false });
  t.after(() => app.close());
  await app.ready();
  return app;
}
function guardianCookie(app, claims = {}) { return `nb_session=${app.jwt.sign({ sub: guardianId, role: 'guardian', ...claims })}`; }

test('schema BLE aceita limites inteiros e rejeita valores extras ou fora do protocolo', () => {
  const reading = { readingId: sessionId, bpm: 25, signalQuality: 0, measuredAt: '2026-10-09T15:00:00.000Z' };
  assert.equal(readingSchema.safeParse(reading).success, true);
  assert.equal(readingSchema.safeParse({ ...reading, bpm: 250, signalQuality: 100 }).success, true);
  for (const invalid of [
    { ...reading, bpm: 24 }, { ...reading, bpm: 251 }, { ...reading, bpm: 80.5 }, { ...reading, bpm: NaN }, { ...reading, bpm: Infinity },
    { ...reading, signalQuality: -1 }, { ...reading, signalQuality: 101 }, { ...reading, signalQuality: 2.5 },
    { ...reading, readingId: 'bad-id' }, { ...reading, measuredAt: 'bad-date' }, { ...reading, childId },
  ]) assert.equal(readingSchema.safeParse(invalid).success, false);
  assert.equal(batchSchema.safeParse({ sessionId, readings: [reading] }).success, true);
  assert.equal(batchSchema.safeParse({ sessionId, readings: Array.from({ length: 20 }, () => reading) }).success, true);
  assert.equal(batchSchema.safeParse({ sessionId, readings: [] }).success, false);
  assert.equal(batchSchema.safeParse({ sessionId, readings: Array.from({ length: 21 }, () => reading) }).success, false);
  assert.equal(batchSchema.safeParse({ sessionId, readings: [reading], childId }).success, false);
});
test('cadastro BLE normaliza metadados e aceita chave de conexão sem confiar nela como autenticação', () => {
  const valid = { deviceId: '  fixture  ', deviceName: '  NeuroBand  ', connectionId: sessionId };
  assert.deepEqual(registrationSchema.parse(valid), { deviceId: 'fixture', deviceName: 'NeuroBand', connectionId: sessionId });
  assert.equal(registrationSchema.safeParse({ deviceId: 'a'.repeat(512), deviceName: 'b'.repeat(80) }).success, true);
  for (const invalid of [
    { ...valid, deviceId: '' }, { ...valid, deviceId: 'a'.repeat(513) }, { ...valid, deviceName: '' },
    { ...valid, deviceName: 'b'.repeat(81) }, { ...valid, connectionId: 'bad-id' }, { ...valid, childId },
  ]) assert.equal(registrationSchema.safeParse(invalid).success, false);
});
test('janela de telemetria admite cinco minutos passados e trinta segundos futuros', () => {
  const now = Date.parse('2026-10-09T15:00:00.000Z');
  assert.equal(isReadingTimeValid(new Date(now - 300000).toISOString(), now), true);
  assert.equal(isReadingTimeValid(new Date(now + 30000).toISOString(), now), true);
  assert.equal(isReadingTimeValid(new Date(now - 300001).toISOString(), now), false);
  assert.equal(isReadingTimeValid(new Date(now + 30001).toISOString(), now), false);
  assert.equal(isReadingTimeValid('bad-date', now), false);
});

test('todas as rotas BLE exigem o cookie do responsável antes de acessar o banco', async t => {
  const app = await setup(t);
  const childCookie = `nb_kid_session=${app.jwt.sign({ sub: childId, guardianId, role: 'child' })}`;
  for (const [method, path, payload] of [
    ['POST', '/ble/sessions', { deviceId: 'fixture', deviceName: 'NeuroBand' }],
    ['GET', '/ble/status'],
    ['POST', `/ble/sessions/${sessionId}/heartbeat`, {}],
    ['POST', `/ble/sessions/${sessionId}/end`, {}],
    ['POST', '/vitals/ble', { sessionId, readings: [] }],
  ]) {
    for (const cookie of ['', childCookie, 'nb_session=invalid']) {
      const response = await app.inject({ method, url: `/api/children/${childId}${path}`, payload, headers: { cookie } });
      assert.equal(response.statusCode, 401, `${method} ${path}: ${response.body}`);
    }
  }
});
test('BLE bloqueia papel adulterado, sessão expirada e origem externa', async t => {
  const app = await setup(t);
  const url = `/api/children/${childId}/ble/sessions`;
  const payload = { deviceId: 'fixture', deviceName: 'NeuroBand' };
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { cookie: guardianCookie(app, { role: 'child' }) } })).statusCode, 403);
  const expired = `nb_session=${app.jwt.sign({ sub: guardianId, role: 'guardian' }, { expiresIn: -1 })}`;
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { cookie: expired } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { cookie: guardianCookie(app), origin: 'https://attacker.example' } })).statusCode, 403);
});
test('payloads BLE malformados são rejeitados sem escrever dados', async t => {
  let writes = 0;
  const app = await setup(t, async sql => {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes += 1;
    if (sql.includes('FROM children')) return { rows: [{ id: childId, display_name: 'Criança fictícia' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const headers = { cookie: guardianCookie(app), origin: 'http://localhost:5500' };
  for (const payload of [{}, { deviceId: '' }, { deviceId: 5 }, { deviceId: 'fixture', connectionId: 'bad-id' }]) {
    const response = await app.inject({ method: 'POST', url: `/api/children/${childId}/ble/sessions`, headers, payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  for (const payload of [
    {}, { sessionId: 'bad-id', readings: [] }, { sessionId, readings: [] },
    { bpm: 24, signalQuality: 90, measuredAt: new Date().toISOString() },
    { bpm: 80, signalQuality: 100.1, measuredAt: new Date().toISOString() },
    { bpm: 80, signalQuality: 90, measuredAt: 'bad-date' },
  ]) {
    const response = await app.inject({ method: 'POST', url: `/api/children/${childId}/vitals/ble`, headers, payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(writes, 0);
});
