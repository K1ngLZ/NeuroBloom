import { z } from 'zod';

export const nicknameSchema = z.string().trim().transform(value => value.normalize('NFC')).refine(value => {
  const length = [...value].length;
  return length >= 3 && length <= 20 && /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u.test(value);
}, 'Use de 3 a 20 letras, números, _ ou -, com espaços simples.');
const startSchema = z.object({ gameId: z.enum(['platform','speed','ninja','sword','energy']) }).strict();
export const endSchema = z.object({
  status: z.enum(['completed','ended']),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  score: z.number().int().min(0).max(100000000).optional(),
  level: z.number().int().min(0).max(9999).optional(),
  stars: z.number().int().min(0).max(3).optional(),
}).strict();
const sessionView = row => ({ id:row.id, gameId:row.game_id, nickname:row.nickname, status:row.status, startedAt:row.started_at,
  endedAt:row.ended_at, durationSeconds:row.duration_seconds, score:row.score, level:row.level, stars:row.stars });

export function registerGameSessions(app, pool, childAuth) {
  async function existingChild(req, reply) {
    const result = await pool.query('SELECT game_nickname FROM children WHERE id=$1 AND guardian_id=$2', [req.user.sub, req.user.guardianId]);
    if (!result.rowCount) return reply.code(401).send({error:'Sessão infantil inválida ou expirada'});
    req.gameProfile = result.rows[0];
  }
  const access = { preHandler:[childAuth, existingChild] };
  const writes = { ...access, config:{rateLimit:{max:30,timeWindow:'1 minute'}} };
  app.get('/api/children/me/game-profile', access, async req => ({nickname:req.gameProfile.game_nickname,canEdit:true}));
  app.patch('/api/children/me/game-profile', writes, async (req,reply) => {
    const parsed = z.object({nickname:nicknameSchema}).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:'Apelido inválido: use de 3 a 20 letras, números, _ ou -, com espaços simples.'});
    await pool.query('UPDATE children SET game_nickname=$1 WHERE id=$2 AND guardian_id=$3', [parsed.data.nickname,req.user.sub,req.user.guardianId]);
    return {nickname:parsed.data.nickname,canEdit:true};
  });
  app.get('/api/children/me/game-sessions', access, async req => {
    const result = await pool.query('SELECT * FROM game_sessions WHERE child_id=$1 ORDER BY started_at DESC,id DESC LIMIT 12', [req.user.sub]);
    return {sessions:result.rows.map(sessionView)};
  });
  app.post('/api/children/me/game-sessions', writes, async (req,reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:'Jogo inválido'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize starts per child so concurrent tabs cannot create unlimited active sessions.
      const child = await client.query('SELECT id FROM children WHERE id=$1 AND guardian_id=$2 FOR UPDATE', [req.user.sub,req.user.guardianId]);
      if (!child.rowCount) { await client.query('ROLLBACK'); return reply.code(401).send({error:'Sessão infantil inválida ou expirada'}); }
      await client.query("UPDATE game_sessions SET status='ended',ended_at=now(),duration_seconds=LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM now()-started_at)::int)) WHERE child_id=$1 AND status='started'", [req.user.sub]);
      const result = await client.query('INSERT INTO game_sessions(child_id,game_id,nickname) SELECT id,$2,game_nickname FROM children WHERE id=$1 RETURNING *', [req.user.sub,parsed.data.gameId]);
      await client.query('COMMIT');
      return reply.code(201).send({session:sessionView(result.rows[0])});
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  app.patch('/api/children/me/game-sessions/:id', writes, async (req,reply) => {
    const parsed = endSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) return reply.code(400).send({error:'Resumo de partida inválido'});
    const data = parsed.data;
    const result = await pool.query(`UPDATE game_sessions SET status=$3,ended_at=now(),
      duration_seconds=COALESCE($4,LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM now()-started_at)::int))),
      score=$5,level=$6,stars=$7 WHERE id=$1 AND child_id=$2 AND status='started' RETURNING *`,
      [req.params.id,req.user.sub,data.status,data.durationSeconds??null,data.score??null,data.level??null,data.stars??null]);
    // A completed session is immutable; retrying after a lost response returns the original result.
    const row = result.rows[0] || (await pool.query('SELECT * FROM game_sessions WHERE id=$1 AND child_id=$2',[req.params.id,req.user.sub])).rows[0];
    if (!row) return reply.code(404).send({error:'Partida não encontrada'});
    return {session:sessionView(row)};
  });
}
