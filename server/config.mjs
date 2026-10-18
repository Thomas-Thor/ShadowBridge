function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export function loadConfig(env = process.env) {
  const appEnv = required(env, 'APP_ENV');
  if (!['local', 'test', 'production'].includes(appEnv)) throw new Error('APP_ENV must be local, test or production');
  const app = new URL(required(env, 'APP_URL'));
  const provider = new URL(required(env, 'SUPABASE_URL'));
  if (app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('APP_URL must be an origin');
  if (provider.username || provider.password || provider.search || provider.hash) throw new Error('Invalid SUPABASE_URL');
  const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
  const production = appEnv === 'production';
  if (production && (app.protocol !== 'https:' || provider.protocol !== 'https:')) throw new Error('Production APP_URL and SUPABASE_URL must use HTTPS');
  if (!production && (!localHosts.includes(app.hostname) || !localHosts.includes(provider.hostname))) throw new Error('Local/test providers and website must bind to loopback origins');
  const host = env.HOST || '127.0.0.1';
  if (!production && !localHosts.includes(host)) throw new Error('Local/test HTTP server must bind to loopback');
  const sessionEncryptionKey = Buffer.from(required(env, 'SESSION_ENCRYPTION_KEY'), 'base64');
  if (sessionEncryptionKey.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must contain 32 random bytes encoded as base64');
  const port = Number(env.PORT || 8088);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const databaseUrl = required(env, 'DATABASE_URL');
  const sessionDatabaseUrl = required(env, 'SESSION_DATABASE_URL');
  if (databaseUrl === sessionDatabaseUrl) throw new Error('API and session database roles must be separate');
  for (const [url, role] of [[databaseUrl, 'shadowbridge_api'], [sessionDatabaseUrl, 'shadowbridge_sessions']]) {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.password || parsed.password.length < 24) throw new Error('Database URL requires a strong role password');
    if (!(decodeURIComponent(parsed.username) === role || decodeURIComponent(parsed.username).startsWith(`${role}.`))) throw new Error(`Database URL must use the restricted ${role} role`);
    if (!production && !localHosts.includes(parsed.hostname)) throw new Error('Local/test database must use a loopback address');
    if (production && parsed.searchParams.get('sslmode') !== 'verify-full') throw new Error('Production database connections require sslmode=verify-full');
  }
  return Object.freeze({
    appEnv, appUrl: app.origin, port, host,
    supabaseUrl: provider.toString().replace(/\/$/, ''),
    supabaseAnonKey: required(env, 'SUPABASE_ANON_KEY'),
    databaseUrl, sessionDatabaseUrl, sessionEncryptionKey,
    secureCookies: production || app.protocol === 'https:',
    sessionLifetimeSeconds: 60 * 60 * 24 * 7,
  });
}
