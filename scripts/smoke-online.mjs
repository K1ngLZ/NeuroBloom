import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates one fictional family to verify the real deployed authentication flow.
// Passwords, PINs and session cookies are kept in memory and are never logged.
export async function smokeOnline(baseUrl, { checkPages = true } = {}) {
  const origin = new URL(baseUrl).origin;
  assert.equal(new URL(baseUrl).protocol, 'https:', 'Use a URL HTTPS publicada.');
  const cookies = new Map();
  let guardianId, childId;
  const email = `smoke-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const pin = randomBytes(8).toString('hex');

  async function api(path, { method = 'GET', body, status = 200, jar = cookies } = {}) {
    const response = await fetch(origin + path, {
      method, signal: AbortSignal.timeout(30000),
      headers: {
        ...(checkPages ? { Origin: origin } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal(response.status, status, `${method} ${path}: status inesperado`);
    assert.match(response.headers.get('content-type') || '', /application\/json/, `${path}: resposta deve ser JSON`);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const key = pair.slice(0, index), value = pair.slice(index + 1);
      if (value) {
        assert.match(cookie, /HttpOnly/i, 'Sessão deve ser HttpOnly');
        assert.match(cookie, /Secure/i, 'Sessão publicada deve usar Secure');
        assert.match(cookie, /SameSite=Lax/i, 'Sessão deve usar SameSite=Lax');
        assert.doesNotMatch(cookie, /;\s*Domain=/i, 'Cookie deve ficar no domínio do frontend');
        jar.set(key, value);
      } else { jar.delete(key); }
    }
    return response.json();
  }

  const health = await api('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.database, 'connected');
  await api('/api/family', { status: 401 });
  const payload = { guardianName: 'Responsável Teste Online', email, password, childName: 'Perfil Fictício Online', kidPin: pin, consent: true };
  const signup = await api('/api/auth/signup', { method: 'POST', body: payload, status: 201 });
  guardianId = signup.guardian.id; childId = signup.child.id;
  assert.ok(cookies.has('nb_session'), 'Cadastro deve iniciar sessão do responsável');
  const family = await api('/api/family');
  assert.equal(family.guardian.id, guardianId);
  assert.equal(family.children[0].id, childId);
  assert.equal(family.children[0].display_name || family.children[0].name, payload.childName);
  await api(`/api/children/${childId}/vitals/latest`);
  await api(`/api/children/${childId}/vitals`);
  await api('/api/auth/signup', { method: 'POST', body: payload, status: 409 });
  await api('/api/auth/logout', { method: 'POST' });
  assert.ok(!cookies.has('nb_session'));
  await api('/api/family', { status: 401 });
  await api('/api/auth/login', { method: 'POST', body: { email, password: 'SenhaErradaSomenteTeste' }, status: 401 });
  await api('/api/auth/login', { method: 'POST', body: { email: ` ${email.toUpperCase()} `, password } });
  assert.equal((await api('/api/family')).guardian.id, guardianId);
  await api('/api/children/me', { status: 401 });
  await api(`/api/children/${childId}/kid-login`, { method: 'POST', body: { pin: 'errado' }, status: 401 });
  await api(`/api/children/${childId}/kid-login`, { method: 'POST', body: { pin } });
  assert.equal((await api('/api/children/me')).child.id, childId);
  const childOnly = new Map([['nb_kid_session', cookies.get('nb_kid_session')]]);
  await api('/api/family', { jar: childOnly, status: 401 });
  await api('/api/children/logout', { method: 'POST' });
  await api('/api/children/me', { status: 401 });
  assert.equal((await api('/api/family')).guardian.id, guardianId, 'Logout infantil deve preservar a sessão do responsável');
  await api('/api/auth/logout', { method: 'POST' });

  if (checkPages) {
    for (const page of ['/', '/responsavel', '/crianca', '/games/index.html']) {
      const response = await fetch(origin + page, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `${page}: página indisponível`);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
    }
    for (const file of ['/server/.env', '/server/schema.sql']) {
      const response = await fetch(origin + file, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 404, `${file}: arquivo privado deve estar fora da publicação`);
    }
  }
  return { origin, guardianId, childId, checks: 'health, cadastro, duplicidade, login, logout, persistência, família, histórico, sessão infantil e isolamento de sessões' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  try {
    const result = await smokeOnline(process.argv[2], { checkPages: !process.argv.includes('--api-only') });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Teste online falhou:', error.message);
    process.exitCode = 1;
  }
}
