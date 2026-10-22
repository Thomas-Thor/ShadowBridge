// Pure payload/token and source guards; NOT an executed GoTrue recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {passwordPayload,recoveryIdentity,recoveryToken,adminPasswordRunner} from '../scripts/owner-password-recovery.mjs';

test('recovery changes only a strong password, never roles, email confirmation or factors',()=>{
  const password=randomBytes(24).toString('base64url');
  assert.deepEqual(passwordPayload(password),{password});
  for(const value of [undefined,'short','x'.repeat(129),'x'.repeat(20)+'\n'])assert.throws(()=>passwordPayload(value));
  assert.match(adminPasswordRunner,/\/auth\/v1\/admin\/users\//);
  assert.match(adminPasswordRunner,/JSON.stringify\(\{password:p.password\}\)/);
  assert.doesNotMatch(adminPasswordRunner,/email_confirm|\/factors|service_role|console\./);
});
test('short-lived admin JWT is signed in memory and contains no account or MFA claims',()=>{
  const secret=randomBytes(36).toString('hex'),token=recoveryToken(secret,1700000000),parts=token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(parts[0],'base64url')),{alg:'HS256',typ:'JWT'});
  assert.deepEqual(JSON.parse(Buffer.from(parts[1],'base64url')),{role:'service_role',aud:'authenticated',iat:1700000000,exp:1700000060});
  assert.equal(parts[2],createHmac('sha256',secret).update(parts[0]+'.'+parts[1]).digest('base64url'));
  assert.throws(()=>recoveryToken('short'));
});
test('explicit target and incident are required',()=>{
  assert.deepEqual(recoveryIdentity({email:'Owner@example.invalid',incident:'INC-2026-12345'}),{email:'owner@example.invalid',incident:'INC-2026-12345'});
  for(const input of [{},{email:'invalid',incident:'INC-2026-12345'},{email:'owner@example.invalid',incident:'short'},{email:'owner@example.invalid',incident:'INC-2026-12345\n'}])assert.throws(()=>recoveryIdentity(input));
});
test('host recovery requires existing OWNER and verified MFA, backs up before provider write and targets only its sessions',async()=>{
  const source=await readFile(new URL('../scripts/owner-password-recovery.mjs',import.meta.url),'utf8');
  assert.match(source,/r.role_key='owner' AND r.active/);
  assert.match(source,/email_confirmed_at IS NOT NULL/);
  assert.match(source,/factor_type='totp' AND status='verified'/);
  const backup=source.indexOf('await backupInstallation(directory)'),write=source.indexOf("run(['exec','-T','app'");assert.ok(backup>=0 && backup<write);
  assert.match(source,/DELETE FROM sb.sessions WHERE user_id=\$\{uid\}/);
  assert.match(source,/owner.password_recovery_started|audit\('started'\)/);
  assert.match(source,/audit\('completed'\)/);
  assert.match(source,/owner.password_recovery_failed/);
  assert.doesNotMatch(source,/DELETE FROM auth\.mfa|bootstrap_owner|UPDATE auth\.users/);
});
