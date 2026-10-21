// Host-only recovery tooling. Never added to the application image or exposed
// through HTTP. Backups include Auth, MFA, sessions and private configuration.
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, open, rm, copyFile, chmod } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging, readEnv, repositoryRoot } from './staging-prepare.mjs';

const magic = Buffer.from('SB-BACKUP-01\0');
const headerLength = magic.length + 12;
const configFiles = ['compose.env','postgres.env','auth.env','app.env','migration.env','tester-password','Caddyfile','manifest.json',
  ...['internal-ca.crt','internal-ca.key','postgres.crt','postgres.key','auth-proxy.crt','auth-proxy.key','public.crt','public.key'].map(name => `certs/${name}`)];
const archiveFiles = ['database.dump','backup.json',...configFiles.map(name => `configuration/${name}`)];
const hash = value => createHash('sha256').update(value).digest('hex');
const envText = values => Object.entries(values).map(([key,value]) => `${key}=${value}`).join('\n')+'\n';
const guard = (condition, message) => { if (!condition) throw new Error(message); };

async function privatePath(value, { existing = false, file = false } = {}) {
  const target = path.resolve(repositoryRoot, value || '');
  const base = path.join(repositoryRoot,'.local');
  guard(target.startsWith(base + path.sep) && target !== base, 'Recovery paths must remain under the ignored .local directory.');
  let cursor=target;
  while(cursor !== repositoryRoot) {
    try { guard(!(await lstat(cursor)).isSymbolicLink(), 'Recovery symlinks are refused.'); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
    cursor=path.dirname(cursor);
  }
  if(existing) {
    const info=await lstat(target);
    guard(file ? info.isFile() : info.isDirectory(), 'Unexpected recovery file type.');
    guard((info.mode & 0o777) === (file ? 0o600 : 0o700), 'Recovery files must be 0600 and directories 0700.');
  }
  return target;
}
async function ensurePrivateParent(file) {
  const parent=await privatePath(path.dirname(file));
  await mkdir(parent,{recursive:true,mode:0o700});
  guard(((await lstat(parent)).mode & 0o777) === 0o700,'Recovery output directory must be private (0700).');
}
async function keyBytes(file, create=false) {
  const target=await privatePath(file);
  if(create) {
    await ensurePrivateParent(target);
    try { await writeFile(target,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600}); }
    catch(error) { if(error.code !== 'EEXIST') throw error; }
  }
  await privatePath(target,{existing:true,file:true});
  const text=(await readFile(target,'utf8')).trim();
  guard(/^[0-9a-f]{64}$/.test(text),'Recovery key must contain exactly 32 random bytes in hexadecimal.');
  return Buffer.from(text,'hex');
}

export async function encryptArchive({archiveFile,backupFile,keyFile}) {
  await privatePath(archiveFile,{existing:true,file:true});
  const target=await privatePath(backupFile);
  const keyPath=await privatePath(keyFile);
  guard(target !== path.resolve(archiveFile) && target !== keyPath && path.resolve(archiveFile)!==keyPath,'Backup, source and recovery key must be separate files.');
  await ensurePrivateParent(target);
  const key=await keyBytes(keyFile,true);
  const nonce=randomBytes(12), header=Buffer.concat([magic,nonce]);
  const cipher=createCipheriv('aes-256-gcm',key,nonce); cipher.setAAD(header);
  const handle=await open(target,'wx',0o600);
  try {
    await handle.write(header);
    await pipeline(createReadStream(archiveFile),cipher,createWriteStream(target,{fd:handle.fd,autoClose:false,start:header.length}));
    await handle.write(cipher.getAuthTag(),0,16,(await handle.stat()).size);
    await handle.sync();
  } catch { await handle.close().catch(()=>{}); await rm(target,{force:true}); throw new Error('Encrypted backup failed; no valid backup was published.'); }
  finally { key.fill(0); await handle.close().catch(()=>{}); }
  return {backupFile:target,keyFile:keyPath};
}

export async function decryptArchive({backupFile,keyFile,archiveFile}) {
  const source=await privatePath(backupFile,{existing:true,file:true});
  const target=await privatePath(archiveFile);
  await ensurePrivateParent(target);
  const key=await keyBytes(keyFile);
  const input=await open(source,'r'), output=await open(target,'wx',0o600);
  try {
    const size=(await input.stat()).size;
    guard(size > headerLength+16,'Invalid encrypted backup envelope.');
    const header=Buffer.alloc(headerLength), tag=Buffer.alloc(16);
    await input.read(header,0,header.length,0); await input.read(tag,0,16,size-16);
    guard(header.subarray(0,magic.length).equals(magic),'Unknown encrypted backup format.');
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(magic.length));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    await pipeline(createReadStream(source,{start:headerLength,end:size-17}),decipher,createWriteStream(target,{fd:output.fd,autoClose:false}));
    await output.sync();
  } catch { await output.close().catch(()=>{}); await rm(target,{force:true}); throw new Error('Backup authentication failed. Wrong key, damaged or untrusted archive; nothing was restored.'); }
  finally { key.fill(0); await input.close().catch(()=>{}); await output.close().catch(()=>{}); }
  return target;
}

