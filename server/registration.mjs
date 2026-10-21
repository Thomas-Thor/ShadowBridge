// Registration drafts are captured by PostgreSQL when GoTrue INSERTs the new
// identity. A signup response or a browser cookie is never an identity proof.
import { randomBytes, createHash } from 'node:crypto';

export function createRegistrationService({ db, auth }) {
  return Object.freeze({
    async register({ email, password, proposed }) {
      const nonce = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(nonce).digest('hex');
      // Commit before contacting GoTrue: its Auth transaction can then capture
      // exactly this attempt, even if confirmation happens before HTTP returns.
      // Keep intake after timeouts: the provider may still finish that request.
      await db.sessionPool.query('INSERT INTO sb.registration_intakes(token_hash,email,payload) VALUES($1,$2,$3::jsonb)', [hash, email, JSON.stringify(proposed)]);
      await auth.register({ email, password, registrationIntent: nonce });
    },
    async consume(identity, legacyRef = null) {
      if (!identity?.emailVerified || identity.recoveryOnly) return { state: 'unverified' };
      return db.asUser(identity, { aal: identity.aal }, async tx => {
        const active = (await tx.query('SELECT sb.account_active(true) AS active')).rows[0]?.active;
        if (!active) return { state: 'blocked' };
        return (await tx.query('SELECT sb.consume_registration_draft($1::text) AS draft', [legacyRef])).rows[0].draft;
      });
    },
    async state(identity) {
      if (!identity?.emailVerified || identity.recoveryOnly) return { state: 'unverified' };
      return db.asUser(identity, { aal: identity.aal }, async tx =>
        (await tx.query('SELECT sb.registration_draft_state() AS draft')).rows[0].draft);
    },
  });
}
