export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL deve ser configurada.');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /^replace[_-]/i.test(env.JWT_SECRET)) {
    throw new Error('JWT_SECRET deve ser um segredo aleatório com pelo menos 32 caracteres.');
  }
  if (production && !env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN deve ser configurada em produção.');
  const frontendOrigins = (env.FRONTEND_ORIGIN || 'http://localhost:5500,http://127.0.0.1:5500')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  if (!frontendOrigins.length) throw new Error('FRONTEND_ORIGIN deve conter uma origem válida.');
  for (const origin of frontendOrigins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('FRONTEND_ORIGIN deve conter origens HTTP/HTTPS válidas.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      throw new Error('FRONTEND_ORIGIN deve conter somente origens, sem caminhos nem credenciais.');
    }
    if (production && url.protocol !== 'https:') throw new Error('FRONTEND_ORIGIN deve usar HTTPS em produção.');
  }
  const cookieSameSite = (env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(cookieSameSite)) throw new Error('SESSION_COOKIE_SAME_SITE inválido.');
  if (cookieSameSite === 'none' && !production) throw new Error('SameSite=None requer HTTPS e NODE_ENV=production.');
  const port = Number(env.PORT || 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
  const trustProxy = env.TRUST_PROXY === 'true' ? true : Number(env.TRUST_PROXY || 0);
  if (trustProxy !== true && (!Number.isInteger(trustProxy) || trustProxy < 0)) throw new Error('TRUST_PROXY inválido.');
  return {
    databaseUrl: env.DATABASE_URL, jwtSecret: env.JWT_SECRET, production, frontendOrigins, cookieSameSite, trustProxy,
    port, host: env.HOST || '0.0.0.0',
    smtpHost: env.SMTP_HOST, smtpPort: Number(env.SMTP_PORT || 587), smtpUser: env.SMTP_USER, smtpPass: env.SMTP_PASS, mailFrom: env.MAIL_FROM,
  };
}

export function databaseOptions(config) {
  return { connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000, idleTimeoutMillis: 30000, max: 10 };
}
