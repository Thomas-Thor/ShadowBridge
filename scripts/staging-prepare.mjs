// Private installation preparation only. This script never starts containers,
// connects to a server, rotates an existing secret or modifies an existing DB.
import { randomBytes, createHmac, createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateFiles = ['compose.env', 'postgres.env', 'auth.env', 'app.env', 'migration.env', 'tester-password', 'Caddyfile'];
const certFiles = ['internal-ca.crt', 'internal-ca.key', 'postgres.crt', 'postgres.key', 'auth-proxy.crt', 'auth-proxy.key', 'public.crt', 'public.key'];
const digest = data => createHash('sha256').update(data).digest('hex');
const secret = () => randomBytes(36).toString('base64url');
const envText = values => Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function openssl(args, options = {}) {
  try { return execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch { throw new Error('Certificate generation or verification failed. Existing configuration was not replaced.'); }
}
export async function readEnv(file) {
  const text = await readFile(file, 'utf8');
  const values = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    requireCondition(index > 0 && /^[A-Z][A-Z0-9_]*$/.test(line.slice(0, index)), 'Invalid generated environment file.');
    const key = line.slice(0, index);
    requireCondition(!Object.hasOwn(values, key), 'Duplicate generated environment key.');
    values[key] = line.slice(index + 1);
  }
  return values;
}
async function privateDirectory(directory) {
  const root = await realpath(repositoryRoot);
  const base = path.join(root, '.local');
  const resolved = path.resolve(root, directory || '.local/contabo-private');
  requireCondition(resolved.startsWith(base + path.sep) && resolved !== base, 'Configuration must be inside the ignored repository .local/ directory.');
  requireCondition(!/[\s$#'"\\]/.test(resolved), 'Use a configuration path without whitespace or shell metacharacters.');
  // Refuse symlink escapes, including pre-existing intermediate directories.
  let cursor = resolved;
  while (cursor !== root) {
    try { requireCondition(!(await lstat(cursor)).isSymbolicLink(), 'Symlink configuration paths are refused.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    cursor = path.dirname(cursor);
  }
  return resolved;
}
async function writePrivate(file, value) { await writeFile(file, value, { mode: 0o600, flag: 'wx' }); }
async function makeCertificate(directory, name, dnsNames, serial) {
  const key = path.join(directory, `${name}.key`);
  const csr = path.join(directory, `${name}.csr`);
  const extensions = path.join(directory, `${name}.ext`);
  await writePrivate(extensions, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${dnsNames}\n`);
  openssl(['req', '-new', '-newkey', 'rsa:3072', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${name === 'public' ? 'localhost' : name}`]);
  openssl(['x509', '-req', '-in', csr, '-CA', path.join(directory, 'internal-ca.crt'), '-CAkey', path.join(directory, 'internal-ca.key'), '-set_serial', serial, '-days', '397', '-sha256', '-extfile', extensions, '-out', path.join(directory, `${name}.crt`)]);
  // OpenSSL creates keys privately but its public outputs inherit umask.
  const { chmod, unlink } = await import('node:fs/promises');
  await Promise.all([chmod(key, 0o600), chmod(path.join(directory, `${name}.crt`), 0o600)]);
  await Promise.all([unlink(csr), unlink(extensions)]);
}
function databaseUrl(role, password) {
  return `postgres://${role}:${password}@postgres:5432/shadowbridge?sslmode=verify-full&sslrootcert=/run/secrets/internal-ca.crt`;
}
export async function prepareStaging(options = {}) {
  const directory = await privateDirectory(options.directory);
  try {
    await stat(directory);
    const checked = await checkStaging({ directory });
    if (options.project) requireCondition(options.project === checked.project, 'Existing project differs; prepare never changes project identity.');
    if (options.httpsPort) requireCondition(Number(options.httpsPort) === checked.httpsPort, 'Existing HTTPS port differs; prepare never rewrites configuration.');
    if (options.httpPort) requireCondition(Number(options.httpPort) === checked.httpPort, 'Existing HTTP port differs; prepare never rewrites configuration.');
    return { ...checked, created: false };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const project = options.project || `shadowbridge-contabo-${randomBytes(5).toString('hex')}`;
  requireCondition(/^shadowbridge-(?:contabo|stageg)-[a-z0-9][a-z0-9-]{2,45}$/.test(project), 'Use a distinct shadowbridge-contabo-* project name.');
  const httpsPort = Number(options.httpsPort || 8443), httpPort = Number(options.httpPort || 8080);
  requireCondition([httpsPort, httpPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) && httpsPort !== httpPort, 'Use distinct unprivileged HTTPS and HTTP loopback ports.');
  // No inherited .env file, local demo configuration or existing credentials.
  openssl(['version']);
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const certificates = path.join(directory, 'certs');
  await mkdir(certificates, { mode: 0o700 });
  const passwords = { postgres: secret(), auth: secret(), api: secret(), sessions: secret(), jwt: secret() };
  const origin = `https://localhost:${httpsPort}`;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', iss: project, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 315360000 })}`;
  const anon = `${signingInput}.${createHmac('sha256', passwords.jwt).update(signingInput).digest('base64url')}`;
  const env = {
    compose: { STAGING_PROJECT: project, STAGING_DIR: directory, STAGING_BIND: '127.0.0.1', STAGING_HTTP_PORT: httpPort, STAGING_HTTPS_PORT: httpsPort },
    postgres: { POSTGRES_DB: 'shadowbridge', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: passwords.postgres, SB_AUTH_PASSWORD: passwords.auth, SB_API_PASSWORD: passwords.api, SB_SESSION_PASSWORD: passwords.sessions },
    app: { APP_ENV: 'production', APP_URL: origin, HOST: '0.0.0.0', PORT: '8088', SUPABASE_URL: 'https://auth-proxy:8444', SUPABASE_ANON_KEY: anon, NODE_EXTRA_CA_CERTS: '/run/secrets/internal-ca.crt', SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'), DATABASE_URL: databaseUrl('shadowbridge_api', passwords.api), SESSION_DATABASE_URL: databaseUrl('shadowbridge_sessions', passwords.sessions), MAIL_DELIVERY_MODE: 'captured' },
    migration: { DATABASE_ADMIN_URL: databaseUrl('postgres', passwords.postgres) },
    auth: {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: origin, GOTRUE_SITE_URL: origin,
      GOTRUE_URI_ALLOW_LIST: `${origin}/auth/confirm,${origin}/auth/recover`, GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: databaseUrl('supabase_auth_admin', passwords.auth) + '&search_path=auth', GOTRUE_DB_NAMESPACE: 'auth',
      GOTRUE_JWT_SECRET: passwords.jwt, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: 'false', GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true', GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10', GOTRUE_PASSWORD_MIN_LENGTH: '12',
      GOTRUE_MFA_ENABLED: 'true', GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true', GOTRUE_MFA_MAX_ENROLLED_FACTORS: '5',
      GOTRUE_SMTP_HOST: 'mailpit', GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_ADMIN_EMAIL: 'local-auth@shadowbridge.invalid', GOTRUE_SMTP_SENDER_NAME: 'ShadowBridge private test', GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/confirm', GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/recover', GOTRUE_RATE_LIMIT_EMAIL_SENT: '200', GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '500', GOTRUE_LOG_LEVEL: 'warn',
    },
  };
  for (const [name, values] of Object.entries(env)) await writePrivate(path.join(directory, `${name}.env`), envText(values));
  await writePrivate(path.join(directory, 'tester-password'), secret() + '\n');
  openssl(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', path.join(certificates, 'internal-ca.key'), '-out', path.join(certificates, 'internal-ca.crt'), '-days', '3650', '-sha256', '-subj', `/CN=ShadowBridge private ${project}`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const { chmod } = await import('node:fs/promises');
  await chmod(path.join(certificates, 'internal-ca.key'), 0o600);
  // The CA certificate is public and must be readable by container UID 1000
  // even when shadowadmin has another host UID. Its private key remains 0600.
  await chmod(path.join(certificates, 'internal-ca.crt'), 0o644);
  await makeCertificate(certificates, 'postgres', 'DNS:postgres', '0x' + randomBytes(16).toString('hex'));
  await makeCertificate(certificates, 'auth-proxy', 'DNS:auth-proxy', '0x' + randomBytes(16).toString('hex'));
  await makeCertificate(certificates, 'public', 'DNS:localhost,IP:127.0.0.1', '0x' + randomBytes(16).toString('hex'));
  const template = await readFile(path.join(repositoryRoot, 'deploy/staging/Caddyfile.in'), 'utf8');
  const caddy = template.replace('@LOCAL_OPTIONS@', 'auto_https disable_redirects').replace('@DOMAIN@', 'localhost').replace('@PUBLIC_TLS@', 'tls /run/secrets/public.crt /run/secrets/public.key');
  requireCondition(!/@[A-Z_]+@/.test(caddy), 'Unresolved gateway template placeholders.');
  await writePrivate(path.join(directory, 'Caddyfile'), caddy);
  const hashes = {};
  for (const name of [...privateFiles, ...certFiles.map(name => `certs/${name}`)]) hashes[name] = digest(await readFile(path.join(directory, name)));
  await writePrivate(path.join(directory, 'manifest.json'), JSON.stringify({ kind: 'shadowbridge-private-contabo-v1', project, httpsPort, httpPort, origin, createdAt: new Date().toISOString(), hashes }, null, 2) + '\n');
  return { ...(await checkStaging({ directory })), created: true };
}
export async function checkStaging(options = {}) {
  const directory = await privateDirectory(options.directory);
  const mode = async (file, expected, directoryMode = false) => {
    const info = await lstat(file);
    requireCondition(!info.isSymbolicLink() && (directoryMode ? info.isDirectory() : info.isFile()), 'Private configuration contains a symlink or unexpected file type.');
    requireCondition((info.mode & 0o777) === expected, `Unsafe permissions on ${path.basename(file)}; expected ${expected.toString(8)}.`);
  };
  await mode(directory, 0o700, true); await mode(path.join(directory, 'certs'), 0o700, true);
  await mode(path.join(directory, 'manifest.json'), 0o600);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  requireCondition(manifest.kind === 'shadowbridge-private-contabo-v1' && typeof manifest.hashes === 'object', 'Unrecognized private configuration; refusing reuse.');
  const names = [...privateFiles, ...certFiles.map(name => `certs/${name}`)];
  for (const name of names) {
    await mode(path.join(directory, name), name === 'certs/internal-ca.crt' ? 0o644 : 0o600);
    requireCondition(digest(await readFile(path.join(directory, name))) === manifest.hashes[name], `Configuration fingerprint changed: ${name}. Restore the original configuration; do not regenerate secrets.`);
  }
  const values = {};
  for (const name of ['compose', 'postgres', 'app', 'auth', 'migration']) values[name] = await readEnv(path.join(directory, `${name}.env`));
  requireCondition(values.compose.STAGING_DIR === directory && values.compose.STAGING_BIND === '127.0.0.1', 'Private gateway must remain bound to loopback.');
  requireCondition(values.compose.STAGING_PROJECT === manifest.project && /^shadowbridge-(?:contabo|stageg)-[a-z0-9][a-z0-9-]{2,45}$/.test(manifest.project), 'Private project identity is invalid.');
  requireCondition(values.app.APP_URL === `https://localhost:${values.compose.STAGING_HTTPS_PORT}` && values.app.APP_URL === manifest.origin, 'Private HTTPS origin mismatch.');
  requireCondition(!Object.hasOwn(values.app, 'DATABASE_ADMIN_URL') && !Object.hasOwn(values.app, 'POSTGRES_PASSWORD') && !Object.hasOwn(values.app, 'GOTRUE_JWT_SECRET'), 'Runtime must not receive administrative secrets.');
  requireCondition(values.app.APP_ENV === 'production' && values.app.MAIL_DELIVERY_MODE === 'captured' && values.app.NODE_EXTRA_CA_CERTS === '/run/secrets/internal-ca.crt' && values.app.SUPABASE_URL === 'https://auth-proxy:8444', 'Runtime TLS or captured-mail configuration is invalid.');
  loadConfig(values.app);
  for (const [value, role] of [[values.app.DATABASE_URL, 'shadowbridge_api'], [values.app.SESSION_DATABASE_URL, 'shadowbridge_sessions'], [values.migration.DATABASE_ADMIN_URL, 'postgres'], [values.auth.GOTRUE_DB_DATABASE_URL, 'supabase_auth_admin']]) {
    const url = new URL(value);
    requireCondition(url.hostname === 'postgres' && url.port === '5432' && url.pathname === '/shadowbridge' && url.username === role && url.password.length >= 32 && url.searchParams.get('sslmode') === 'verify-full' && url.searchParams.get('sslrootcert') === '/run/secrets/internal-ca.crt', 'Database role, private host or verified TLS configuration is invalid.');
  }
  requireCondition(values.auth.GOTRUE_SMTP_HOST === 'mailpit' && values.auth.GOTRUE_SMTP_PORT === '1025' && values.auth.GOTRUE_MAILER_AUTOCONFIRM === 'false' && values.auth.GOTRUE_MFA_TOTP_VERIFY_ENABLED === 'true', 'Auth must retain captured mail, verified email and MFA.');
  requireCondition(new Set([values.postgres.POSTGRES_PASSWORD, values.postgres.SB_AUTH_PASSWORD, values.postgres.SB_API_PASSWORD, values.postgres.SB_SESSION_PASSWORD, values.auth.GOTRUE_JWT_SECRET, values.app.SESSION_ENCRYPTION_KEY]).size === 6, 'Generated role and encryption secrets must be distinct.');
  for (const name of ['postgres', 'auth-proxy', 'public']) {
    const crt = path.join(directory, 'certs', `${name}.crt`);
    openssl(['verify', '-CAfile', path.join(directory, 'certs/internal-ca.crt'), '-verify_hostname', name === 'public' ? 'localhost' : name, crt]);
    const cert = new X509Certificate(await readFile(crt));
    requireCondition(Date.parse(cert.validTo) > Date.now() + 7 * 86400000, 'Certificate expires in less than seven days. Plan renewal without rotating authentication secrets.');
    const certPublic = openssl(['x509', '-in', crt, '-pubkey', '-noout']);
    const keyPublic = openssl(['pkey', '-in', path.join(directory, 'certs', `${name}.key`), '-pubout']);
    requireCondition(certPublic.equals(keyPublic), 'Certificate/private-key mismatch.');
  }
  requireCondition((await readFile(path.join(directory, 'tester-password'), 'utf8')).trim().length >= 40, 'Reviewer gateway password is too short.');
  return { directory, project: manifest.project, httpsPort: Number(values.compose.STAGING_HTTPS_PORT), httpPort: Number(values.compose.STAGING_HTTP_PORT), origin: manifest.origin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, known = new Set(['dir', 'project', 'https-port', 'http-port']);
    const check = process.argv.includes('--check');
    for (const arg of process.argv.slice(2).filter(value => value !== '--check')) {
      const match = /^--([^=]+)=(.+)$/.exec(arg);
      requireCondition(match && known.has(match[1]), 'Use --dir=..., --project=..., --https-port=... or --http-port=....');
      options[({ dir: 'directory', project: 'project', 'https-port': 'httpsPort', 'http-port': 'httpPort' })[match[1]]] = match[2];
    }
    const result = await (check ? checkStaging(options) : prepareStaging(options));
    console.log(`${check ? 'Configuration verified' : result.created ? 'New private configuration prepared' : 'Existing private configuration verified; secrets unchanged'}.`);
    console.log(`Project: ${result.project}; origin: ${result.origin}; loopback only.`);
    console.log('No containers started. Keep the private configuration and its backup outside Git; never publish compose config or environment contents.');
  } catch (error) { console.error(`Private preparation refused: ${error.message}`); process.exitCode = 1; }
}
