// Host-only public profile for an EXISTING verified private installation.
// No database, Docker, DNS, SSH, mail send or existing-secret rotation occurs here.
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { checkStaging, readEnv, repositoryRoot } from './staging-prepare.mjs';
import { loadConfig } from '../server/config.mjs';

export const productionOrigin = 'https://shadow-bridge.eu';
const sender = 'shadowbridge.trade@gmail.com';
const files = ['compose.env', 'app.env', 'auth.env', 'proxy-token', 'Caddyfile'];
const digest = value => createHash('sha256').update(value).digest('hex');
const guard = (condition, message) => { if (!condition) throw new Error(message); };
const envText = values => Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
const appChanges = new Set(['APP_URL', 'MAIL_DELIVERY_MODE', 'TRANSACTIONAL_MAIL_ENABLED', 'PROXY_AUTH_TOKEN', 'RELEASE_SHA']);
const authChanges = new Set(['API_EXTERNAL_URL', 'GOTRUE_SITE_URL', 'GOTRUE_URI_ALLOW_LIST', 'GOTRUE_SMTP_HOST', 'GOTRUE_SMTP_PORT', 'GOTRUE_SMTP_ADMIN_EMAIL', 'GOTRUE_SMTP_SENDER_NAME', 'GOTRUE_SMTP_USER', 'GOTRUE_SMTP_PASS', 'GOTRUE_SMTP_MAX_FREQUENCY', 'GOTRUE_RATE_LIMIT_EMAIL_SENT', 'GOTRUE_DISABLE_SIGNUP']);

