import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scout } from './scout.mjs';
import { buildWorkflow } from './build-workflow.mjs';

const time = { now: '2026-10-23T01:15:00Z', day: '2026-10-23' };
const seed = () => ({ id: 1, ...scout('seed', {}) });
const no = (id = '999000001', name = 'FICTIONAL Factory A') => ({ organisasjonsnummer: id, navn: name,
  organisasjonsform: { kode: 'AS' }, forretningsadresse: { poststed: 'TEST CITY' }, naeringskode1: { kode: '28.100', beskrivelse: 'FICTIONAL machinery' } });
const cz = (id = '99000001', name = 'FICTIONAL Factory B') => ({ ico: id, obchodniJmeno: name, pravniForma: '112', sidlo: { nazevObce: 'TEST CITY' }, czNace: ['28100'] });
const reserve = (row, country = 'NO', extra = {}) => scout('reserve', { rows: [row], job: { country, index: 0, sector: '28' },
  approvals: { NO: true, CZ: true }, execution: 'fixture', ...time, ...extra });
const apply = (row, update) => ({ ...row, revision: update.revision, state_json: update.state_json });
const commit = (row, query, response, extra = {}) => scout('commit', { rows: [row], query, response, ...time, ...extra });
const response = (country, rows) => ({ statusCode: 200, body: country === 'NO' ? { _embedded: { enheter: rows } } : { ekonomickeSubjekty: rows, pocetCelkem: rows.length } });
const ingest = (row, country, records, extra = {}) => {
  const q = reserve(row, country, extra);
  assert.equal(q.fetch, true);
  row = apply(row, q.update);
  return apply(row, commit(row, q, response(country, records), extra).update);
};
const state = row => JSON.parse(row.state_json);

