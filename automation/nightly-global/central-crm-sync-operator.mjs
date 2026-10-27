import {readFile, writeFile, mkdir, lstat, realpath, rename, unlink, open} from 'node:fs/promises';
import {homedir, hostname} from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {buildClayCanary} from './build-clay-canary.mjs';
import {buildCentralCrmSync} from './build-central-crm-sync.mjs';
import {compareCanaryGraph, graphHash} from './n8n-workflow-graph.mjs';
import {openLockedSyncTransport} from './central-crm-sync-transport.mjs';
import {decodeSourceManifest, decodeBackup, validateBackupSet} from './central-crm-backup-input.mjs';
import {centralCrmSync} from './central-crm-sync-core.mjs';

const must = (v, code) => {if (!v) throw Error(code);};
const hash = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://automation.shadow-bridge.eu';
const atStage = async (stage, fn) => {try {return await fn();} catch (e) {if (!e.stage) e.stage = stage; throw e;}};
export async function privateDirectory(dir) {
  await mkdir(dir, {recursive: true, mode: 0o700});
  const s = await lstat(dir);
  must(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 511) === 448 && await realpath(dir) === dir, 'CRM_SYNC_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateRead(file) {
  const s = await lstat(file);
  must(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 511) === 384 && s.size <= 33554432, 'CRM_SYNC_PRIVATE_FILE_REQUIRED');
  return readFile(file, 'utf8');
}
async function hiddenInput(label) {
  must(process.stdin.isTTY, 'CRM_SYNC_PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');
  execFileSync('stty', ['-echo'], {stdio: ['inherit', 'ignore', 'ignore']});
  const rl = createInterface({input: process.stdin, output: process.stdout, terminal: false});
  try {
    let value = (await rl.question(label)).trim();
    if (value.startsWith('\x1b[200~') && value.endsWith('\x1b[201~')) value = value.slice(6, -6).trim();
    must(value.length > 0 && value.length <= 8192 && !/[\x00-\x1f\x7f-\x9f]/.test(value), 'CRM_SYNC_PRIVATE_INPUT_REQUIRED');
    return value;
  } finally {rl.close(); execFileSync('stty', ['echo'], {stdio: ['inherit', 'ignore', 'ignore']}); process.stdout.write('\n'); process.stdin.pause();}
}
async function readGithubBlob(file, token, repository) {
  const apiPath = 'repos/' + repository + '/git/blobs/' + file.blob;
  let data;
  if (!token) {
    try {data = JSON.parse(execFileSync('gh', ['api', apiPath], {encoding: 'utf8', maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000}));}
    catch {throw Error('CRM_SYNC_EXISTING_GITHUB_LOGIN_UNAVAILABLE');}
  } else {
    const response = await fetch('https://api.github.com/' + apiPath, {headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(30000)});
    must(response.ok, 'CRM_SYNC_PRIVATE_GITHUB_READ_DENIED');
    const parts = []; let size = 0;
    for await (const part of response.body) {size += part.length; must(size <= 2097152, 'CRM_SYNC_BACKUP_RESPONSE_TOO_LARGE'); parts.push(Buffer.from(part));}
    data = JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  must(data.sha === file.blob && data.encoding === 'base64' && typeof data.content === 'string', 'CRM_SYNC_GITHUB_BLOB_INVALID');
  return Buffer.from(data.content, 'base64');
}
export function legacyBody({spreadsheetId, googleId, ingressId}) {
  const template = buildClayCanary({spreadsheetId, googleCredentialId: googleId});
  for (const n of template.nodes) if (n.credentials?.googleSheetsOAuth2Api) n.credentials.googleSheetsOAuth2Api.name = 'Google Sheets account';
  const templateHash = hash(JSON.stringify(template, null, 2) + '\n');
  for (const n of template.nodes) if (n.credentials?.httpHeaderAuth) n.credentials.httpHeaderAuth.id = ingressId;
  return {templateHash, body: {name: template.name, nodes: template.nodes, connections: template.connections, settings: template.settings}};
}
export async function migrateWorkflow({api, current, expectedOld, desired, state, save, backup}) {
  let live = current;
  must(!live.settings?.errorWorkflow, 'CRM_SYNC_EXTERNAL_ERROR_FORWARDING_BLOCKED');
  const sameNew = compareCanaryGraph(desired, live).graphMatches;
  if (sameNew) {
    must(state.workflowBackup?.hash, 'CRM_SYNC_MIGRATION_BACKUP_REQUIRED');
    await backup('verify');
    state.graphUpdated = true; await save(state);
  } else {
    must(compareCanaryGraph(expectedOld, live).graphMatches, 'CRM_SYNC_EXISTING_GRAPH_CHANGED_NO_OVERWRITE');
    must(!state.graphUpdated, 'CRM_SYNC_GRAPH_REVERTED_REQUIRES_REVIEW');
    must(!['UPDATE_SENDING', 'UPDATE_UNCERTAIN'].includes(state.migrationPhase), 'CRM_SYNC_PREVIOUS_UPDATE_UNCERTAIN_NO_RETRY');
    if (!state.workflowBackup) {state.workflowBackup = await backup('create', live); await save(state);} else await backup('verify');
    if (live.active) {
      must(state.migrationPhase !== 'DEACTIVATE_SENDING', 'CRM_SYNC_PREVIOUS_DEACTIVATION_UNCERTAIN');
      state.migrationPhase = 'DEACTIVATE_SENDING'; await save(state);
      await api('POST', '/deactivate');
      live = await api('GET', ''); must(live.active === false, 'CRM_SYNC_DEACTIVATION_NOT_CONFIRMED');
    }
    state.migrationPhase = 'UPDATE_SENDING'; await save(state);
    try {await api('PUT', '', desired);} catch (e) {state.migrationPhase = 'UPDATE_UNCERTAIN'; await save(state); throw e;}
    live = await api('GET', '');
    must(compareCanaryGraph(desired, live).graphMatches && live.active === false, 'CRM_SYNC_NEW_GRAPH_NOT_CONFIRMED');
    state.graphUpdated = true; state.migrationPhase = 'UPDATED_INACTIVE'; await save(state);
  }
  if (!live.active) {
    must(state.migrationPhase !== 'ACTIVATE_SENDING', 'CRM_SYNC_PREVIOUS_ACTIVATION_UNCERTAIN');
    state.migrationPhase = 'ACTIVATE_SENDING'; await save(state);
    await api('POST', '/activate'); live = await api('GET', '');
  }
  must(live.active === true && compareCanaryGraph(desired, live).graphMatches, 'CRM_SYNC_ACTIVE_GRAPH_NOT_CONFIRMED');
  state.migrationPhase = 'ACTIVE'; await save(state);
  return live;
}
export async function restoreWorkflow({api, current, expectedOld, desired, original, state, save}) {
  const originalBody = {name: original.name, nodes: original.nodes, connections: original.connections, settings: original.settings};
  must(compareCanaryGraph(expectedOld, original).graphMatches, 'CRM_SYNC_ROLLBACK_BACKUP_GRAPH_INVALID');
  let live = current;
  const alreadyOld = compareCanaryGraph(expectedOld, live).graphMatches;
  must(alreadyOld || compareCanaryGraph(desired, live).graphMatches, 'CRM_SYNC_ROLLBACK_GRAPH_CHANGED_NO_OVERWRITE');
  if (live.active) {await api('POST', '/deactivate'); live = await api('GET', ''); must(live.active === false, 'CRM_SYNC_ROLLBACK_DEACTIVATION_NOT_CONFIRMED');}
  if (!alreadyOld) {
    must(state.restorePhase !== 'UPDATE_SENDING', 'CRM_SYNC_ROLLBACK_UPDATE_UNCERTAIN_NO_RETRY');
    state.restorePhase = 'UPDATE_SENDING'; await save(state);
    await api('PUT', '', originalBody); live = await api('GET', '');
  }
  must(live.active === false && compareCanaryGraph(expectedOld, live).graphMatches, 'CRM_SYNC_ROLLBACK_NOT_CONFIRMED');
  state.restorePhase = 'RESTORED_INACTIVE'; state.migrationPhase = 'ROLLED_BACK_INACTIVE'; state.graphUpdated = false; await save(state);
  return {status: 'CRM_SYNC_WORKFLOW_RESTORED_INACTIVE', crmRowsDeleted: 0, crmRowsModified: 0, sourcingScheduled: false};
}
export function validateReceipt(receipt, rows, batchId) {
  must(receipt && receipt.batchId === batchId && receipt.sourceRows === rows.length && receipt.schema === 'CENTRAL_CRM_V2' &&
    receipt.clayApiCalls === 0 && receipt.emailAddressesCollected === 0 && receipt.phoneNumbersCollected === 0 && receipt.sourcingScheduled === false, 'CRM_SYNC_RECEIPT_SCOPE_INVALID');
  for (const name of ['newCompanies', 'newContacts', 'duplicateContacts', 'reviewRequired']) must(Number.isInteger(receipt[name]) && receipt[name] >= 0 && receipt[name] <= rows.length, 'CRM_SYNC_RECEIPT_COUNTS_INVALID');
  must(receipt.newCompanies <= receipt.newContacts && receipt.newContacts + receipt.duplicateContacts + receipt.reviewRequired === rows.length, 'CRM_SYNC_RECEIPT_COUNTS_INVALID');
  must(Number.isInteger(receipt.crmWrites) && receipt.crmWrites >= 0 && receipt.crmWrites <= rows.length * 2 + 1, 'CRM_SYNC_RECEIPT_WRITES_INVALID');
  return receipt;
}
export async function synchronizeBatch({rows, batchId, call, state, save}) {
  const inputHash = hash(JSON.stringify(rows));
  must(!state.inputHash || state.inputHash === inputHash, 'CRM_SYNC_BATCH_INPUT_CHANGED');
  state.inputHash = inputHash;
  if (['VERIFIED', 'SKIPPED'].includes(state.phase)) return state.receipt;
  if (['SENDING', 'UNCERTAIN'].includes(state.phase)) {
    const receipt = validateReceipt(await call({mode: 'verify', batchId, rows}), rows, batchId);
    must(receipt.status === 'READBACK_CONFIRMED' && receipt.crmWrites === 0, 'CRM_SYNC_UNCERTAIN_WRITE_NOT_RECONCILED');
    must(receipt.originalCounts, 'CRM_SYNC_ORIGINAL_RECEIPT_REQUIRED');
    const original = validateReceipt({...receipt, ...receipt.originalCounts, crmWrites: 0}, rows, batchId);
    state.phase = 'VERIFIED'; state.receipt = {...original, recoveredAfterInterruption: true}; await save(state); return state.receipt;
  }
  const preview = validateReceipt(await call({mode: 'preview', batchId, rows}), rows, batchId);
  must(preview.status === 'PREVIEW_ONLY' && preview.crmWrites === 0, 'CRM_SYNC_PREVIEW_NOT_CONFIRMED');
  state.preview = preview;
  if (preview.newContacts === 0) {state.phase = 'SKIPPED'; state.receipt = preview; await save(state); return preview;}
  state.phase = 'SENDING'; await save(state);
  try {
    const receipt = validateReceipt(await call({mode: 'append', batchId, rows}), rows, batchId);
    must(receipt.status === 'CRM_SYNC_READBACK_CONFIRMED' && receipt.confirmedContacts >= receipt.newContacts, 'CRM_SYNC_WRITE_NOT_CONFIRMED');
    state.phase = 'VERIFIED'; state.receipt = receipt; await save(state); return receipt;
  } catch (e) {state.phase = 'UNCERTAIN'; await save(state); throw e;}
}
export async function main({release, projectId, googleId, spreadsheetId, sshTarget, backupRepository, backupManifestSha, backupManifestFile, restoreOnly = false}) {
  must(hostname() !== 'vmi3682957' && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'CRM_SYNC_OWNER_COMPUTER_AND_TLS_REQUIRED');
  must(/^[a-f0-9]{40}$/.test(release || ''), 'CRM_SYNC_PINNED_RELEASE_REQUIRED');
  for (const value of [projectId, googleId, spreadsheetId]) must(/^[A-Za-z0-9_-]{1,100}$/.test(value || ''), 'CRM_SYNC_PRIVATE_BINDINGS_REQUIRED');
  must(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(backupRepository || '') && /^[a-f0-9]{40}$/.test(backupManifestSha || ''), 'CRM_SYNC_PINNED_PRIVATE_MANIFEST_REQUIRED');
  const base = path.join(homedir(), '.local/state/shadowbridge-sourcing-v1'), dir = path.join(base, 'central-crm-sync');
  await privateDirectory(dir);
  const lockFile = path.join(dir, 'operation.lock'), nonce = randomUUID();
  const lock = await open(lockFile, 'wx', 0o600); await lock.writeFile(JSON.stringify({pid: process.pid, nonce, hostname: hostname()})); await lock.close();
  let transport;
  try {
    const legacy = JSON.parse(await privateRead(path.join(base, 'clay-canary/install.json')));
    const profile = JSON.parse(await privateRead(path.join(base, 'clay-canary/connection.json')));
    must(legacy.projectId === projectId && legacy.googleCredentialId === googleId && legacy.workflowId && legacy.ingestCredential?.id, 'CRM_SYNC_EXISTING_CHECKPOINT_BINDINGS_REQUIRED');
    must(/^[A-Za-z0-9_-]{1,100}$/.test(legacy.workflowId) && /^Bearer [A-Za-z0-9_-]{43}$/.test(profile.headerValue) && profile.webhookUrl === origin + '/webhook/shadowbridge-global-b2b-sourcing-v1-canary', 'CRM_SYNC_EXISTING_PROFILE_INVALID');
    const old = legacyBody({spreadsheetId, googleId, ingressId: legacy.ingestCredential.id});
    must(old.templateHash === legacy.templateSha && graphHash(old.body) === legacy.expectedWorkflowHash, 'CRM_SYNC_LEGACY_TEMPLATE_HASH_MISMATCH');
    const stateFile = path.join(dir, 'state.json'); let last = null, state = {};
    try {last = await privateRead(stateFile); state = JSON.parse(last);} catch (e) {if (e.code !== 'ENOENT') throw e;}
    const binding = {release, projectId, googleId, spreadsheetId, workflowId: legacy.workflowId, backupRepository, backupManifestSha};
    must(!state.binding || JSON.stringify(state.binding) === JSON.stringify(binding), 'CRM_SYNC_CHECKPOINT_BINDINGS_CHANGED');
    state.binding = binding; state.batches ||= {};
    const save = async () => {
      if (last !== null) must(await privateRead(stateFile) === last, 'CRM_SYNC_CHECKPOINT_CHANGED');
      else {try {await lstat(stateFile); throw Error('CRM_SYNC_CHECKPOINT_CHANGED');} catch (e) {if (e.code !== 'ENOENT') throw e;}}
      const value = JSON.stringify(state, null, 2) + '\n', temporary = stateFile + '.' + nonce;
      await writeFile(temporary, value, {mode: 0o600, flag: 'wx'}); await rename(temporary, stateFile); last = value;
    };
    await save();
    const rows = []; let githubToken = null;
    const getBlob = async file => {
      try {return await readGithubBlob(file, githubToken, backupRepository);} catch (error) {
        if (error.message !== 'CRM_SYNC_EXISTING_GITHUB_LOGIN_UNAVAILABLE') throw error;
        githubToken = await hiddenInput('Istniejący token GitHub do prywatnego backupu (ukryty): ');
        return readGithubBlob(file, githubToken, backupRepository);
      }
    };
    const manifestFile = path.join(dir, 'source-manifest.json'); let manifestBytes;
    try {manifestBytes = Buffer.from(await privateRead(manifestFile));} catch (e) {
      if (e.code !== 'ENOENT') throw e;
      must(backupManifestFile && path.isAbsolute(backupManifestFile), 'CRM_SYNC_LOCAL_MANIFEST_REQUIRED');
      manifestBytes = Buffer.from(await privateRead(backupManifestFile)); decodeSourceManifest(manifestBytes, backupManifestSha);
      await writeFile(manifestFile, manifestBytes, {mode: 0o600, flag: 'wx'});
    }
    const backupSource = decodeSourceManifest(manifestBytes, backupManifestSha);
    for (const file of backupSource.files) {
      const local = path.join(dir, file.name); let bytes;
      try {bytes = Buffer.from(await privateRead(local));} catch (e) {
        if (e.code !== 'ENOENT') throw e;
        bytes = await getBlob(file);
        decodeBackup(bytes, file);
        await writeFile(local, bytes, {mode: 0o600, flag: 'wx'});
      }
      rows.push(...decodeBackup(bytes, file));
    }
    githubToken = null; validateBackupSet(rows, backupSource.totalRows);
    for (let offset = 0; offset < rows.length; offset += 5) centralCrmSync('validate', {body: {mode: 'preview', batchId: 'preflight_batch_' + String(offset).padStart(4, '0'), rows: rows.slice(offset, offset + 5)}, now: new Date().toISOString()});
    const inputHash = hash(JSON.stringify(rows)); must(!state.inputHash || state.inputHash === inputHash, 'CRM_SYNC_SOURCE_SET_CHANGED'); state.inputHash = inputHash; await save();
    const key = await hiddenInput('Istniejący klucz n8n API (ukryty): ');
    transport = await atStage('operator.ssh.lock', () => openLockedSyncTransport(sshTarget, legacy.workflowId));
    const request = async (method, route, headers, body) => {
      const result = await transport.request({method, route, headers, body});
      must(result && Number.isInteger(result.status), 'CRM_SYNC_HTTP_RESPONSE_INVALID');
      if (result.status < 200 || result.status >= 300) {
        const e = Error(/^(?:CRM_SYNC_|GOOGLE_SHEETS_)[A-Z0-9_]{1,100}$/.test(result.data?.reason || '') ? result.data.reason : 'CRM_SYNC_HTTP_' + result.status);
        e.httpStatus = result.status;
        if (/^[a-z.]{1,60}$/.test(result.data?.stage || '')) e.stage = result.data.stage;
        throw e;
      }
      if (result.status === 204) return {};
      must(result.data && typeof result.data === 'object', 'CRM_SYNC_HTTP_JSON_REQUIRED'); return result.data;
    };
    const api = (method, suffix, body) => request(method, '/api/v1/workflows/' + legacy.workflowId + suffix, {'X-N8N-API-KEY': key}, body);
    const current = await atStage('workflow.read', () => api('GET', ''));
    must(current.id === legacy.workflowId && current.shared?.some(s => s.projectId === projectId && s.role === 'workflow:owner'), 'CRM_SYNC_TARGET_PROJECT_NOT_CONFIRMED');
    const desired = buildCentralCrmSync({spreadsheetId, googleCredentialId: googleId, ingestCredentialId: legacy.ingestCredential.id});
    const backup = async (mode, workflow) => {
      if (mode === 'verify') {must(state.workflowBackup && hash(await privateRead(state.workflowBackup.file)) === state.workflowBackup.hash, 'CRM_SYNC_WORKFLOW_BACKUP_NOT_CONFIRMED'); return state.workflowBackup;}
      const file = path.join(dir, 'workflow-before-' + nonce + '.json'), value = JSON.stringify(workflow, null, 2) + '\n';
      await writeFile(file, value, {mode: 0o600, flag: 'wx'}); must(hash(await privateRead(file)) === hash(value), 'CRM_SYNC_WORKFLOW_BACKUP_NOT_CONFIRMED');
      return {file, hash: hash(value), wasActive: workflow.active === true};
    };
    if (restoreOnly) {
      await backup('verify');
      const original = JSON.parse(await privateRead(state.workflowBackup.file));
      const result = await atStage('workflow.restore', () => restoreWorkflow({api, current, expectedOld: old.body, desired, original, state, save}));
      console.log(JSON.stringify({...result, workflowUrl: origin + '/workflow/' + legacy.workflowId})); return;
    }
    await atStage('workflow.migrate', () => migrateWorkflow({api, current, expectedOld: old.body, desired, state, save, backup}));
    console.log(JSON.stringify({status: 'CRM_SYNC_RECEIVER_UPDATED', workflowUrl: origin + '/workflow/' + legacy.workflowId, providerCalls: 0, sourcingScheduled: false}));
    const call = body => atStage('crm.request', () => request('POST', '/webhook/shadowbridge-global-b2b-sourcing-v1-canary', {Authorization: profile.headerValue}, {...body, protocol: 'CENTRAL_CRM_V2'}));
    const inspection = await call({mode: 'inspect', batchId: 'inspect_' + randomUUID(), rows: []});
    must(inspection.status === 'CRM_READ_CONFIRMED' && inspection.schema === 'CENTRAL_CRM_V2' && inspection.crmWrites === 0, 'CRM_SYNC_NATIVE_READ_NOT_CONFIRMED');
    console.log(JSON.stringify({...inspection, googleCredentialPermissionVerified: true}));
    if (!state.crmBackup) {
      const snapshot = await call({mode: 'backup', batchId: 'backup_' + randomUUID(), rows: []});
      must(snapshot.status === 'PRIVATE_CRM_BACKUP' && snapshot.privateSnapshot && snapshot.crmWrites === 0, 'CRM_SYNC_BACKUP_NOT_CONFIRMED');
      const file = path.join(dir, 'crm-before-' + nonce + '.json'), value = JSON.stringify(snapshot, null, 2) + '\n';
      await writeFile(file, value, {mode: 0o600, flag: 'wx'}); state.crmBackup = {file, hash: hash(value)}; await save();
    }
    must(hash(await privateRead(state.crmBackup.file)) === state.crmBackup.hash, 'CRM_SYNC_CRM_BACKUP_CHANGED');
    const totals = {sourceRows: 0, newCompanies: 0, newContacts: 0, duplicateContacts: 0, reviewRequired: 0, reviewReasons: {}};
    for (let offset = 0; offset < rows.length; offset += 5) {
      const batchId = 'sb_clay_' + backupSource.commit.slice(0, 12) + '_' + String(offset / 5).padStart(4, '0');
      state.batches[batchId] ||= {};
      const batchState = state.batches[batchId], batchRows = rows.slice(offset, offset + 5);
      const receipt = await synchronizeBatch({rows: batchRows, batchId, call, state: batchState, save});
      if (!state.canaryReplayVerified && batchState.phase === 'VERIFIED') {
        const replay = validateReceipt(await call({mode: 'append', batchId, rows: batchRows}), batchRows, batchId);
        must(replay.status === 'CRM_SYNC_READBACK_CONFIRMED' && replay.newContacts === 0 && replay.newCompanies === 0 && replay.crmWrites === 0, 'CRM_SYNC_DUPLICATE_REPLAY_NOT_PROVEN');
        state.canaryReplayVerified = true; await save();
        console.log(JSON.stringify({status: 'CRM_SYNC_CANARY_AND_ZERO_WRITE_REPLAY_CONFIRMED', batchId, newContacts: receipt.newContacts, reviewRequired: receipt.reviewRequired, replayCrmWrites: 0}));
      }
      for (const name of ['sourceRows', 'newCompanies', 'newContacts', 'duplicateContacts', 'reviewRequired']) totals[name] += receipt[name];
      for (const [reason, count] of Object.entries(receipt.reviewReasons || {})) totals.reviewReasons[reason] = (totals.reviewReasons[reason] || 0) + count;
      if ((offset / 5 + 1) % 25 === 0) console.log(JSON.stringify({status: 'CRM_SYNC_PROGRESS', processed: Math.min(offset + 5, rows.length), total: rows.length, newContacts: totals.newContacts, reviewRequired: totals.reviewRequired}));
    }
    const byId = new Map(rows.map(row => [row.sourceId, row]));
    const review = Object.entries(state.batches).flatMap(([batch, value]) => (value.receipt?.reviewItems || []).map(item => ({batchId: batch, reason: item.reason, row: byId.get(item.sourceId)})));
    const reviewFile = path.join(dir, 'review-' + nonce + '.json');
    await writeFile(reviewFile, JSON.stringify({sourceCommit: backupSource.commit, reviewedAutomatically: false, items: review}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    state.reviewFile = reviewFile; state.totals = totals; state.completedAt = new Date().toISOString(); await save();
    console.log(JSON.stringify({status: 'CRM_SYNC_COMPLETED_WITH_REVIEW_REPORT', ...totals, canaryReplayVerified: state.canaryReplayVerified === true,
      providerCalls: 0, emailAddressesCollected: 0, phoneNumbersCollected: 0, sourcingScheduled: false, workflowUrl: origin + '/workflow/' + legacy.workflowId, privateCheckpoint: stateFile, privateReviewReport: reviewFile}));
  } finally {
    await transport?.close();
    const currentLock = JSON.parse(await privateRead(lockFile));
    must(currentLock.nonce === nonce && currentLock.pid === process.pid, 'CRM_SYNC_LOCAL_LOCK_CHANGED'); await unlink(lockFile);
  }
}

export function reportFailure(e) {
  return {status: 'BLOCKED', reason: /^(?:CRM_SYNC_|GOOGLE_SHEETS_)[A-Z0-9_]{1,110}$/.test(e.message || '') ? e.message : 'CRM_SYNC_INTERRUPTED_CHECK_PRIVATE_CHECKPOINT',
    stage: /^[a-z.]{1,60}$/.test(e.stage || '') ? e.stage : 'operator', httpStatus: e.httpStatus ?? null, automaticRetry: false, checkpointRetained: true, liveSourcingClaimed: false};
}
