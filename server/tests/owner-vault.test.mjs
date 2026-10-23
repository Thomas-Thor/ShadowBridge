import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultIntake, vaultEdit } from '../owner-vault.mjs';

const record = () => ({ company: { name: 'FICTIONAL Company', country: 'NO' },
  contact: { fullName: 'FICTIONAL Alex', workEmail: 'alex@example.invalid', emailKind: 'individual' },
  source: { system: 'manual', recordId: 'fictional-001' } });

test('Vault intake has explicit source, company and individual identity fields', () => {
  const p = vaultIntake(record());
  assert.equal(p.contact.emailKind, 'individual');
  assert.equal(p.company.registrationNumber, '');
  assert.equal(p.source.system, 'manual');
});
test('unknown identity confidence stays unknown; common names are accepted as separate inputs', () => {
  const a = record(), b = record(); delete a.contact.emailKind; b.company.name = 'Different FICTIONAL Company';
  assert.equal(vaultIntake(a).contact.emailKind, 'unknown');
  assert.equal(vaultIntake(a).contact.fullName, vaultIntake(b).contact.fullName);
});
test('intakes cannot set agent, OWNER, verification, contact id or executable extras', () => {
  for (const field of ['agentId','ownerId','verified','id','html']) assert.throws(() => vaultIntake({ ...record(), [field]: 'unauthorized' }));
  for (const field of ['id','verificationStatus','script']) assert.throws(() => { const r=record();r.contact[field]='injected';vaultIntake(r); });
});
test('URLs reject active schemes, credentials and tracking/query secrets', () => {
  for (const url of ['javascript:alert(1)', 'http://example.invalid', 'https://user:secret@example.invalid', 'https://example.invalid/?token=secret', 'https://example.invalid/#secret']) {
    const r=record();r.contact.professionalUrl=url;assert.throws(() => vaultIntake(r));
  }
});
test('malformed email, source, country and oversized fields are rejected', () => {
  for (const change of [r=>r.contact.workEmail='bad',r=>r.source.system='bad:source',r=>r.company.country='NOR',r=>r.contact.fullName='a'.repeat(201),r=>r.source.recordId='']) {
    const r=record();change(r);assert.throws(()=>vaultIntake(r));
  }
});
test('V2 edits whitelist mutable fields and preserve identity/provenance boundaries', () => {
  const p={fullName:'FICTIONAL Person',title:'Buyer',workEmail:'PERSON@EXAMPLE.INVALID',emailKind:'individual',professionalUrl:''};
  assert.equal(vaultEdit('contacts',p).workEmail,'person@example.invalid');
  for(const field of ['id','companyId','sourceSystem','verificationStatus','version','agentId']) assert.throws(()=>vaultEdit('contacts',{...p,[field]:'injected'}));
  const c={name:'FICTIONAL Company',sector:'Machinery',website:'https://company.invalid/',verificationStatus:'unconfirmed'};
  assert.equal(vaultEdit('companies',c).name,c.name);
  for(const field of ['country','registrationNumber','id','createdAt']) assert.throws(()=>vaultEdit('companies',{...c,[field]:'injected'}));
});
test('V2 edits reject malformed/oversized inputs and executable or credential-bearing URLs', () => {
  const p={fullName:'FICTIONAL Person',title:'',workEmail:'',emailKind:'unknown',professionalUrl:''};
  for(const change of [x=>x.fullName='',x=>x.fullName='a'.repeat(201),x=>x.workEmail='bad',x=>x.emailKind='verified',x=>x.professionalUrl='javascript:alert(1)',x=>x.professionalUrl='https://user:secret@example.invalid/']){const x={...p};change(x);assert.throws(()=>vaultEdit('contacts',x));}
});