test('artifact exactly matches generator; native nodes only, no credentials or CRM', async () => {
  const w = buildWorkflow();
  assert.deepEqual(JSON.parse(await readFile(new URL('./europe-b2b-scout-v1.json', import.meta.url))), w);
  assert.equal(w.active, false);
  assert.equal(w.settings.timezone, 'Europe/Oslo');
  assert.deepEqual(w.nodes.find(n => n.name === 'Source approvals').parameters.assignments.assignments[0].value, { NO: false, CZ: false });
  assert(w.nodes.every(n => !n.credentials && !/code|postgres|executeCommand|agent/i.test(n.type)));
  assert(w.nodes.filter(n => n.type.endsWith('.dataTable')).every(n => n.parameters.dataTableId.value === 'shadowbridge_europe_scout_pilot_v1'));
  assert.equal(w.nodes.find(n => n.name === 'Read public registry').retryOnFail, false);
});
test('unapproved sources perform no reservation or request', () => {
  assert.equal(reserve(seed(), 'NO', { approvals: { NO: false } }).fetch, false);
});
test('stable IDs deduplicate across reprocessing; similar names stay distinct', () => {
  let row = ingest(seed(), 'NO', [no(), no('999000002')]);
  row = ingest(row, 'NO', [no()], { now: '2026-10-24T01:15:00Z', day: '2026-10-24' });
  assert.equal(Object.keys(state(row).companies).length, 2);
  assert.equal(state(row).days['2026-10-24'].added, 0);
});
test('countries and identifiers do not merge on company name', () => {
  const row = ingest(ingest(seed(), 'NO', [no()]), 'CZ', [cz('99000001', 'FICTIONAL Factory A')]);
  assert.equal(Object.keys(state(row).companies).length, 2);
});
test('missing fields not invented; no employees, addresses or emails copied', () => {
  const r = no(); delete r.forretningsadresse;
  r.email = 'fictional@example.invalid'; r.dagligLeder = 'FICTIONAL PERSON'; r.hjemmeside = 'not-an-explicit-url';
  const company = state(ingest(seed(), 'NO', [r])).companies['NO:999000001'];
  assert.equal(company.city, null); assert.equal(company.website, null); assert.equal(company.status, 'review_required');
  assert.equal(company.surplusEvidence, 'not_provided_by_registry');
  assert(!JSON.stringify(company).includes('FICTIONAL PERSON')); assert(!JSON.stringify(company).includes('example.invalid'));
});
test('source-provided explicit website preserved; never inferred from company name', () => {
  const company = state(ingest(seed(), 'NO', [{ ...no(), hjemmeside: 'https://fictional.example.invalid/' }])).companies['NO:999000001'];
  assert.equal(company.website, 'https://fictional.example.invalid/'); assert.equal(company.status, 'unconfirmed');
});
test('invalid IDs, individuals, inactive entities, hospitality and absent names rejected', () => {
  const row = ingest(seed(), 'NO', [no('bad'), { ...no(), navn: '' }, { ...no(), organisasjonsform: { kode: 'ENK' } },
    { ...no(), konkurs: true }, { ...no(), naeringskode1: { kode: '55.100' } }]);
  assert.equal(Object.keys(state(row).companies).length, 0);
});
test('daily source quota and combined 50 cap', () => {
  let row = ingest(seed(), 'NO', Array.from({ length: 25 }, (_, i) => no(String(999000000 + i))));
  row = ingest(row, 'CZ', Array.from({ length: 25 }, (_, i) => cz(String(99000000 + i))));
  assert.equal(state(row).days[time.day].added, 50);
  assert.equal(reserve(row, 'NO', { now: '2026-10-23T02:00:00Z' }).fetch, false);
});
test('near-limit commit stores only available slots and retains partial page', () => {
  let row = seed(); const s = state(row); s.days[time.day] = { added: 49, requests: 0, bySource: {} }; row.state_json = JSON.stringify(s);
  const q = reserve(row); row = apply(row, q.update);
  row = apply(row, commit(row, q, response('NO', [no(), no('999000002')])).update);
  assert.equal(state(row).days[time.day].added, 50);
  assert.equal(state(row).cursors['NO:28'], undefined);
});
test('429 Retry-After seconds honored, no in-run aggressive retry', () => {
  let row = seed(); const q = reserve(row); row = apply(row, q.update);
  row = apply(row, commit(row, q, { statusCode: 429, headers: { 'retry-after': '172800' } }).update);
  assert.equal(state(row).sources.NO.nextAllowedAt, Date.parse(time.now) + 172800000);
  assert.equal(reserve(row, 'NO', { now: '2026-10-24T01:15:00Z', day: '2026-10-24' }).fetch, false);
  assert.equal(state(row).cursors['NO:28'], undefined);
});
test('Retry-After HTTP date honored; 5xx and timeout safely deferred', () => {
  for (const failure of [{ statusCode: 503, headers: { 'Retry-After': 'Sun, 25 Oct 2026 08:00:00 GMT' } }, { error: 'timeout' }]) {
    let row = seed(); const q = reserve(row); row = apply(row, q.update);
    row = apply(row, commit(row, q, failure).update);
    assert(state(row).sources.NO.nextAllowedAt >= Date.parse(time.now) + 900000);
    assert.equal(Object.keys(state(row).companies).length, 0);
    assert.equal(reserve(row).fetch, false);
    assert.equal(reserve(row, 'CZ').fetch, true);
  }
});
test('unrepresentably large Retry-After blocks source for manual review', () => {
  let row = seed(); const q = reserve(row); row = apply(row, q.update);
  row = apply(row, commit(row, q, { statusCode: 429, headers: { 'retry-after': '9'.repeat(400) } }).update);
  assert.equal(state(row).sources.NO.blocked, true);
  assert.equal(reserve(row, 'NO', { now: '2026-10-24T01:15:00Z', day: '2026-10-24' }).fetch, false);
});
test('malformed schema or permanent 4xx blocks only affected source', () => {
  for (const res of [{ statusCode: 200, body: {} }, { statusCode: 403, body: 'Forbidden' }]) {
    let row = seed(); const q = reserve(row); row = apply(row, q.update);
    row = apply(row, commit(row, q, res).update);
    assert.equal(state(row).sources.NO.blocked, true);
    assert.equal(reserve(row, 'CZ').fetch, true);
  }
});
test('CAS winner verification rejects empty/stale/other-worker update', () => {
  const row = seed(), q = reserve(row);
  assert.equal(scout('won', { rows: [apply(row, q.update)], update: q.update }), true);
  assert.equal(scout('won', { rows: [], update: q.update }), false);
  assert.equal(scout('won', { rows: [row], update: q.update }), false);
  assert.equal(scout('won', { rows: [{ ...apply(row, q.update), state_json: '{}' }], update: q.update }), false);
});
test('active source reservation excludes concurrent requests; expired reservation recovers', () => {
  let row = seed(); const q = reserve(row); row = apply(row, q.update);
  assert.equal(reserve(row).fetch, false);
  const next = reserve(row, 'NO', { now: '2026-10-23T01:18:00Z' });
  assert.equal(next.fetch, true);
  assert.throws(() => commit(apply(row, next.update), q, response('NO', [no()])), /Reservation/);
});
test('daily query budget bounded even if execution dies after reservation', () => {
  let row = seed();
  for (let i = 0; i < 4; i++) row = apply(row, reserve(row, 'NO', { now: `2026-10-23T0${i + 2}:15:00Z` }).update);
  assert.equal(reserve(row, 'NO', { now: '2026-10-23T09:15:00Z' }).fetch, false);
});
test('rotation uses Oslo calendar, covers both countries and all sectors', () => {
  const sectors = new Set(), orders = new Set();
  for (let i = 0; i < 10; i++) {
    const day = `2026-10-${String(20 + i).padStart(2, '0')}`;
    const jobs = scout('jobs', { rows: [seed()], now: `${day}T01:15:00Z`, day }).jobs;
    orders.add(jobs.map(x => x.country).join(',')); for (const job of jobs) sectors.add(job.sector);
  }
  assert.equal(sectors.size, 5); assert.equal(orders.size, 2);
  const zoneDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  assert.equal(zoneDay('2026-10-24T22:30:00Z'), '2026-10-25');
  assert.equal(zoneDay('2026-10-25T23:30:00Z'), '2026-10-26');
});
test('empty/multiple/malformed journals fail closed; pilot hard capacity stops', () => {
  assert.throws(() => scout('jobs', { rows: [], ...time }), /exactly one/);
  assert.throws(() => scout('jobs', { rows: [seed(), seed()], ...time }), /exactly one/);
  assert.throws(() => reserve({ ...seed(), state_json: '{}' }), /schema/);
  assert.throws(() => reserve({ ...seed(), state_json: JSON.stringify({ ...state(seed()), companies: [] }) }), /schema/);
  const row = seed(), s = state(row); for (let i = 0; i < 500; i++) s.companies[`NO:${i}`] = {};
  row.state_json = JSON.stringify(s); assert.equal(reserve(row).fetch, false);
});
