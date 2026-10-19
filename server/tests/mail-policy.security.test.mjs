import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMailRecipient } from '../mail-policy.mjs';

test('mail fails closed, exact approved recipients only; local capture permits fictional mail', () => {
  const approved = 'owner-test@shadowbridge.invalid';
  const config = {mailDeliveryMode:'allowlist',testEmailAllowlist:[approved]};
  assert.doesNotThrow(()=>assertMailRecipient(config,approved));
  assert.doesNotThrow(()=>assertMailRecipient(config,approved.toUpperCase()));
  for (const email of ['another@shadowbridge.invalid','prefix'+approved,'owner-test+alias@shadowbridge.invalid','owner-test@sub.shadowbridge.invalid']) assert.throws(()=>assertMailRecipient(config,email),error=>error.status===503 && error.code==='MAIL_NOT_ENABLED');
  assert.throws(()=>assertMailRecipient({mailDeliveryMode:'disabled'},approved),error=>error.status===503);
  assert.throws(()=>assertMailRecipient({},approved),error=>error.status===503);
  assert.doesNotThrow(()=>assertMailRecipient({mailDeliveryMode:'captured'},approved));
});
