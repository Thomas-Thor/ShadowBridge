import pg from 'pg';

const { Pool } = pg;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only pass identities and AAL values obtained from a verified Auth response. */
export function createDatabase({ connectionString, sessionConnectionString, max = 10 } = {}) {
  if (!connectionString || !sessionConnectionString) throw new Error('Both restricted database connection strings are required');
  const pool = new Pool({ connectionString, max, application_name: 'shadowbridge-bff' });
  const sessionPool = new Pool({ connectionString: sessionConnectionString, max: 4, application_name: 'shadowbridge-sessions' });

  return {
    pool,
    sessionPool,
    async asUser(user, { aal = 'aal1' } = {}, callback) {
      const id = typeof user === 'string' ? user : user?.id;
      const mfaVerifiedAt = typeof user==='object' && Number.isInteger(user?.mfaVerifiedAt) && user.mfaVerifiedAt>0 ? String(user.mfaVerifiedAt) : '';
      if (!uuid.test(id ?? '') || !['aal1', 'aal2'].includes(aal) || typeof callback !== 'function') {
        throw new TypeError('A verified user UUID, AAL and callback are required');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', $2, true), set_config('request.jwt.claim.mfa_verified_at', $3, true), set_config('statement_timeout', '15000', true)", [id, aal,mfaVerifiedAt]);
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await Promise.all([pool.end(), sessionPool.end()]); },
  };
}
