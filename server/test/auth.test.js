import test from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const guardianId = '00000000-0000-4000-8000-000000000001';
const childId = '00000000-0000-4000-8000-000000000002';
const env = { DATABASE_URL: 'postgres://test@127.0.0.1/test', JWT_SECRET: 'test-secret-only-never-used-in-production-123456', FRONTEND_ORIGIN: 'http://localhost:5500' };
const config = readConfig(env);
const guardian = { id: guardianId, name: 'Responsável Teste', email: 'teste@example.com' };
const child = { id: childId, guardian_id: guardianId, display_name: 'Criança Teste' };
const passwordHash = await argon2.hash('senha-ficticia-123');
const pinHash = await argon2.hash('abc123');
function fakePool(query = async sql => {
  if (sql.includes('FROM guardians WHERE email')) return { rows: [{ ...guardian, password_hash: passwordHash }], rowCount: 1 };
  if (sql.includes('FROM guardians WHERE id')) return { rows: [guardian], rowCount: 1 };
  if (sql.includes('kid_pin_hash FROM children')) return { rows: [{ ...child, kid_pin_hash: pinHash }], rowCount: 1 };
  if (sql.includes('FROM children WHERE id')) return { rows: [child], rowCount: 1 };
  if (sql.includes('FROM children WHERE guardian_id')) return { rows: [child], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}) { return { query }; }
async function setup(t, pool = fakePool(), chosenConfig = config) {
  const app = await buildApp({ config: chosenConfig, pool, logger: false });
  t.after(() => app.close());
  await app.ready();
  return app;
}
function guardianCookie(app, claims = {}) { return `nb_session=${app.jwt.sign({ sub: guardianId, role: 'guardian', ...claims })}`; }
function childCookie(app, claims = {}) { return `nb_kid_session=${app.jwt.sign({ sub: childId, guardianId, role: 'child', ...claims })}`; }

test('login normaliza e-mail, emite cookie HTTP-only e omite hash/senha', async t => {
  let suppliedEmail;
  const pool = fakePool(async (sql, values) => {
    suppliedEmail = values[0];
    return { rows: [{ ...guardian, password_hash: passwordHash }], rowCount: 1 };
  });
  const app = await setup(t, pool);
  const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: '  TESTE@EXAMPLE.COM  ', password: 'senha-ficticia-123' } });
  assert.equal(result.statusCode, 200);
  assert.equal(suppliedEmail, 'teste@example.com');
  assert.deepEqual(result.json(), { guardian });
  assert.match(result.headers['set-cookie'], /nb_session=.*HttpOnly; SameSite=Lax/);
  assert.match(result.headers['set-cookie'], /Max-Age=1200/);
});
test('login rejeita senha incorreta sem revelar existência da conta', async t => {
  const app = await setup(t);
  const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: guardian.email, password: 'senha-incorreta' } });
  assert.equal(result.statusCode, 401);
  assert.equal(result.json().error, 'E-mail ou senha inválidos');
  assert.equal(result.headers['set-cookie'], undefined);
});
test('cookie infantil autentica a criança quando ambos os cookies existem', async t => {
  const app = await setup(t);
  const result = await app.inject({ url: '/api/children/me', headers: { cookie: `${guardianCookie(app)}; ${childCookie(app)}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), { child: { id: childId, name: child.display_name } });
});
test('sessões de responsável e criança são isoladas por cookie e papel', async t => {
  const app = await setup(t);
  assert.equal((await app.inject({ url: '/api/family', headers: { cookie: childCookie(app) } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/children/me', headers: { cookie: guardianCookie(app) } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/family', headers: { cookie: guardianCookie(app, { role: 'child' }) } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/children/me', headers: { cookie: childCookie(app, { role: 'guardian' }) } })).statusCode, 403);
});
test('sessões ausentes, adulteradas, expiradas e de perfil removido são rejeitadas', async t => {
  const app = await setup(t, fakePool(async () => ({ rows: [], rowCount: 0 })));
  assert.equal((await app.inject('/api/family')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/family', headers: { cookie: 'nb_session=broken' } })).statusCode, 401);
  const expired = app.jwt.sign({ sub: guardianId, role: 'guardian' }, { expiresIn: -10 });
  assert.equal((await app.inject({ url: '/api/family', headers: { cookie: `nb_session=${expired}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/family', headers: { cookie: guardianCookie(app) } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/children/me', headers: { cookie: childCookie(app) } })).statusCode, 401);
});
test('PIN infantil válido cria cookie próprio; ID inválido não chega ao banco', async t => {
  const app = await setup(t);
  const result = await app.inject({ method: 'POST', url: `/api/children/${childId}/kid-login`, payload: { pin: 'abc123' } });
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['set-cookie'], /nb_kid_session=.*Max-Age=1800.*HttpOnly/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/children/not-a-uuid/kid-login', payload: { pin: 'abc123' } })).statusCode, 400);
});
test('logout limpa o cookie certo com os atributos de produção', async t => {
  const production = readConfig({ ...env, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://neurobloom.example', SESSION_COOKIE_SAME_SITE: 'none' });
  const app = await setup(t, fakePool(), production);
  const guardianLogout = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  const childLogout = await app.inject({ method: 'POST', url: '/api/children/logout' });
  assert.match(guardianLogout.headers['set-cookie'], /^nb_session=;/);
  assert.match(childLogout.headers['set-cookie'], /^nb_kid_session=;/);
  assert.match(guardianLogout.headers['set-cookie'], /HttpOnly; Secure; SameSite=None/);
});
test('CORS aceita frontend configurado e bloqueia mutações de outra origem', async t => {
  const app = await setup(t);
  const allowed = await app.inject({ method: 'OPTIONS', url: '/api/auth/login', headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'POST' } });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5500');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  const denied = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://attacker.example' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.headers['set-cookie'], undefined);
});
test('health falha com HTTP 503 quando o banco ou schema não está disponível', async t => {
  const app = await setup(t, fakePool(async () => { throw Object.assign(new Error('unavailable'), { code: '42P01' }); }));
  const result = await app.inject('/api/health');
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().ok, false);
  assert.equal(result.json().database, 'unavailable');
});
test('erro de conexão no login é comunicado como indisponibilidade', async t => {
  const app = await setup(t, fakePool(async () => { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); }));
  const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: guardian.email, password: 'senha-ficticia-123' } });
  assert.equal(result.statusCode, 503);
  assert.ok(!result.body.includes('ECONNREFUSED'));
});
test('JSON malformado, payload excessivo e rate limit preservam códigos HTTP', async t => {
  const app = await setup(t);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{broken' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x'.repeat(33000) } })).statusCode, 413);
  const responses = [];
  for (let i = 0; i < 11; i++) responses.push(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'invalid' } }));
  assert.equal(responses.at(-1).statusCode, 429);
  assert.ok(Number(responses.at(-1).headers['retry-after']) > 0);
});
test('configuração de produção exige banco, segredo forte e origem HTTPS', () => {
  assert.throws(() => readConfig({ ...env, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => readConfig({ ...env, DATABASE_URL: '' }), /DATABASE_URL/);
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, FRONTEND_ORIGIN: 'http://localhost:5500/path' }), /origens/);
  assert.throws(() => readConfig({ ...env, SESSION_COOKIE_SAME_SITE: 'none' }), /HTTPS/);
});
test('fechar a aplicação encerra o listener e o pool que ela criou', async () => {
  const app = await buildApp({ config, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  assert.ok(app.server.listening);
  await app.close();
  assert.equal(app.server.listening, false);
});
