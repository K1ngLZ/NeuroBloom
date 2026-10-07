import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let localDatabase = false;
try { localDatabase = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname); } catch {}

test('fluxo de autenticação com PostgreSQL em schema temporário exclusivo', { skip: !localDatabase && 'Configure um PostgreSQL local; testes nunca alteram banco remoto.' }, async t => {
  const schema = `nb_test_${crypto.randomBytes(10).toString('hex')}`;
  if (!/^nb_test_[a-f0-9]{20}$/.test(schema)) throw new Error('Nome de schema de teste inválido.');
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
  const apps = [];
  let schemaCreated = false;
  t.after(async () => {
    for (const app of apps) await app.close();
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const sql = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await pool.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  const config = readConfig({ DATABASE_URL: databaseUrl, JWT_SECRET: crypto.randomBytes(32).toString('hex'), FRONTEND_ORIGIN: 'http://localhost:5500' });
  async function newApp() {
    const app = await buildApp({ config, pool, logger: false });
    apps.push(app);
    await app.ready();
    return app;
  }
  let app = await newApp();
  const payload = { guardianName: 'Família fictícia', email: '  CONTINUIDADE@EXAMPLE.COM  ', password: 'senha-ficticia-123', childName: 'Criança fictícia', birthYear: 2018, kidPin: 'abc123', consent: true };
  let guardianCookie, childCookie, guardianId, childId;

  await t.test('cadastro persiste família com hashes e consentimento', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/signup', payload });
    assert.equal(result.statusCode, 201, result.body);
    guardianCookie = result.headers['set-cookie'].split(';')[0];
    guardianId = result.json().guardian.id;
    childId = result.json().child.id;
    assert.equal(result.json().guardian.email, 'continuidade@example.com');
    assert.equal(result.json().child.kidUrl, `http://localhost:5500/#child=${childId}`);
    const guardians = await pool.query('SELECT * FROM guardians WHERE id=$1', [guardianId]);
    const children = await pool.query('SELECT * FROM children WHERE id=$1', [childId]);
    assert.notEqual(guardians.rows[0].password_hash, payload.password);
    assert.ok(await argon2.verify(guardians.rows[0].password_hash, payload.password));
    assert.ok(await argon2.verify(children.rows[0].kid_pin_hash, payload.kidPin));
    assert.ok(guardians.rows[0].consent_at);
    assert.equal(children.rows[0].guardian_id, guardianId);
    assert.equal(children.rows[0].birth_year, 2018);
  });
  await t.test('e-mail duplicado após normalização recebe conflito e não cria outra criança', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { ...payload, email: 'Continuidade@example.com' } });
    assert.equal(result.statusCode, 409);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM children')).rows[0].count, 1);
  });
  await t.test('cadastro rejeita consentimento ausente e senhas curtas', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { ...payload, email: 'invalid@example.com', consent: false, password: 'short' } });
    assert.equal(result.statusCode, 400);
    assert.ok(result.json().details.fieldErrors.consent);
    assert.ok(result.json().details.fieldErrors.password);
  });
  await t.test('sessão de responsável lê apenas dados públicos da própria família', async () => {
    const result = await app.inject({ url: '/api/family', headers: { cookie: guardianCookie } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().children[0].display_name, payload.childName);
    assert.equal(result.json().guardian.id, guardianId);
    assert.ok(!result.body.includes('password_hash'));
    assert.ok(!result.body.includes('kid_pin_hash'));
  });
  await t.test('login recupera conta persistida em outra instância da API', async () => {
    await app.close();
    app = await newApp();
    const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: '  Continuidade@example.com ', password: payload.password } });
    assert.equal(result.statusCode, 200);
    guardianCookie = result.headers['set-cookie'].split(';')[0];
    assert.equal(result.json().guardian.id, guardianId);
    assert.equal((await app.inject({ url: '/api/family', headers: { cookie: guardianCookie } })).statusCode, 200);
  });
  await t.test('PIN incorreto falha e PIN correto autentica a sessão infantil separadamente', async () => {
    const wrong = await app.inject({ method: 'POST', url: `/api/children/${childId}/kid-login`, payload: { pin: 'wrong-pin' } });
    assert.equal(wrong.statusCode, 401);
    const result = await app.inject({ method: 'POST', url: `/api/children/${childId}/kid-login`, payload: { pin: payload.kidPin } });
    assert.equal(result.statusCode, 200);
    childCookie = result.headers['set-cookie'].split(';')[0];
    const me = await app.inject({ url: '/api/children/me', headers: { cookie: `${guardianCookie}; ${childCookie}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().child.id, childId);
    assert.equal((await app.inject({ url: '/api/family', headers: { cookie: childCookie } })).statusCode, 401);
  });
  await t.test('falha ao inserir criança desfaz responsável na mesma transação', async () => {
    await pool.query("ALTER TABLE children ADD CONSTRAINT test_rollback CHECK (display_name <> 'Rollback trigger')");
    const result = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { ...payload, email: 'rollback@example.com', childName: 'Rollback trigger' } });
    assert.equal(result.statusCode, 500);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM guardians WHERE email='rollback@example.com'")).rows[0].count, 0);
  });
  await t.test('saúde confirma schema pronto; contas removidas invalidam leitura da sessão', async () => {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    await pool.query('DELETE FROM guardians WHERE id=$1', [guardianId]);
    assert.equal((await app.inject({ url: '/api/family', headers: { cookie: guardianCookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/children/me', headers: { cookie: childCookie } })).statusCode, 401);
  });
});
