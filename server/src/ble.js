import crypto from 'node:crypto';
import { z } from 'zod';

export const readingSchema = z.object({
  readingId: z.string().uuid(), bpm: z.number().int().min(25).max(250),
  signalQuality: z.number().int().min(0).max(100), measuredAt: z.string().datetime(),
}).strict();
export const batchSchema = z.object({ sessionId: z.string().uuid(), readings: z.array(readingSchema).min(1).max(20) }).strict();
export const registrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(512), deviceName: z.string().trim().min(1).max(80),
  connectionId: z.string().uuid().optional(),
}).strict();
const legacySchema = readingSchema.omit({ readingId: true }).extend({ readingId: z.string().uuid().optional() }).strict();
export function isReadingTimeValid(measuredAt, now = Date.now()) {
  const value = Date.parse(measuredAt);
  return Number.isFinite(value) && value >= now - 300000 && value <= now + 30000;
}
const sessionColumns = 'id,device_name,started_at,last_seen,last_packet_at,ended_at';
function publicSession(row) {
  if (!row) return null;
  const status = row.ended_at ? 'ended' : Date.now() - new Date(row.last_seen).getTime() > 65000 ? 'stale' : 'connected';
  return { id: row.id, deviceName: row.device_name, startedAt: row.started_at,
    lastSeen: row.last_seen, lastPacketAt: row.last_packet_at, endedAt: row.ended_at, status };
}
function expired(row) { return Date.now() - new Date(row.last_seen).getTime() > 300000; }