async function regular(file, mode, directory = false) {
  const info = await lstat(file);
  guard(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()) && (info.mode & 0o777) === mode,
    'Production configuration requires private regular files (0600) and directories (0700).');
}
function unchanged(original, actual, allowed, message) {
  for (const key of new Set([...Object.keys(original), ...Object.keys(actual)])) {
    if (!allowed.has(key)) guard(original[key] === actual[key], message);
  }
}
function gmailPassword(value) {
  guard(typeof value === 'string' && !/[\r\n\0]/.test(value), 'Enter a Gmail app password locally; never a normal account password.');
  const compact = value.replaceAll(' ', '');
  guard(/^[A-Za-z0-9]{16}$/.test(compact), 'Gmail app password must contain 16 letters/digits, optionally grouped with spaces.');
  return compact;
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function selectNoMail(source, releaseSha) {
  const folder = path.join(source.directory, 'production-no-mail');
  await regular(folder, 0o700, true);
  const temporary = path.join(folder, `.selection-${randomBytes(6).toString('hex')}.json`);
  await writeFile(temporary, JSON.stringify({ kind: 'shadowbridge-no-mail-selection-v1', releaseSha, purpose: 'prepared-configuration-only' }) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path.join(folder, 'selected.json'));
}
async function profileTarget(source, { mailMode, releaseSha } = {}) {
  if (mailMode === 'smtp') return { target: path.join(source.directory, 'production'), mailMode: 'smtp' };
  const folder = path.join(source.directory, 'production-no-mail');
  const selector = path.join(folder, 'selected.json');
  if (releaseSha || mailMode === 'disabled' || await exists(selector)) {
    await regular(folder, 0o700, true);
    if (!releaseSha) {
      await regular(selector, 0o600);
      const selection = JSON.parse(await readFile(selector, 'utf8'));
      guard(selection.kind === 'shadowbridge-no-mail-selection-v1' && selection.purpose === 'prepared-configuration-only', 'Invalid prepared no-mail selection.');
      releaseSha = selection.releaseSha;
    }
    guard(/^[a-f0-9]{40}$/.test(releaseSha || ''), 'A complete verified no-mail release SHA is required.');
    return { target: path.join(folder, releaseSha), mailMode: 'disabled' };
  }
  return { target: path.join(source.directory, 'production'), mailMode: 'smtp' };
}

export async function prepareProduction({ directory, smtpPassword, releaseSha, mailMode = 'disabled' } = {}) {
  const source = await checkStaging({ directory });
  guard(/^[a-f0-9]{40}$/.test(releaseSha || ''), 'A complete verified release SHA is required.');
  guard(['smtp', 'disabled'].includes(mailMode), 'Public mail mode must be disabled or explicitly smtp.');
  guard(mailMode !== 'disabled' || smtpPassword === undefined, 'No SMTP credential is accepted when email is disabled.');
  const folder = path.join(source.directory, 'production-no-mail');
  if (mailMode === 'disabled') {
    if (!await exists(folder)) await mkdir(folder, { mode: 0o700 });
    await regular(folder, 0o700, true);
  }
  const target = mailMode === 'disabled' ? path.join(folder, releaseSha) : path.join(source.directory, 'production');
  if (await exists(target)) {
    const existing = await checkProduction({ directory: source.directory, mailMode, releaseSha: mailMode === 'disabled' ? releaseSha : undefined });
    guard(existing.releaseSha === releaseSha, 'An existing public profile belongs to another release. Use the controlled update procedure; never regenerate its secrets.');
    if (smtpPassword !== undefined) guard((await readEnv(path.join(target, 'auth.env'))).GOTRUE_SMTP_PASS === gmailPassword(smtpPassword), 'Existing SMTP credential differs; public preparation never replaces it.');
    if (mailMode === 'disabled') await selectNoMail(source, releaseSha);
    return { ...existing, created: false };
  }
  const password = mailMode === 'smtp' ? gmailPassword(smtpPassword) : undefined;
  const originalApp = await readEnv(path.join(source.directory, 'app.env'));
  const originalAuth = await readEnv(path.join(source.directory, 'auth.env'));
  let token;
  try {
    const previous = await checkProduction({ directory: source.directory });
    token = (await readEnv(path.join(previous.directory, 'app.env'))).PROXY_AUTH_TOKEN;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  token ||= randomBytes(32).toString('hex');
  const app = { ...originalApp, APP_URL: productionOrigin, MAIL_DELIVERY_MODE: mailMode, TRANSACTIONAL_MAIL_ENABLED: mailMode === 'smtp' ? 'true' : 'false', PROXY_AUTH_TOKEN: token, RELEASE_SHA: releaseSha };
  const auth = { ...originalAuth, API_EXTERNAL_URL: productionOrigin, GOTRUE_SITE_URL: productionOrigin,
    GOTRUE_URI_ALLOW_LIST: `${productionOrigin}/auth/confirm,${productionOrigin}/auth/recover` };
  if (mailMode === 'smtp') Object.assign(auth, { GOTRUE_SMTP_HOST: 'smtp.gmail.com', GOTRUE_SMTP_PORT: '465', GOTRUE_SMTP_USER: sender, GOTRUE_SMTP_PASS: password,
    GOTRUE_SMTP_ADMIN_EMAIL: sender, GOTRUE_SMTP_SENDER_NAME: 'ShadowBridge', GOTRUE_SMTP_MAX_FREQUENCY: '60s', GOTRUE_RATE_LIMIT_EMAIL_SENT: '30' });
  else {
    Object.assign(auth, { GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '1' });
    delete auth.GOTRUE_SMTP_USER; delete auth.GOTRUE_SMTP_PASS;
  }
  loadConfig(app);
  const composeEnvironment = { STAGING_DIR: source.directory, STAGING_PROJECT: source.project, PRODUCTION_DIR: target };
  const caddy = await readFile(path.join(repositoryRoot, 'deploy/production/Caddyfile.in'), 'utf8');
  await mkdir(target, { mode: 0o700 });
  const values = { 'compose.env': envText(composeEnvironment), 'app.env': envText(app), 'auth.env': envText(auth), 'proxy-token': token + '\n', Caddyfile: caddy };
  for (const [name, value] of Object.entries(values)) await writeFile(path.join(target, name), value, { mode: 0o600, flag: 'wx' });
  const hashes = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, digest(value)]));
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ kind: 'shadowbridge-production-v1', project: source.project,
    sourceDirectory: source.directory, origin: productionOrigin, releaseSha, mailMode, createdAt: new Date().toISOString(), hashes }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const checked = await checkProduction({ directory: source.directory, mailMode, releaseSha: mailMode === 'disabled' ? releaseSha : undefined });
  if (mailMode === 'disabled') await selectNoMail(source, releaseSha);
  return { ...checked, created: true };
}

