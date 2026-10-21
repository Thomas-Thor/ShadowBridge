import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  constructor(message, status = 401, code = 'authentication_failed') { super(message); this.status = status; this.code = code; }
}

const opaque = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}
function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
function appendCookie(res, value) {
  const previous = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), value]);
}
function decodeClaims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWT');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new AuthError('Invalid authentication session'); }
}

export function createAuthService({ config, db }) {
  const pool = db.sessionPool;
  const sessionName = config.secureCookies ? '__Host-sb_session' : 'sb_session';
  const csrfName = config.secureCookies ? '__Host-sb_csrf' : 'sb_csrf';
  const authBase = config.supabaseAuthUrl || (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(config.supabaseUrl) ? config.supabaseUrl : `${config.supabaseUrl}/auth/v1`);
  const locks = new Map();
  function cookie(name, value, maxAge) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
  }
  function effectiveCookie(req, res, name) {
    let value = cookies(req)[name] || '';
    // Authentication replies may already have replaced or cleared the session.
    // Bind the returned CSRF token to that new cookie, not the incoming cookie.
    const pending = res?.getHeader('Set-Cookie');
    for (const item of Array.isArray(pending) ? pending : pending ? [pending] : []) {
      if (item.startsWith(`${name}=`)) value = item.slice(name.length + 1).split(';', 1)[0];
    }
    return value;
  }
  function sessionHash(req, res) {
    const value = effectiveCookie(req, res, sessionName);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? hash(value) : '';
  }
  function requestToken(req, res, seed = effectiveCookie(req, res, csrfName)) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(seed)) return '';
    return createHmac('sha256', config.sessionEncryptionKey)
      .update(`shadowbridge-csrf:v1:${seed}:${sessionHash(req, res)}`).digest('base64url');
  }
  function seal(value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', config.sessionEncryptionKey, nonce);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function unseal(value) {
    const packed = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', config.sessionEncryptionKey, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
  }
  async function provider(route, { method = 'GET', body, accessToken } = {}) {
    let response;
    try {
      response = await fetch(`${authBase}${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { apikey: config.supabaseAnonKey, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new AuthError('Authentication service is temporarily unavailable', 503, 'auth_unavailable'); }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 429) throw new AuthError('Too many attempts. Please try again later.', 429, 'rate_limited');
      throw new AuthError('Authentication request could not be completed', response.status >= 500 ? 503 : 401);
    }
    return data;
  }
  async function publicIdentity(tokens, sessionIdHash, recoveryOnly) {
    // GoTrue validates signature, revocation and expiry. Claims are read only AFTER
    // that validation; browser-supplied JWTs are never accepted by this service.
    const user = await provider('/user', { accessToken: tokens.access_token });
    const claims = decodeClaims(tokens.access_token);
    if (!user.id || claims.sub !== user.id || !['aal1', 'aal2'].includes(claims.aal) || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) throw new AuthError('Invalid authentication session');
    const mfaVerifiedAt = Math.max(0, ...(Array.isArray(claims.amr) ? claims.amr : []).filter(item=>item?.method==='totp' && Number.isInteger(item.timestamp)).map(item=>item.timestamp));
    return {
      id: user.id, email: user.email, emailVerified: Boolean(user.email_confirmed_at),
      aal: claims.aal, mfaVerifiedAt, sessionIdHash, recoveryOnly: Boolean(recoveryOnly),
    };
  }
  function normalizedTokens(tokens) {
    if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') throw new AuthError('Authentication did not issue a session');
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: tokens.expires_at || Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600) };
  }
  async function audit(userId, event) {
    await pool.query('SELECT sb.record_auth_event($1,$2)', [userId, event]);
  }
  async function createSession(tokens, res, recoveryOnly = false, previousHash = null, event = 'login') {
    const stored = normalizedTokens(tokens);
    const sessionId = opaque(), sessionIdHash = hash(sessionId);
    const identity = await publicIdentity(stored, sessionIdHash, recoveryOnly);
    const lifetime = recoveryOnly ? Math.min(900, config.sessionLifetimeSeconds) : config.sessionLifetimeSeconds;
    await pool.query('INSERT INTO sb.sessions (id_hash,user_id,encrypted_tokens,recovery_only,expires_at) VALUES ($1,$2,$3,$4,$5)', [sessionIdHash, identity.id, seal(stored), recoveryOnly, new Date(Date.now() + lifetime * 1000)]);
    try { if (event) await audit(identity.id, event); }
    catch (error) { await pool.query('DELETE FROM sb.sessions WHERE id_hash=$1', [sessionIdHash]); throw error; }
    if (previousHash) await pool.query('DELETE FROM sb.sessions WHERE id_hash=$1', [previousHash]);
    appendCookie(res, cookie(sessionName, sessionId, lifetime));
    return identity;
  }
  async function getStored(idHash) {
    const { rows } = await pool.query('SELECT id_hash,user_id,encrypted_tokens,recovery_only,expires_at FROM sb.sessions WHERE id_hash=$1 AND expires_at > now()', [idHash]);
    if (!rows[0]) throw new AuthError('Please sign in again');
    let tokens;
    try { tokens = unseal(rows[0].encrypted_tokens); } catch { throw new AuthError('Invalid server session'); }
    return { row: rows[0], tokens };
  }
  async function tokensFor(identity) {
    if (!identity?.sessionIdHash) throw new AuthError('Please sign in');
    const stored = await getStored(identity.sessionIdHash);
    if (stored.row.user_id !== identity.id) throw new AuthError('Invalid session');
    return stored.tokens;
  }
  function assertNormal(identity) {
    if (!identity || identity.recoveryOnly) throw new AuthError('Please sign in normally before using this function');
  }

  return Object.freeze({
    csrf(req, res) {
      let seed = effectiveCookie(req, res, csrfName);
      if (!/^[A-Za-z0-9_-]{43}$/.test(seed)) seed = opaque();
      // Reads in another tab must not invalidate an existing form. The seed is
      // stable; changing the authenticated session changes the derived token.
      appendCookie(res, cookie(csrfName, seed, config.sessionLifetimeSeconds));
      res.setHeader('Cache-Control', 'no-store');
      return { csrfToken: requestToken(req, res, seed) };
    },
    enforceSession(req) {
      const expected = req.headers['x-session-token'];
      if (expected !== undefined && !equal(requestToken(req), expected)) {
        throw new AuthError('The browser session changed. Reload this page before continuing.', 409, 'session_changed');
      }
    },
    enforceCSRF(req) {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
      if (req.headers.origin !== config.appUrl || !equal(requestToken(req), req.headers['x-csrf-token'])) throw new AuthError('Request origin or CSRF token is invalid', 403, 'csrf_failed');
    },
    async register({ email, password, registrationIntent }) {
      await provider('/signup', { method: 'POST', body: { email, password,
        ...(registrationIntent ? { data: { sb_registration_intent: registrationIntent } } : {}) } });
      // A signup result is not proof of an authenticated identity. In particular,
      // repeated signups can return an existing unconfirmed provider user ID.
      // Never expose it to callers as an authorization principal.
      return { verificationRequired: true };
    },
    async login({ email, password }, res, req) {
      const tokens = await provider('/token?grant_type=password', { method: 'POST', body: { email, password } });
      return createSession(tokens, res, false, req ? sessionHash(req) || null : null);
    },
    async authenticate(req) {
      const sessionId = cookies(req)[sessionName];
      if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
      const idHash = hash(sessionId);
      // Serialize refresh rotation per opaque session to prevent refresh-token races.
      const previous = locks.get(idHash) || Promise.resolve();
      const work = previous.catch(() => {}).then(async () => {
        try {
          let { row, tokens } = await getStored(idHash);
          if (tokens.expires_at < Date.now() / 1000 + 60) {
            tokens = normalizedTokens(await provider('/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: tokens.refresh_token } }));
            await pool.query('UPDATE sb.sessions SET encrypted_tokens=$1 WHERE id_hash=$2', [seal(tokens), idHash]);
          }
          const identity = await publicIdentity(tokens, idHash, row.recovery_only);
          if (identity.id !== row.user_id) throw new AuthError('Invalid session owner');
          return identity;
        } catch (error) {
          if (error.status === 503) throw error;
          await pool.query('DELETE FROM sb.sessions WHERE id_hash=$1', [idHash]);
          return null;
        }
      });
      locks.set(idHash, work);
      try { return await work; } finally { if (locks.get(idHash) === work) locks.delete(idHash); }
    },
    async logout(identity, res) {
      if (identity) {
        try { const tokens = await tokensFor(identity); await provider('/logout?scope=local', { method: 'POST', accessToken: tokens.access_token }); } catch {}
        await pool.query('DELETE FROM sb.sessions WHERE id_hash=$1', [identity.sessionIdHash]);
        await audit(identity.id, 'logout');
      }
      appendCookie(res, cookie(sessionName, '', 0));
      appendCookie(res, cookie(csrfName, '', 0));
    },
    async requestRecovery({ email }) {
      try { await provider('/recover', { method: 'POST', body: { email } }); }
      catch (error) { if (error.status === 503 || error.status === 429) throw error; }
      return { accepted: true };
    },
    async confirmEmail({ token, tokenHash }, res, req) {
      const tokens = await provider('/verify', { method: 'POST', body: { token_hash: tokenHash || token, type: 'signup' } });
      return createSession(tokens, res, false, req ? sessionHash(req) || null : null, 'email_verified');
    },
    async confirmRecovery({ token, tokenHash }, res, req) {
      const tokens = await provider('/verify', { method: 'POST', body: { token_hash: tokenHash || token, type: 'recovery' } });
      return createSession(tokens, res, true, req ? sessionHash(req) || null : null, null);
    },
    async updatePassword(identity, { password }, res) {
      if (!identity) throw new AuthError('Please verify the password recovery email');
      if (!identity.recoveryOnly) throw new AuthError('Verify your requested recovery email before setting a new password.', 403, 'recovery_required');
      const protectedOwner=await db.asUser(identity,{aal:identity.aal},async tx=>(await tx.query("SELECT EXISTS(SELECT 1 FROM sb.staff_role_assignments WHERE user_id=$1 AND role_key='owner' AND active) AS protected",[identity.id])).rows[0].protected);
      if(protectedOwner)throw new AuthError('Owner authentication recovery requires the controlled infrastructure recovery procedure. No password or MFA method was changed.',403,'owner_recovery_controlled');
      const tokens = await tokensFor(identity);
      await provider('/user', { method: 'PUT', accessToken: tokens.access_token, body: { password } });
      // Revoke every BFF session after password change. A fresh normal login is required.
      await pool.query('DELETE FROM sb.sessions WHERE user_id=$1', [identity.id]);
      await audit(identity.id, 'password_changed');
      try { await provider('/logout?scope=global', { method: 'POST', accessToken: tokens.access_token }); } catch {}
      appendCookie(res, cookie(sessionName, '', 0));
      return { updated: true, signInRequired: true };
    },
    async listFactors(identity) {
      assertNormal(identity);
      const tokens = await tokensFor(identity);
      const user = await provider('/user', { accessToken: tokens.access_token });
      return (user.factors || []).filter((factor) => factor.factor_type === 'totp').map(({ id, factor_type, status, friendly_name }) => ({ id, factor_type, status, friendly_name }));
    },
    async enrollFactor(identity) {
      assertNormal(identity);
      const tokens = await tokensFor(identity);
      const result = await provider('/factors', { method: 'POST', accessToken: tokens.access_token, body: { factor_type: 'totp', friendly_name: 'ShadowBridge management' } });
      return { id: result.id, type: result.type, totp: result.totp };
    },
    async verifyFactor(identity, { factorId, code }, res) {
      assertNormal(identity);
      if (typeof factorId !== 'string' || !/^[a-f0-9-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) throw new AuthError('Invalid authenticator code', 400);
      const tokens = await tokensFor(identity);
      const challenge = await provider(`/factors/${factorId}/challenge`, { method: 'POST', accessToken: tokens.access_token, body: {} });
      const result = await provider(`/factors/${factorId}/verify`, { method: 'POST', accessToken: tokens.access_token, body: { challenge_id: challenge.id, code } });
      const upgraded = await createSession(result, res, false, identity.sessionIdHash, 'mfa_verified');
      if (upgraded.aal !== 'aal2') throw new AuthError('Strong authentication could not be established');
      return upgraded;
    },
  });
}
