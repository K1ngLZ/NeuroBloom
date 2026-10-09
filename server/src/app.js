import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import pg from 'pg';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { databaseOptions, readConfig } from './config.js';
import { registerGameSessions } from './game-sessions.js';

const { Pool } = pg;
export async function buildApp(options = {}) {
const config = options.config || readConfig(options.env);
const app = Fastify({
  logger: options.logger ?? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-device-secret"]'] },
  bodyLimit: 32 * 1024,
  trustProxy: config.trustProxy || false,
});
const pool = options.pool || new Pool(databaseOptions(config));
if (!options.pool) {
  pool.on('error', error => app.log.error({ code: error.code }, 'Conexão ociosa com o banco interrompida.'));
  app.addHook('onClose', async () => pool.end());
}
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.frontendOrigins, credentials: true });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(cookie);
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '20m' } });
const mailer = options.mailer ?? (config.smtpHost ? nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,auth:{user:config.smtpUser,pass:config.smtpPass}}) : null);
// Browser writes require an allowed origin, including when SameSite=None is configured.
app.addHook('onRequest', async (req, reply) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && !config.frontendOrigins.includes(req.headers.origin)) {
    return reply.code(403).send({ error: 'Origem não autorizada' });
  }
});
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: config.cookieSameSite, path: '/' };
const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const uuidSchema = z.string().uuid();
const emailSchema=z.string().trim().toLowerCase().email().max(254);const passwordSchema=z.string().min(12).max(128);const nameSchema=z.string().trim().min(2).max(80);
function hashToken(s){return crypto.createHash('sha256').update(s).digest('hex')}
function authenticate(cookieName, role, invalidMessage) {
  return async (req, reply) => {
    let user;
    try { user = app.jwt.verify(req.cookies[cookieName]); }
    catch { return reply.code(401).send({ error: invalidMessage }); }
    if (user.role !== role) return reply.code(403).send({ error: 'Perfil sem permissão para este acesso' });
    if (!uuidSchema.safeParse(user.sub).success || (role === 'child' && !uuidSchema.safeParse(user.guardianId).success)) {
      return reply.code(401).send({ error: invalidMessage });
    }
    req.user = user;
  };
}
const guardian = authenticate('nb_session', 'guardian', 'Sessão inválida ou expirada');
const childAuth = authenticate('nb_kid_session', 'child', 'Sessão infantil inválida ou expirada');
registerGameSessions(app, pool, childAuth);
const gameIds = new Set(['platform', 'speed', 'ninja', 'sword', 'energy']);
function validProgress(value, depth = 0) {
  if (depth > 6) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && validProgress(item, depth + 1));
}
app.get('/api/children/me/game-progress', { preHandler: childAuth }, async req => {
  const result = await pool.query('SELECT game_id, progress FROM game_progress WHERE child_id=$1', [req.user.sub]);
  return { progress: Object.fromEntries(result.rows.map(row => [row.game_id, row.progress])) };
});
app.put('/api/children/me/game-progress/:gameId', { preHandler: childAuth }, async (req, reply) => {
  if (!gameIds.has(req.params.gameId)) return reply.code(400).send({ error: 'Jogo inválido' });
  const progress = req.body?.progress;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress) || !validProgress(progress)) {
    return reply.code(400).send({ error: 'Progresso inválido' });
  }
  const serialized = JSON.stringify(progress);
  if (Buffer.byteLength(serialized, 'utf8') > 8192) return reply.code(413).send({ error: 'Progresso excede 8 KB' });
  await pool.query('INSERT INTO game_progress(child_id,game_id,progress) VALUES($1,$2,$3::jsonb) ON CONFLICT(child_id,game_id) DO UPDATE SET progress=EXCLUDED.progress,updated_at=now()', [req.user.sub, req.params.gameId, serialized]);
  return { ok: true };
});
async function ownedChild(guardianId,childId){if(!uuidSchema.safeParse(childId).success)return null;const r=await pool.query('SELECT id,display_name FROM children WHERE id=$1 AND guardian_id=$2',[childId,guardianId]);return r.rows[0]}
app.get('/api/health', async (_, reply) => {
  try {
    // Readiness requires the connection and the tables used by login and signup.
    await pool.query('SELECT 1 FROM guardians, children, subscriptions LIMIT 0');
    return { ok: true, service: 'NeuroBloom API', time: new Date().toISOString(), database: 'connected' };
  } catch {
    return reply.code(503).send({ ok: false, service: 'NeuroBloom API', time: new Date().toISOString(), database: 'unavailable' });
  }
});
function session(reply, name, claims, maxAge) {
  const token = app.jwt.sign(claims, { expiresIn: `${maxAge}s` });
  reply.setCookie(name, token, { ...cookieOptions, maxAge });
}
app.post('/api/auth/signup', { config: authLimit }, async (req, reply) => {
  const schema = z.object({ guardianName: nameSchema, email: emailSchema, password: passwordSchema, childName: nameSchema,
    birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(), kidPin: z.string().min(6).max(32), consent: z.literal(true) });
  const validated = schema.safeParse(req.body);
  if (!validated.success) return reply.code(400).send({ error: 'Dados inválidos', details: validated.error.flatten() });
  const data = validated.data;
  const passwordHash = await argon2.hash(data.password);
  const pinHash = await argon2.hash(data.kidPin);
  const client = await pool.connect();
  let guardianRow, childRow;
  try {
    await client.query('BEGIN');
    guardianRow = (await client.query('INSERT INTO guardians(name,email,password_hash,consent_at) VALUES($1,$2,$3,now()) RETURNING id,name,email',
      [data.guardianName, data.email, passwordHash])).rows[0];
    childRow = (await client.query('INSERT INTO children(guardian_id,display_name,birth_year,kid_pin_hash) VALUES($1,$2,$3,$4) RETURNING id,display_name',
      [guardianRow.id, data.childName, data.birthYear ?? null, pinHash])).rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return reply.code(409).send({ error: 'E-mail já cadastrado' });
    throw error;
  } finally { client.release(); }
  session(reply, 'nb_session', { sub: guardianRow.id, role: 'guardian' }, 1200);
  return reply.code(201).send({ guardian: guardianRow,
    child: { id: childRow.id, name: childRow.display_name, kidUrl: `${config.frontendOrigins[0]}/#child=${childRow.id}` },
    message: 'Conta criada com sucesso.' });
});
app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
  const validated = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!validated.success) return reply.code(400).send({ error: 'Dados inválidos', details: validated.error.flatten() });
  const result = await pool.query('SELECT id,name,email,password_hash FROM guardians WHERE email=$1', [validated.data.email]);
  if (!result.rowCount || !(await argon2.verify(result.rows[0].password_hash, validated.data.password))) {
    return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
  }
  const row = result.rows[0];
  session(reply, 'nb_session', { sub: row.id, role: 'guardian' }, 1200);
  return { guardian: { id: row.id, name: row.name, email: row.email } };
});
app.post('/api/auth/logout', async (_, reply) => reply.clearCookie('nb_session', cookieOptions).send({ ok: true }));
app.get('/api/family', { preHandler: guardian }, async (req, reply) => {
  const guardianResult = await pool.query('SELECT id,name,email,created_at FROM guardians WHERE id=$1', [req.user.sub]);
  if (!guardianResult.rowCount) return reply.code(401).send({ error: 'Sessão inválida ou expirada' });
  const children = await pool.query('SELECT id,display_name,birth_year,created_at FROM children WHERE guardian_id=$1', [req.user.sub]);
  const subscription = await pool.query('SELECT status,amount_cents,created_at FROM subscriptions WHERE guardian_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.sub]);
  return { guardian: guardianResult.rows[0], children: children.rows, subscription: subscription.rows[0] || { status: 'inactive', amount_cents: 3999 } };
});
app.post('/api/children/:id/kid-login', { config: authLimit }, async (req, reply) => {
  const validated = z.object({ pin: z.string().min(1).max(32) }).safeParse(req.body);
  if (!validated.success || !uuidSchema.safeParse(req.params.id).success) return reply.code(400).send({ error: 'Perfil ou PIN inválido' });
  const result = await pool.query('SELECT id,guardian_id,display_name,kid_pin_hash FROM children WHERE id=$1', [req.params.id]);
  if (!result.rowCount || !(await argon2.verify(result.rows[0].kid_pin_hash, validated.data.pin))) {
    return reply.code(401).send({ error: 'Código infantil inválido' });
  }
  const child = result.rows[0];
  session(reply, 'nb_kid_session', { sub: child.id, guardianId: child.guardian_id, role: 'child' }, 1800);
  return { child: { id: child.id, name: child.display_name }, message: 'Sessão infantil iniciada' };
});
app.get('/api/children/me', { preHandler: childAuth }, async (req, reply) => {
  const result = await pool.query('SELECT id,display_name FROM children WHERE id=$1 AND guardian_id=$2', [req.user.sub, req.user.guardianId]);
  if (!result.rowCount) return reply.code(401).send({ error: 'Sessão infantil inválida ou expirada' });
  return { child: { id: result.rows[0].id, name: result.rows[0].display_name } };
});
app.post('/api/children/me/refresh', { preHandler: childAuth, config: authLimit }, async (req, reply) => {
  const result = await pool.query('SELECT id FROM children WHERE id=$1 AND guardian_id=$2', [req.user.sub, req.user.guardianId]);
  if (!result.rowCount) return reply.code(401).send({ error: 'Sessão infantil inválida ou expirada' });
  session(reply, 'nb_kid_session', { sub: req.user.sub, guardianId: req.user.guardianId, role: 'child' }, 1800);
  return { ok: true };
});
app.post('/api/children/logout', async (_, reply) => reply.clearCookie('nb_kid_session', cookieOptions).send({ ok: true }));
app.get('/api/children/:id/vitals/latest',{preHandler:guardian},async(req,reply)=>{if(!await ownedChild(req.user.sub,req.params.id))return reply.code(404).send({error:'Perfil não encontrado'});const r=await pool.query('SELECT bpm,signal_quality,measured_at,received_at FROM vitals WHERE child_id=$1 ORDER BY measured_at DESC LIMIT 1',[req.params.id]);return {reading:r.rows[0]||null,notice:'Leitura de sensor não é diagnóstico nem substitui orientação médica.'}});
app.get('/api/children/:id/vitals',{preHandler:guardian},async(req,reply)=>{if(!await ownedChild(req.user.sub,req.params.id))return reply.code(404).send({error:'Perfil não encontrado'});const limit=z.coerce.number().int().min(1).max(500).safeParse(req.query.limit??100);if(!limit.success)return reply.code(400).send({error:'Limite inválido; use um inteiro entre 1 e 500'});const r=await pool.query('SELECT bpm,signal_quality,measured_at FROM vitals WHERE child_id=$1 ORDER BY measured_at DESC LIMIT $2',[req.params.id,limit.data]);return {readings:r.rows}});
app.post('/api/children/:id/vitals/ble',{preHandler:guardian},async(req,reply)=>{if(!await ownedChild(req.user.sub,req.params.id))return reply.code(404).send({error:'Perfil não encontrado'});const v=z.object({bpm:z.number().int().min(25).max(250),signalQuality:z.number().int().min(0).max(100),measuredAt:z.string().datetime()}).safeParse(req.body);if(!v.success)return reply.code(400).send({error:'Leitura BLE inválida'});await pool.query('INSERT INTO vitals(child_id,bpm,signal_quality,measured_at) VALUES($1,$2,$3,$4)',[req.params.id,v.data.bpm,v.data.signalQuality,v.data.measuredAt]);return reply.code(202).send({accepted:true})});
app.post('/api/device/reading',async(req,reply)=>{const secret=String(req.headers['x-device-secret']||'');const v=z.object({deviceId:z.string().uuid(),bpm:z.number().int().min(25).max(250),signalQuality:z.number().int().min(0).max(100),measuredAt:z.string().datetime()}).safeParse(req.body);if(!v.success)return reply.code(400).send({error:'Leitura inválida',details:v.error.flatten()});if(secret.length<32)return reply.code(401).send({error:'Dispositivo não autenticado'});const d=await pool.query('SELECT child_id,device_key_hash FROM devices WHERE id=$1',[v.data.deviceId]);if(!d.rowCount||!crypto.timingSafeEqual(Buffer.from(hashToken(secret),'hex'),Buffer.from(d.rows[0].device_key_hash,'hex')))return reply.code(401).send({error:'Dispositivo não autenticado'});await pool.query('INSERT INTO vitals(child_id,bpm,signal_quality,measured_at) VALUES($1,$2,$3,$4)',[d.rows[0].child_id,v.data.bpm,v.data.signalQuality,v.data.measuredAt]);await pool.query('UPDATE devices SET last_seen=now() WHERE id=$1',[v.data.deviceId]);return reply.code(202).send({accepted:true})});
app.post('/api/children/:id/device-enrollment', {preHandler:guardian},async(req,reply)=>{if(!await ownedChild(req.user.sub,req.params.id))return reply.code(404).send({error:'Perfil não encontrado'});const key=crypto.randomBytes(32).toString('hex');const r=await pool.query('INSERT INTO devices(child_id,device_key_hash) VALUES($1,$2) RETURNING id,label',[req.params.id,hashToken(key)]);return reply.code(201).send({device:r.rows[0],deviceSecret:key,warning:'Copie agora; segredo exibido uma única vez. Para produção, implemente rotação e autenticação por dispositivo.'})});
app.post('/api/alerts/test-email',{preHandler:guardian},async(req,reply)=>{if(!mailer)return reply.code(503).send({error:'SMTP ainda não configurado no servidor'});const r=await pool.query('SELECT email,name FROM guardians WHERE id=$1',[req.user.sub]);if(!r.rowCount)return reply.code(401).send({error:'Sessão inválida ou expirada'});await mailer.sendMail({from:config.mailFrom,to:r.rows[0].email,subject:'NeuroBloom — teste de notificação',text:`Olá ${r.rows[0].name}, este é um e-mail de teste do NeuroBloom. Não é um alerta médico nem indica leitura real.`});return {sent:true}});
app.post('/api/billing/checkout', {preHandler:guardian},async(_,reply)=>reply.code(501).send({error:'Checkout PagBank ainda não conectado. Não envie cobrança: configurar credenciais e fluxo oficial do provedor é necessário.'}));
app.post('/api/webhooks/pagbank',async(req,reply)=>{req.log.warn('Webhook PagBank recebido mas validação de assinatura ainda não implementada; ignorado.');return reply.code(501).send({error:'Webhook não habilitado até validação criptográfica e idempotência'})});
app.setErrorHandler((error, req, reply) => {
  if (error.statusCode >= 400 && error.statusCode < 500) {
    const messages = { 400: 'Requisição inválida', 413: 'Requisição muito grande', 415: 'Formato de requisição não suportado', 429: 'Muitas tentativas. Aguarde um minuto e tente novamente.' };
    return reply.code(error.statusCode).send({ error: messages[error.statusCode] || 'Requisição não permitida' });
  }
  req.log.error({ code: error.code }, 'Falha interna ao processar requisição.');
  const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P02', '57P03', '53300'].includes(error.code)
    || /timeout|connection terminated/i.test(error.message);
  return reply.code(unavailable ? 503 : 500).send({ error: unavailable ? 'Serviço temporariamente indisponível. Tente novamente em instantes.' : 'Não foi possível concluir a operação' });
});
return app;
}
