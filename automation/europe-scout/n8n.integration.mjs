// Real n8n 2.44.6 + native Data Tables. ALL registry responses are fictional.
// Creates/removes only a uniquely named local fixture; never reads existing n8n credentials.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildWorkflow } from './build-workflow.mjs';
import { scout } from './scout.mjs';

const exec = promisify(execFile);
const image = 'n8nio/n8n@sha256:d02752c6ab446ae9db8deec2f9cc887c378f77cdcad31650814df936b7386dfb';
const suffix = randomBytes(5).toString('hex'), name = `shadowbridge-scout-test-${suffix}`;
const docker = async (...args) => (await exec('docker', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
let container = false, network = false, base, cookie = '', project, table, passed = 0;
let fixtureHome;
const check = (label) => { passed++; console.log(`PASS ${label}`); };
const api = async (path, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(`${base}/rest${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const value = await r.json();
  assert(r.ok, `n8n REST ${path}: ${JSON.stringify(value)}`);
  return value.data;
};
const read = async () => {
  const result = await api(`/projects/${project}/data-tables/${table}/rows`);
  assert.equal(result.data.length, 1);
  return result.data[0];
};
const reset = async (s = JSON.parse(scout('seed', {}).state_json)) => {
  // Destructive only inside THIS newly created test container's SQLite Data Table.
  const row = await read();
  await api(`/projects/${project}/data-tables/${table}/rows`, {
    filter: { type: 'and', filters: [{ columnName: 'id', condition: 'eq', value: row.id }] },
    data: { revision: row.revision + 1, state_json: JSON.stringify(s) }, returnData: true,
  }, 'PATCH');
};
const create = async (modes = {}, approvals = true) => {
  const w = buildWorkflow();
  // Fixture-only endpoints and execution persistence; shipped workflow remains unchanged.
  w.name += ` fixture ${suffix}`;
  w.settings.saveManualExecutions = true; w.settings.saveDataErrorExecution = 'all'; w.settings.saveDataSuccessExecution = 'all';
  if (approvals) w.nodes.find(n => n.name === 'Source approvals').parameters.assignments.assignments[0].value = { NO: true, CZ: true };
  const h = w.nodes.find(n => n.name === 'Read public registry');
  h.parameters.url = `={{ 'http://127.0.0.1:18080/' + $('Draft reservation').item.json.query.country + '/' + (${JSON.stringify(modes) }[$('Draft reservation').item.json.query.country] || 'ok') + '?sector=' + $('Draft reservation').item.json.query.sector }}`;
  return (await api('/workflows', { ...w, projectId: project })).id;
};
const start = id => api(`/workflows/${id}/run`, { triggerToStartFrom: { name: 'Manual pilot' } });
const finish = async ({ executionId }) => {
  for (let i = 0; i < 160; i++) {
    const execution = await api(`/executions/${executionId}?includeData=true`);
    if (execution?.stoppedAt) {
      if (execution.status !== 'success') {
        // Print only diagnostic text; no session cookies, encryption or credential payloads.
        const entries = typeof execution.data === 'string' ? JSON.parse(execution.data) : [];
        console.error(entries.filter(x => typeof x === 'string' && /SCOUT:|Error|Invalid|not |Cannot|Missing/.test(x)).slice(0, 12));
      }
      assert.equal(execution.status, 'success', `execution ${executionId} failed`);
      return;
    }
    await delay(250);
  }
  throw Error('Fixture execution timed out');
};
const run = async (id) => { const execution = await start(id); await finish(execution); return execution.executionId; };
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${base}/rest/settings`);
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) return;
    } catch (error) { /* starting */ }
    if (i % 10 === 0 && (await docker('inspect', name, '--format', '{{.State.Running}}')) !== 'true') {
      throw Error('Fixture n8n exited during startup; inspect local Docker capacity.');
    }
    await delay(500);
  }
  throw Error('Fixture n8n REST startup timed out');
};
const fixture = `const http=require('node:http');http.createServer((req,res)=>{
  const u=new URL(req.url,'http://fixture'); const [country,mode]=u.pathname.slice(1).split('/');
  res.setHeader('content-type','application/json');
  if(mode==='429'){res.writeHead(429,{'retry-after':'172800'});return res.end('{}');}
  if(mode==='503'){res.writeHead(503);return res.end('{}');}
  if(mode==='timeout'){return;}
  if(mode==='malformed'){return res.end('{}');}
  const sector=u.searchParams.get('sector');const records=Array.from({length:25},(_,i)=>country==='NO'
    ?{organisasjonsnummer:String(999000000+i),navn:'FICTIONAL SCOUT Factory '+i,organisasjonsform:{kode:'AS'},forretningsadresse:{poststed:'TEST CITY'},naeringskode1:{kode:sector+'.100'}}
    :{ico:String(99000000+i),obchodniJmeno:'FICTIONAL SCOUT Factory '+i,pravniForma:'112',sidlo:{nazevObce:'TEST CITY'},czNace:[sector+'100']});
  res.end(JSON.stringify(country==='NO'?{_embedded:{enheter:records}}:{pocetCelkem:25,ekonomickeSubjekty:records}));
}).listen(18080,'127.0.0.1');`;

