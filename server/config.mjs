function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function proxyToken(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 256) throw new Error('PROXY_AUTH_TOKEN must contain at least 32 random bytes encoded as hexadecimal or base64');
  let bytes;
  if (/^[a-f0-9]{64,256}$/i.test(value) && value.length % 2 === 0) bytes = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    bytes = Buffer.from(value, 'base64url');
    const canonical = value.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
    if (bytes.toString('base64url') !== canonical) bytes = null;
  }
  if (!bytes || bytes.length < 32) throw new Error('PROXY_AUTH_TOKEN must contain at least 32 random bytes encoded as hexadecimal or base64');
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
  const mailDeliveryMode = env.MAIL_DELIVERY_MODE || (production ? 'disabled' : 'captured');
  if (!['disabled','captured','allowlist','smtp'].includes(mailDeliveryMode)) throw new Error('MAIL_DELIVERY_MODE must be disabled, captured, allowlist or smtp');
  const transactionalMailEnabled = production && env.TRANSACTIONAL_MAIL_ENABLED === 'true';
  if (mailDeliveryMode === 'smtp' && !transactionalMailEnabled) throw new Error('SMTP delivery requires production and TRANSACTIONAL_MAIL_ENABLED=true');
  const testEmailAllowlist = Object.freeze((env.TEST_EMAIL_ALLOWLIST || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
  if (testEmailAllowlist.length > 20 || testEmailAllowlist.some(email=>email.includes('*') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Use at most 20 exact test email addresses');
  if (mailDeliveryMode === 'allowlist' && !testEmailAllowlist.length) throw new Error('Allowlisted mail requires explicit TEST_EMAIL_ALLOWLIST');
  const proxyAuthToken = proxyToken(env.PROXY_AUTH_TOKEN);
  const releaseSha = env.RELEASE_SHA || null;
  if (releaseSha !== null && (typeof releaseSha !== 'string' || !/^[a-f0-9]{40}$/i.test(releaseSha))) throw new Error('RELEASE_SHA must be a full 40-character hexadecimal commit SHA');
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
    mailDeliveryMode, testEmailAllowlist, transactionalMailEnabled,
    registrationEnabled: mailDeliveryMode !== 'disabled',
    passwordRecoveryEnabled: mailDeliveryMode !== 'disabled',
    emailVerificationEnabled: mailDeliveryMode !== 'disabled',
    proxyAuthToken, releaseSha: releaseSha?.toLowerCase() || null,
    ownerBookApiEnabled: env.OWNER_BOOK_API_ENABLED === 'true',
    ownerBookMcpEnabled: env.OWNER_BOOK_MCP_ENABLED === 'true',
    ownerBookOAuthEnabled: env.OWNER_BOOK_OAUTH_ENABLED === 'true',
    ownerBookMcpCreateEnabled: env.OWNER_BOOK_MCP_CREATE_ENABLED === 'true',
    sessionLifetimeSeconds: 60 * 60 * 24 * 7,
  });
}