export async function checkProduction({ directory, mailMode, releaseSha } = {}) {
  const source = await checkStaging({ directory });
  guard(mailMode === undefined || ['smtp', 'disabled'].includes(mailMode), 'Invalid public mail mode.');
  const chosen = await profileTarget(source, { mailMode, releaseSha });
  const target = chosen.target;
  await regular(target, 0o700, true);
  await regular(path.join(target, 'manifest.json'), 0o600);
  const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
  guard(manifest.kind === 'shadowbridge-production-v1' && manifest.project === source.project && manifest.sourceDirectory === source.directory && manifest.origin === productionOrigin && /^[a-f0-9]{40}$/.test(manifest.releaseSha || ''), 'Invalid production identity or release.');
  for (const file of files) {
    await regular(path.join(target, file), 0o600);
    guard(digest(await readFile(path.join(target, file))) === manifest.hashes?.[file], `Production configuration fingerprint changed: ${file}. Stop instead of replacing credentials.`);
  }
  const app = await readEnv(path.join(target, 'app.env')), auth = await readEnv(path.join(target, 'auth.env'));
  const originalApp = await readEnv(path.join(source.directory, 'app.env')), originalAuth = await readEnv(path.join(source.directory, 'auth.env'));
  unchanged(originalApp, app, appChanges, 'Public runtime must preserve every original authentication/database/session setting.');
  unchanged(originalAuth, auth, authChanges, 'Public Auth must preserve every original database/JWT/MFA setting.');
  guard(app.APP_URL === productionOrigin && app.MAIL_DELIVERY_MODE === chosen.mailMode && app.TRANSACTIONAL_MAIL_ENABLED === (chosen.mailMode === 'smtp' ? 'true' : 'false') && app.RELEASE_SHA === manifest.releaseSha, 'Invalid public runtime origin, mail mode or release.');
  guard((manifest.mailMode || 'smtp') === chosen.mailMode && (chosen.mailMode !== 'disabled' || path.basename(target) === manifest.releaseSha), 'Invalid versioned no-mail identity.');
  guard(/^[a-f0-9]{64}$/.test(app.PROXY_AUTH_TOKEN || '') && (await readFile(path.join(target, 'proxy-token'), 'utf8')).trim() === app.PROXY_AUTH_TOKEN, 'Invalid private gateway authentication token.');
  loadConfig(app);
  guard(auth.API_EXTERNAL_URL === productionOrigin && auth.GOTRUE_SITE_URL === productionOrigin && auth.GOTRUE_URI_ALLOW_LIST === `${productionOrigin}/auth/confirm,${productionOrigin}/auth/recover`, 'Public email links must target only the approved origin.');
  if (chosen.mailMode === 'smtp') {
    guard(auth.GOTRUE_DISABLE_SIGNUP === originalAuth.GOTRUE_DISABLE_SIGNUP && auth.GOTRUE_SMTP_HOST === 'smtp.gmail.com' && auth.GOTRUE_SMTP_PORT === '465' && auth.GOTRUE_SMTP_USER === sender && auth.GOTRUE_SMTP_ADMIN_EMAIL === sender && auth.GOTRUE_SMTP_SENDER_NAME === 'ShadowBridge' && auth.GOTRUE_SMTP_MAX_FREQUENCY === '60s' && auth.GOTRUE_RATE_LIMIT_EMAIL_SENT === '30', 'Invalid approved Gmail transaction-mail configuration.');
    gmailPassword(auth.GOTRUE_SMTP_PASS);
  } else guard(auth.GOTRUE_DISABLE_SIGNUP === 'true' && auth.GOTRUE_EXTERNAL_EMAIL_ENABLED === 'true' && auth.GOTRUE_MAILER_AUTOCONFIRM === 'false'
      && auth.GOTRUE_SMTP_HOST === '127.0.0.1' && auth.GOTRUE_SMTP_PORT === '1' && !Object.hasOwn(auth, 'GOTRUE_SMTP_USER') && !Object.hasOwn(auth, 'GOTRUE_SMTP_PASS'),
    'No-mail Auth must retain login/verification/MFA while disabling signup and SMTP credentials.');
  const composeEnvironment = await readEnv(path.join(target, 'compose.env'));
  guard(Object.keys(composeEnvironment).length === 3 && composeEnvironment.STAGING_DIR === source.directory && composeEnvironment.STAGING_PROJECT === source.project && composeEnvironment.PRODUCTION_DIR === target, 'Public configuration must retain the existing Docker project and volume identity.');
  guard((await readFile(path.join(target, 'Caddyfile'), 'utf8')) === await readFile(path.join(repositoryRoot, 'deploy/production/Caddyfile.in'), 'utf8'), 'Production gateway differs from the reviewed template.');
  return { directory: target, sourceDirectory: source.directory, project: source.project, origin: productionOrigin,
    releaseSha: manifest.releaseSha, mailMode: chosen.mailMode, composeEnvironment };
}