export function registerBle(app, pool, guardian, ownedChild) {
  const route = { preHandler: guardian, config: { rateLimit: {
    max: 90, timeWindow: '1 minute', keyGenerator: req => {
      try {
        const token = app.parseCookie(req.headers.cookie || '').nb_session;
        const user = app.jwt.verify(token);
        if (user.role === 'guardian' && z.string().uuid().safeParse(user.sub).success) return `ble:${user.sub}`;
      } catch { /* Unauthenticated traffic stays limited by its IP. */ }
      return req.ip;
    },
  } } };
  async function owner(req, reply) {
    if (!await ownedChild(req.user.sub, req.params.id)) {
      reply.code(404).send({ error: 'Perfil não encontrado' }); return false;
    }
    return true;
  }
  async function findSession(req, reply) {
    if (!z.string().uuid().safeParse(req.params.sessionId).success) {
      reply.code(404).send({ error: 'Conexão não encontrada' }); return null;
    }
    const result = await pool.query(`SELECT ${sessionColumns} FROM ble_sessions WHERE id=$1 AND child_id=$2`, [req.params.sessionId, req.params.id]);
    if (!result.rowCount) { reply.code(404).send({ error: 'Conexão não encontrada' }); return null; }
    return result.rows[0];
  }
  app.post('/api/children/:id/ble/sessions', route, async (req, reply) => {
    if (!await owner(req, reply)) return;
    const validated = registrationSchema.safeParse(req.body);
    if (!validated.success) return reply.code(400).send({ error: 'Identificação da conexão inválida' });
    const data = validated.data;
    // The browser ID is origin scoped metadata, not proof of hardware identity.
    const fingerprint = crypto.createHash('sha256').update(data.deviceId).digest('hex');
    const result = await pool.query(`INSERT INTO ble_sessions(child_id,client_connection_id,device_hash,device_name)
      VALUES($1,$2,$3,$4) ON CONFLICT(child_id,client_connection_id)
      DO UPDATE SET device_name=ble_sessions.device_name RETURNING ${sessionColumns}`,
    [req.params.id, data.connectionId || crypto.randomUUID(), fingerprint, data.deviceName]);
    if (result.rows[0].ended_at) return reply.code(409).send({ error: 'Esta conexão foi encerrada. Conecte a pulseira novamente.' });
    if (expired(result.rows[0])) return reply.code(410).send({ error: 'Esta conexão expirou. Conecte a pulseira novamente.' });
    return reply.code(201).send({ session: publicSession(result.rows[0]), protocol: {
      serviceUuid: '7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000', dataUuid: '7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000', packetBytes: 3,
    } });
  });
  app.get('/api/children/:id/ble/status', route, async (req, reply) => {
    if (!await owner(req, reply)) return;
    const result = await pool.query(`SELECT ${sessionColumns} FROM ble_sessions WHERE child_id=$1 ORDER BY started_at DESC LIMIT 1`, [req.params.id]);
    const session = publicSession(result.rows[0]);
    return { session, connected: session?.status === 'connected' };
  });
  app.post('/api/children/:id/ble/sessions/:sessionId/heartbeat', route, async (req, reply) => {
    if (!await owner(req, reply)) return;
    const session = await findSession(req, reply);
    if (!session) return;
    if (session.ended_at) return reply.code(409).send({ error: 'Conexão encerrada' });
    if (expired(session)) return reply.code(410).send({ error: 'Conexão expirada' });
    // The ended predicate prevents a late heartbeat from reopening a closed link.
    const result = await pool.query('UPDATE ble_sessions SET last_seen=now() WHERE id=$1 AND child_id=$2 AND ended_at IS NULL RETURNING id', [session.id, req.params.id]);
    if (!result.rowCount) return reply.code(409).send({ error: 'Conexão encerrada' });
    return { ok: true };
  });
  app.post('/api/children/:id/ble/sessions/:sessionId/end', route, async (req, reply) => {
    if (!await owner(req, reply)) return;
    const session = await findSession(req, reply);
    if (!session) return;
    await pool.query('UPDATE ble_sessions SET ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND child_id=$2', [session.id, req.params.id]);
    return { ok: true };
  });
  app.post('/api/children/:id/vitals/ble', route, async (req, reply) => {
    if (!await owner(req, reply)) return;
    const batch = batchSchema.safeParse(req.body);
    const legacy = batch.success ? null : legacySchema.safeParse(req.body);
    if (!batch.success && !legacy.success) return reply.code(400).send({ error: 'Leitura BLE inválida' });
    const readings = batch.success ? batch.data.readings : [legacy.data];
    const now = Date.now();
    if (readings.some(item => !isReadingTimeValid(item.measuredAt, now))) {
      return reply.code(400).send({ error: 'A leitura deve ter sido recebida nos últimos cinco minutos. Confira o relógio do aparelho.' });
    }
    // A transaction holds the connection row through insertion: end/ingest races
    // cannot write into a closed session, and partial batches never reach history.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sessionId = batch.success ? batch.data.sessionId : null;
      if (sessionId) {
        const result = await client.query('SELECT id,last_seen,ended_at FROM ble_sessions WHERE id=$1 AND child_id=$2 FOR UPDATE', [sessionId, req.params.id]);
        let code = 0, error;
        if (!result.rowCount) { code = 404; error = 'Conexão não encontrada'; }
        else if (result.rows[0].ended_at) { code = 409; error = 'Conexão encerrada'; }
        else if (expired(result.rows[0])) { code = 410; error = 'Conexão expirada'; }
        if (code) { await client.query('ROLLBACK'); return reply.code(code).send({ error }); }
      }
      let saved = 0;
      for (const item of readings) {
        const result = await client.query(`INSERT INTO vitals(child_id,bpm,signal_quality,measured_at,source,ble_session_id,client_reading_id)
          VALUES($1,$2,$3,$4,'ble',$5,$6) ON CONFLICT(child_id,client_reading_id) DO NOTHING RETURNING id`,
        [req.params.id, item.bpm, item.signalQuality, item.measuredAt, sessionId, item.readingId || null]);
        saved += result.rowCount;
      }
      if (sessionId) await client.query('UPDATE ble_sessions SET last_seen=now(),last_packet_at=now() WHERE id=$1', [sessionId]);
      await client.query('COMMIT');
      return reply.code(202).send({ accepted: true, saved, duplicates: readings.length - saved });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  });
}