// Strictly parse the USTAR produced by this tool. No tar extraction command,
// symlink, path traversal, special device or unknown entry is accepted.
async function extractArchive(archiveFile,destination) {
  const input=await open(archiveFile,'r'); const seen=new Set();
  try {
    const total=(await input.stat()).size; let offset=0;
    for(;;) {
      const header=Buffer.alloc(512), result=await input.read(header,0,512,offset);
      guard(result.bytesRead===512,'Truncated backup archive.');
      if(header.every(byte=>byte===0)) break;
      const rawName=header.subarray(0,100), end=rawName.indexOf(0);
      const name=rawName.subarray(0,end<0?100:end).toString('utf8');
      const octal=header.subarray(124,136).toString('ascii').replace(/\0.*$/,'').trim();
      const size=/^[0-7]+$/.test(octal)?Number.parseInt(octal,8):NaN;
      const type=header[156];
      const checksum=Number.parseInt(header.subarray(148,156).toString('ascii').replace(/\0.*$/,'').trim(),8);
      const actual=[...header].reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
      guard(checksum===actual && header.subarray(257,262).toString()==='ustar','Invalid backup tar header.');
      guard(archiveFiles.includes(name) && !seen.has(name) && [0,48].includes(type) && header.subarray(345,500).every(byte=>byte===0),'Backup archive contains a forbidden path or file type.');
      guard(Number.isSafeInteger(size) && size>=0 && size<=(name==='database.dump'?64*1024**3:5*1024**2) && offset+512+size<=total,'Invalid backup entry size.');
      seen.add(name);
      const target=path.join(destination,name); await mkdir(path.dirname(target),{recursive:true,mode:0o700});
      const file=await open(target,'wx',0o600);
      try {
        let copied=0;
        while(copied<size) {
          const chunk=Buffer.alloc(Math.min(65536,size-copied));
          const read=await input.read(chunk,0,chunk.length,offset+512+copied);
          guard(read.bytesRead>0,'Truncated backup entry.');
          await file.write(chunk.subarray(0,read.bytesRead)); copied+=read.bytesRead;
        }
      } finally {await file.close();}
      offset+=512+Math.ceil(size/512)*512;
    }
    guard(seen.size===archiveFiles.length,'Backup archive is incomplete.');
  } finally {await input.close();}
}

export async function backupStaging({directory,backupFile,keyFile}) {
  const checked=await checkStaging({directory});
  guard(backupFile && keyFile,'Specify separate backup and recovery-key paths.');
  const work=path.join(repositoryRoot,'.local',`backup-work-${randomBytes(8).toString('hex')}`);
  await mkdir(work,{mode:0o700});
  try {
    const composeEnv=await readEnv(path.join(checked.directory,'compose.env'));
    const composeArgs=['--context','default','compose','--project-name',checked.project,'--env-file',path.join(checked.directory,'compose.env'),'-f',path.join(repositoryRoot,'deploy/staging/compose.yaml')];
    const options={cwd:repositoryRoot,env:{...process.env,...composeEnv},encoding:'utf8',stdio:['ignore','pipe','pipe']};
    let running;
    try {running=execFileSync('docker',[...composeArgs,'ps','--status','running','--services'],options).trim().split('\n');}
    catch {throw new Error('Could not verify the private backup installation.');}
    guard(running.includes('postgres') && !running.includes('app') && !running.includes('auth'),'Stop only this installation app and auth before a recovery backup. PostgreSQL must remain running.');
    await mkdir(path.join(work,'configuration'),{mode:0o700});
    for(const name of configFiles) {
      const source=path.join(checked.directory,name), target=path.join(work,'configuration',name);
      const info=await lstat(source); guard(info.isFile() && !info.isSymbolicLink(),'Configuration backup refuses nonregular files.');
      await mkdir(path.dirname(target),{recursive:true,mode:0o700}); await copyFile(source,target); await chmod(target,0o600);
    }
    const dump=await open(path.join(work,'database.dump'),'wx',0o600);
    try {execFileSync('docker',[...composeArgs,'exec','-T','postgres','pg_dump','-U','postgres','-d','shadowbridge','--format=custom','--no-password'],{...options,encoding:undefined,stdio:['ignore',dump.fd,'pipe']});}
    catch {throw new Error('Database dump failed. Existing database was not modified.');}
    finally {await dump.close();}
    const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const imageReferences=execFileSync('docker',[...composeArgs,'images','--format','json'],options).trim();
    await writeFile(path.join(work,'backup.json'),JSON.stringify({kind:'shadowbridge-recovery-v1',project:checked.project,createdAt:new Date().toISOString(),database:'shadowbridge',format:'pg_dump-custom',configurationIncluded:true,sourceCommit,imageReferences})+'\n',{flag:'wx',mode:0o600});
    const tar=path.join(work,'payload.tar');
    execFileSync('tar',['--format=ustar','-cf',tar,'--',...archiveFiles],{cwd:work,stdio:['ignore','pipe','pipe']}); await chmod(tar,0o600);
    return await encryptArchive({archiveFile:tar,backupFile,keyFile});
  } finally {await rm(work,{recursive:true,force:true});}
}

