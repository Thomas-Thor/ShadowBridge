import { randomBytes, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const envFile = path.join(root, '.local', 'development.env');

export async function localEnvironment() {
  const content = await readFile(envFile, 'utf8');
  const generated = Object.fromEntries(content.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
    const index = line.indexOf('=');
    if (index < 1) throw new Error('Invalid local environment file');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const admin = new URL(generated.DATABASE_ADMIN_URL);
  if (generated.APP_ENV !== 'local' || admin.hostname !== '127.0.0.1' || admin.port !== '54322' || admin.username !== 'postgres' || admin.pathname !== '/shadowbridge') throw new Error('Local bootstrap refuses a non-local development database');
  return { ...process.env, ...generated };
}

export async function ensureEnvironment() {
  await mkdir(path.dirname(envFile), { recursive: true, mode: 0o700 });
  try {
    await readFile(envFile);
    await chmod(envFile, 0o600);
    return envFile;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const secret = () => randomBytes(36).toString('base64url');
  const postgres = secret(), auth = secret(), api = secret(), sessions = secret(), jwt = secret();
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ role: 'anon', iss: 'shadowbridge-local', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 315360000 });
  const signingInput = `${header}.${payload}`;
  const anon = `${signingInput}.${createHmac('sha256', jwt).update(signingInput).digest('base64url')}`;
  const values = {
    APP_ENV: 'local', APP_URL: 'http://127.0.0.1:8088', HOST: '127.0.0.1', PORT: '8088',
    SUPABASE_URL: 'http://127.0.0.1:9999', SUPABASE_ANON_KEY: anon,
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    POSTGRES_PASSWORD: postgres, SB_AUTH_PASSWORD: auth, SB_API_PASSWORD: api, SB_SESSION_PASSWORD: sessions,
    GOTRUE_JWT_SECRET: jwt,
    DATABASE_ADMIN_URL: `postgres://postgres:${postgres}@127.0.0.1:54322/shadowbridge`,
    DATABASE_URL: `postgres://shadowbridge_api:${api}@127.0.0.1:54322/shadowbridge`,
    SESSION_DATABASE_URL: `postgres://shadowbridge_sessions:${sessions}@127.0.0.1:54322/shadowbridge`,
  };
  await writeFile(envFile, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  return envFile;
}
