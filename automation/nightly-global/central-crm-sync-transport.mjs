import {spawn} from 'node:child_process';

// Runs on the existing Contabo host, beneath an OS flock held for this SSH session.
// n8n keys and webhook auth arrive over encrypted stdin, never command arguments.
export async function syncRpcServer(workflowId) {
  const {createInterface} = await import('node:readline');
  const http = await import('node:http');
  const apiPath = '/api/v1/workflows/' + workflowId;
  const webhook = '/webhook/shadowbridge-global-b2b-sourcing-v1-canary';
  const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  process.stdout.write(JSON.stringify({ready: true, lockHeld: true}) + '\n');
  for await (const line of lines) {
    let id = null;
    try {
      if (Buffer.byteLength(line) > 2097152) throw Error('CRM_SYNC_RPC_INPUT_TOO_LARGE');
      const message = JSON.parse(line); id = message.id;
      const {method, route, headers = {}, body} = message;
      if (!Number.isSafeInteger(id) || id < 1) throw Error('CRM_SYNC_RPC_ID_INVALID');
      const allowed = method === 'GET' && (route === apiPath || route === '/healthz') ||
        method === 'PUT' && route === apiPath ||
        method === 'POST' && [apiPath + '/activate', apiPath + '/deactivate', webhook].includes(route);
      if (!allowed) throw Error('CRM_SYNC_RPC_ROUTE_BLOCKED');
      if (!Object.keys(headers).every(k => ['X-N8N-API-KEY', 'Authorization', 'Accept', 'Content-Type'].includes(k)) ||
        !Object.values(headers).every(v => typeof v === 'string' && !/[\r\n]/.test(v))) throw Error('CRM_SYNC_RPC_HEADERS_INVALID');
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const response = await new Promise((resolve, reject) => {
        const req = http.request({hostname: '127.0.0.1', port: 5678, method, path: route,
          headers: {Accept: 'application/json', ...headers, ...(payload ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)} : {})}}, res => {
          const parts = []; let length = 0;
          res.on('data', b => { length += b.length; if (length > 33554432) req.destroy(); else parts.push(b); });
          res.on('error', () => reject(Error('CRM_SYNC_RPC_RESPONSE_INTERRUPTED')));
          res.on('end', () => {
            let data = null;
            try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch {}
            resolve({status: res.statusCode, data});
          });
        });
        req.setTimeout(200000, () => req.destroy());
        req.on('error', () => reject(Error('CRM_SYNC_RPC_HTTP_UNCERTAIN')));
        if (payload) req.write(payload); req.end();
      });
      process.stdout.write(JSON.stringify({id, response}) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({id, error: /^CRM_SYNC_[A-Z0-9_]+$/.test(e.message) ? e.message : 'CRM_SYNC_RPC_FAILED'}) + '\n');
    }
  }
}

export function lockedRpcSource(workflowId) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(workflowId || '')) throw Error('CRM_SYNC_WORKFLOW_ID_REQUIRED');
  const server = '(' + syncRpcServer.toString() + ')(' + JSON.stringify(workflowId) + ').catch(()=>{process.exitCode=1;});';
  return `
    const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),cp=await import('node:child_process');
    const dir=path.join(os.homedir(),'.local/state/shadowbridge-sourcing-v1/central-crm-sync-lock');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const st=await fs.lstat(dir);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&511)!==448||await fs.realpath(dir)!==dir)throw Error('PRIVATE_LOCK_DIRECTORY_REQUIRED');
    const file=path.join(dir,'writer.lock');
    try{const fd=await fs.open(file,'wx',0o600);await fd.close();}catch(e){if(e.code!=='EEXIST')throw e;}
    const lock=await fs.lstat(file);
    if(!lock.isFile()||lock.isSymbolicLink()||lock.uid!==process.getuid()||(lock.mode&511)!==384)throw Error('PRIVATE_LOCK_FILE_REQUIRED');
    const child=cp.spawn('flock',['--nonblock','--',file,process.execPath,'--input-type=module','-e',${JSON.stringify(server)}],{stdio:'inherit'});
    child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
  `;
}

const quote = v => "'" + v.replaceAll("'", "'\\''") + "'";
export async function openLockedSyncTransport(target, workflowId) {
  if (!/^[a-z][a-z0-9_-]{0,31}@[A-Za-z0-9.-]{1,253}$/.test(target || '')) throw Error('CRM_SYNC_AUTHORIZED_SSH_REQUIRED');
  const command = 'node --input-type=module -e ' + quote(lockedRpcSource(workflowId));
  const child = spawn('ssh', ['-T', '-o', 'StrictHostKeyChecking=yes', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15', target, command], {stdio: ['pipe', 'pipe', 'inherit']});
  let buffer = '', seq = 0, pending = null, closed = false, startup;
  const fail = code => {
    const e = Error(code); closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(e); pending = null; }
    if (startup) { clearTimeout(startup.timer); startup.reject(e); startup = null; }
  };
  const ready = new Promise((resolve, reject) => { startup = {resolve, reject, timer: setTimeout(() => {fail('CRM_SYNC_SSH_OR_LOCK_UNAVAILABLE'); child.kill();}, 120000)}; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 35000000) { fail('CRM_SYNC_RPC_OUTPUT_TOO_LARGE'); child.kill(); return; }
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message; try { message = JSON.parse(line); } catch { fail('CRM_SYNC_RPC_OUTPUT_INVALID'); child.kill(); return; }
      if (startup && message.ready === true && message.lockHeld === true) { const s = startup; startup = null; clearTimeout(s.timer); s.resolve(); continue; }
      if (!pending || message.id !== pending.id) { fail('CRM_SYNC_RPC_SEQUENCE_INVALID'); child.kill(); return; }
      const p = pending; pending = null; clearTimeout(p.timer);
      if (message.error) p.reject(Error(/^CRM_SYNC_[A-Z0-9_]+$/.test(message.error) ? message.error : 'CRM_SYNC_RPC_FAILED'));
      else p.resolve(message.response);
    }
  });
  child.stdin.on('error', () => fail('CRM_SYNC_RPC_INPUT_UNCERTAIN'));
  child.on('error', () => fail('CRM_SYNC_SSH_FAILED'));
  child.on('close', () => {if (!closed) fail('CRM_SYNC_SSH_CLOSED');});
  await ready;
  return {
    request: message => new Promise((resolve, reject) => {
      if (closed || pending) { reject(Error('CRM_SYNC_SESSION_CLOSED_OR_BUSY')); return; }
      const id = ++seq;
      pending = {id, resolve, reject, timer: setTimeout(() => {fail('CRM_SYNC_RPC_OUTCOME_UNCERTAIN'); child.kill();}, 220000)};
      child.stdin.write(JSON.stringify({id, ...message}) + '\n');
    }),
    close: async () => {closed = true; child.stdin.end(); if (pending) fail('CRM_SYNC_CLOSED_WITH_PENDING_REQUEST');},
  };
}