export async function decryptBackup({backupFile,keyFile,destination}) {
  const target=await privatePath(destination);
  guard(/^restore-[a-z0-9-]+$/.test(path.basename(target)),'Use a new .local/restore-* extraction directory.');
  await mkdir(target,{mode:0o700});
  const tar=path.join(target,'authenticated-payload.tar');
  try {
    await decryptArchive({backupFile,keyFile,archiveFile:tar});
    await extractArchive(tar,target); await rm(tar);
    const metadata=JSON.parse(await readFile(path.join(target,'backup.json'),'utf8'));
    guard(metadata.kind==='shadowbridge-recovery-v1' && metadata.database==='shadowbridge','Unsupported recovery package.');
    return {directory:target,databaseDump:path.join(target,'database.dump'),configuration:path.join(target,'configuration'),project:metadata.project};
  } catch(error) {await rm(target,{recursive:true,force:true}); throw new Error(error.message || 'Recovery verification failed; existing installations were not changed.');}
}

export async function restoreConfiguration({restoredDirectory,directory,project,httpsPort}) {
  const extracted=await privatePath(restoredDirectory,{existing:true});
  guard(/^restore-[a-z0-9-]+$/.test(path.basename(extracted)),'Use only an authenticated restore extraction.');
  const target=await privatePath(directory);
  guard(/^contabo-restore-[a-z0-9-]+$/.test(path.basename(target)) && /^shadowbridge-(?:contabo|stageg)-restore-[a-z0-9-]+$/.test(project),'Restore requires a new, distinct private restore project and directory.');
  const source=path.join(extracted,'configuration');
  const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
  guard(manifest.kind==='shadowbridge-private-contabo-v1' && manifest.project!==project,'Source and restore projects must be distinct.');
  for(const name of configFiles.filter(file=>file!=='manifest.json')) {
    const file=path.join(source,name); const info=await lstat(file);
    guard(info.isFile() && !info.isSymbolicLink() && hash(await readFile(file))===manifest.hashes[name],'Restored configuration fingerprint failed.');
  }
  const port=Number(httpsPort || manifest.httpsPort);
  guard(Number.isInteger(port)&&port>=1024&&port<=65535,'Invalid private restore HTTPS port.');
  // Refuse an existing Docker project/volume even when the target path is new.
  for(const [kind,format] of [['ps',['-aq']],['volume',['ls','-q']]]) {
    let existing;
    try {existing=execFileSync('docker',['--context','default',kind,...format,'--filter',`label=com.docker.compose.project=${project}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
    catch {throw new Error('Cannot prove restore target isolation; no installation created.');}
    guard(!existing,'Restore target already has containers or volumes; refusing to overwrite it.');
  }
  await mkdir(target,{mode:0o700});
  try {
    for(const name of configFiles) {const file=path.join(target,name);await mkdir(path.dirname(file),{recursive:true,mode:0o700});await copyFile(path.join(source,name),file);await chmod(file,name==='certs/internal-ca.crt'?0o644:0o600);}
    const origin=`https://localhost:${port}`;
    const compose=await readEnv(path.join(target,'compose.env')); Object.assign(compose,{STAGING_DIR:target,STAGING_PROJECT:project,STAGING_HTTPS_PORT:String(port)});
    await writeFile(path.join(target,'compose.env'),envText(compose));
    const app=await readEnv(path.join(target,'app.env'));app.APP_URL=origin;await writeFile(path.join(target,'app.env'),envText(app));
    const auth=await readEnv(path.join(target,'auth.env'));Object.assign(auth,{API_EXTERNAL_URL:origin,GOTRUE_SITE_URL:origin,GOTRUE_URI_ALLOW_LIST:`${origin}/auth/confirm,${origin}/auth/recover`});await writeFile(path.join(target,'auth.env'),envText(auth));
    Object.assign(manifest,{project,httpsPort:port,origin,restoredAt:new Date().toISOString()});
    for(const name of configFiles.filter(file=>file!=='manifest.json'))manifest.hashes[name]=hash(await readFile(path.join(target,name)));
    await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return await checkStaging({directory:target});
  } catch(error) {await rm(target,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.error('Host recovery tool: use the staging operations wrapper; no database reset or restore is automatic.');
  process.exitCode=1;
}