try {
  // Explicit subnet avoids Docker's exhausted default address pools; fail without touching others.
  const octet = 20 + randomBytes(1)[0] % 200;
  await docker('network', 'create', '--subnet', `10.244.${octet}.0/24`, name); network = true;
  fixtureHome = await mkdtemp(join(tmpdir(), 'shadowbridge-scout-fixture-'));
  await chmod(fixtureHome, 0o700);
  await docker('run', '-d', '--name', name, '--network', name, '-p', '127.0.0.1::5678',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '--mount', `type=bind,src=${fixtureHome},dst=/home/node`, '--tmpfs', '/tmp:rw,size=64m',
    '-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'N8N_VERSION_NOTIFICATIONS_ENABLED=false',
    '-e', 'N8N_PERSONALIZATION_ENABLED=false', '-e', 'N8N_SECURE_COOKIE=false',
    '-e', 'N8N_LOG_LEVEL=error', image);
  container = true;
  const port = JSON.parse(await docker('inspect', name))[0].NetworkSettings.Ports['5678/tcp'][0].HostPort;
  base = `http://127.0.0.1:${port}`;
  await ready();
  assert.equal(await docker('exec', name, 'n8n', '--version'), '2.44.6');
  const setup = await fetch(`${base}/rest/owner/setup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'scout-fixture@example.invalid', firstName: 'Fictional', lastName: 'Scout', password: randomBytes(24).toString('base64url') + 'aB1!' }) });
  assert(setup.ok); cookie = setup.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  project = (await api('/projects'))[0].id;
  table = (await api(`/projects/${project}/data-tables`, { name: 'shadowbridge_europe_scout_pilot_v1',
    columns: [{ name: 'scout_key', type: 'string' }, { name: 'revision', type: 'number' }, { name: 'state_json', type: 'string' }] })).id;
  await api(`/projects/${project}/data-tables/${table}/insert`, { data: [scout('seed', {})] });
  await docker('exec', '-d', name, 'node', '-e', fixture);
  await run(await create({}, false));
  assert.equal((await read()).revision, 0); check('exact 2.44.6 import and unapproved-source dry run; no writes');
  const ok = await create(); const firstExecution = await run(ok);
  let row = await read(), state = JSON.parse(row.state_json), day = Object.keys(state.days)[0];
  if (Object.keys(state.companies).length !== 50) {
    console.error('Fixture journal diagnostics', JSON.stringify({ revision: row.revision, days: state.days, sources: state.sources, events: state.events }));
    const execution = await api(`/executions/${firstExecution}?includeData=true`);
    const flat = JSON.parse(execution.data), cache = new Map();
    const decode = index => {
      if (cache.has(index)) return cache.get(index);
      const value = flat[index];
      if (value === null || typeof value !== 'object') return value;
      const result = Array.isArray(value) ? [] : {}; cache.set(index, result);
      for (const [key, item] of Object.entries(value)) result[key] = typeof item === 'string' && /^\d+$/.test(item) ? decode(Number(item)) : item;
      return result;
    };
    const runs = decode(0).resultData.runData;
    for (const name of ['Source approvals', 'Draft reservation', 'Reserve atomically', 'Reservation won', 'Read public registry', 'Draft commit']) {
      console.error(name, String(JSON.stringify(runs[name]?.map(x => x.data?.main?.map(output => output.map(item => ({ ...item.json, query: item.json.query ? { ...item.json.query, update: '[omitted]' } : undefined, result: item.json.result ? { ...item.json.result, update: '[omitted]' } : undefined })))))).slice(0, 2200));
    }
  }
  assert.equal(Object.keys(state.companies).length, 50); assert.equal(state.days[day].added, 50);
  assert.equal(state.events.filter(e => e.outcome === 'ok').length, 2);
  check('real HTTP → native Data Table CAS → 25 NO + 25 CZ, daily cap 50');
  await run(ok); assert.equal((await read()).revision, row.revision); check('repeat same day: no requests, duplicate candidates or budget overflow');
  // New calendar-day budget but same identities; imported candidates stay intact.
  state.days = {}; state.sources = {}; await reset(state); await run(ok);
  row = await read(); state = JSON.parse(row.state_json); day = Object.keys(state.days)[0];
  assert.equal(Object.keys(state.companies).length, 50); assert.equal(state.days[day].added, 0);
  check('persisted deduplication after a fresh budget, without deleting candidates');
  await reset(); await run(await create({ NO: '429', CZ: '503' }));
  state = JSON.parse((await read()).state_json);
  assert.equal(Object.keys(state.companies).length, 0);
  assert(state.sources.NO.nextAllowedAt > Date.now() + 170000000);
  assert(state.sources.CZ.nextAllowedAt > Date.now() + 800000);
  assert(state.events.every(e => e.outcome === 'deferred')); check('real 429 Retry-After and 503 persisted, other source still attempted');
  await reset(); await run(await create({ NO: 'timeout', CZ: 'malformed' }));
  state = JSON.parse((await read()).state_json);
  assert.equal(state.sources.CZ.blocked, true); assert.equal(Object.keys(state.companies).length, 0);
  assert(state.sources.NO.nextAllowedAt > Date.now()); check('real 15s HTTP timeout and schema error fail closed');
  // Competing executions prove actual native conditional UPDATE, not just in-memory simulation.
  await reset(); const a = await start(ok), b = await start(ok); await Promise.all([finish(a), finish(b)]);
  state = JSON.parse((await read()).state_json); day = Object.keys(state.days)[0];
  assert.equal(Object.keys(state.companies).length, 50); assert.equal(state.days[day].added, 50);
  assert.equal(state.days[day].requests, 2); check('two simultaneous real executions: exactly 50 unique candidates / 2 source calls');
  const preserved = await read(); await docker('restart', name);
  const restartedPort = JSON.parse(await docker('inspect', name))[0].NetworkSettings.Ports['5678/tcp'][0].HostPort;
  base = `http://127.0.0.1:${restartedPort}`; // Docker may reassign an ephemeral published port.
  await ready();
  assert.deepEqual(await read(), preserved); check('container restart preserves pilot journal');
  console.log(`RESULT ${passed} real n8n checks passed. Official source access NOT tested by this fixture.`);
} finally {
  if (container) await docker('rm', '-f', name);
  if (network) await docker('network', 'rm', name);
  if (fixtureHome) await rm(fixtureHome, { recursive: true, force: true });
}
