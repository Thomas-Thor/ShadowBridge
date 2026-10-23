// Run by the owner ON the existing server. Never SSH, change DNS, bootstrap
// users, rotate existing keys, delete volumes or restore onto a live database.
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir, open, rm, mkdir, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import { networkInterfaces, hostname } from 'node:os';
import { isIP, createServer } from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging, readEnv, repositoryRoot } from './staging-prepare.mjs';
import { prepareProduction, checkProduction, productionOrigin } from './production-config.mjs';
import { backupInstallation, compose as privateCompose, composeArguments, restoredSentinelRoleSql } from './staging-ops.mjs';
import { decryptBackup, restoreConfiguration, encryptArchive, decryptArchive } from './staging-backup.mjs';
import { migrationSources, validateApplied } from './staging-migrate.mjs';
import { archiveHasVault, privateArchiveCatalog, restoredVaultRolesSql } from './vault-recovery-roles.mjs';

const guard = (ok, message) => { if (!ok) throw new Error(message); };
const safeDocker = (args, options = {}) => {
  try { return execFileSync('docker', ['--context', 'default', ...args], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 32 * 1024 ** 2, ...options }); }
  catch { throw new Error('Operacja Docker nie powiodła się. Zachowano kontenery, dane i kopie; sprawdź je lokalnie, nie publikuj surowych logów.'); }
};
export function publicComposeArguments(profile, args) {
  guard(/^shadowbridge-(?:contabo|stageg)-[a-z0-9-]+$/.test(profile.project), 'Niepoprawna tożsamość instalacji.');
  return ['compose', '--project-name', profile.project, '--env-file', path.join(profile.directory,'compose.env'),
    '-f', path.join(repositoryRoot,'deploy/production/compose.yaml'), ...(profile.gatewayOverride?['-f',profile.gatewayOverride]:[]), ...args];
}
export function publicCompose(profile, args) {
  return safeDocker(publicComposeArguments(profile,args), { env: { ...process.env, ...profile.composeEnvironment } }).trim();
}
const psql = (directory, sql) => privateCompose(directory, ['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',sql], { capture:true });

// A newer repository checkpoint describes an existing STATIC public Caddy at
// /opt/shadowbridge-public. Recognize only that exact installation; never stop
// an unrelated service just because it owns port 80/443.
export function isLegacyPublicGateway(container) {
  const labels=container?.Config?.Labels||{};
  const files=(labels['com.docker.compose.project.config_files']||'').split(',');
  return labels['com.docker.compose.service']==='web'
    && labels['com.docker.compose.project.working_dir']==='/opt/shadowbridge-public'
    && files.includes('/opt/shadowbridge-public/compose.yaml')
    && /^\/?(?:docker[.]io\/library\/)?caddy(?::|@)/.test(container.Config.Image||'');
}

export function assertDnsRecords({ ipv4, addresses, ipv6 = [], aliases = [], localAddresses }) {
  guard(isIP(ipv4)===4 && localAddresses.includes(ipv4), 'Podaj publiczny IPv4 przypisany do TEGO serwera Contabo.');
  guard(addresses.length>0 && addresses.every(value=>value===ipv4) && !ipv6.length && !aliases.length,
    `DNS nie jest gotowy. W Porkbun ustaw rekord A dla @ na ${ipv4}; usuń sprzeczny CNAME dla @ i stare AAAA. Zachowaj MX/TXT. Następnie uruchom instalator ponownie. Niczego nie przełączono.`);
}
export async function checkDomain(ipv4) {
  const optional = async (fn, emptyCodes) => { try { return await fn('shadow-bridge.eu'); } catch(error) { if(emptyCodes.includes(error.code))return []; throw new Error('Nie można wiarygodnie odczytać DNS. Wdrożenie zatrzymane.'); } };
  const [addresses,ipv6,aliases] = await Promise.all([optional(resolve4,['ENODATA','ENOTFOUND']),optional(resolve6,['ENODATA','ENOTFOUND']),optional(resolveCname,['ENODATA','ENOTFOUND'])]);
  assertDnsRecords({ ipv4,addresses,ipv6,aliases,localAddresses:Object.values(networkInterfaces()).flat().filter(Boolean).map(item=>item.address) });
}

// Verify Gmail authentication over verified TLS, WITHOUT sending a message.
export async function checkGmail(password) {
  const socket = tls.connect({ host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true });
  socket.setTimeout(15000,()=>socket.destroy(new Error('SMTP timeout')));
  const lines=[], waiters=[]; let buffer='', failure;
  const fail = () => { failure=new Error('Gmail SMTP nie potwierdził bezpiecznego połączenia i hasła aplikacji. Sprawdź 2FA i hasło aplikacji. Nie wysłano wiadomości.'); while(waiters.length)waiters.shift().reject(failure); };
  socket.on('error',fail); socket.on('close',()=>{if(waiters.length)fail();});
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>65536){socket.destroy();fail();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(waiters.length)waiters.shift().resolve(line);else lines.push(line);}});
  const line = () => failure ? Promise.reject(failure) : lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve,reject)=>waiters.push({resolve,reject}));
  const response = async expected => {let value;do{value=await line();guard(/^\d{3}[- ]/.test(value),'Nieprawidłowa odpowiedź SMTP.');}while(value[3]==='-');guard(Number(value.slice(0,3))===expected,'Gmail odrzucił uwierzytelnienie SMTP; sprawdź hasło aplikacji. Nie wysłano wiadomości.');};
  try {
    await response(220); socket.write('EHLO shadow-bridge.eu\r\n'); await response(250);
    socket.write('AUTH LOGIN\r\n');await response(334);
    socket.write(Buffer.from('shadowbridge.trade@gmail.com').toString('base64')+'\r\n');await response(334);
    socket.write(Buffer.from(password).toString('base64')+'\r\n');await response(235);
    socket.write('QUIT\r\n');
  } finally { socket.destroy(); }
}

// Compare all application tables and security-critical GoTrue records without
// printing records, hashes, passwords, tokens, MFA material or personal data.
export async function databaseFingerprints(directory) {
  const tables = JSON.parse(await psql(directory,"SELECT json_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN ('sb','owner_vault','portal','auth')"));
  const result={};
  for(const table of tables) {
    guard(/^(?:sb|auth|owner_vault|portal)\.[a-z_]+$/.test(table),'Niepoprawna nazwa tabeli kopii.');
    result[table]=await psql(directory,`SELECT md5(coalesce(string_agg(value,',' ORDER BY value),'')) FROM (SELECT to_jsonb(t)::text AS value FROM ${table} t) rows`);
  }
  // An upgrade may ADD permission keys. Protect every existing key/flag while
  // allowing the reviewed migration to extend the permission catalog.
  const catalog=JSON.parse(await psql(directory,"SELECT coalesce(json_object_agg(key,md5(to_jsonb(t)::text)),'{}'::json) FROM sb.staff_permissions t"));
  for(const [key,value]of Object.entries(catalog))result['permission:'+key]=value;
  return result;
}
export function assertPreserved(before, after, { allowMigrationBackfill = false } = {}) {
  // A migration may create a new history table. Every pre-existing table must
  // retain its contents; catalog additions are checked per existing key.
  for(const [name,value] of Object.entries(before)) {
    if(allowMigrationBackfill && name==='sb.staff_permissions')continue;
    guard(after[name]===value,`Kontrola zachowania danych nie przeszła (${name}). Zatrzymaj aktualizację; nie przywracaj kopii na obecną bazę.`);
  }
}

async function freePort() {
  const server=createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
export async function proveBackup({ directory,backupFile,keyFile,expected }) {
  const source=await checkStaging({directory});
  const suffix=randomBytes(5).toString('hex');
  const extraction=path.join(repositoryRoot,'.local',`restore-production-${suffix}`);
  const recovery=path.join(repositoryRoot,'.local',`contabo-restore-production-${suffix}`);
  const recovered=await decryptBackup({backupFile,keyFile,destination:extraction});
  guard(recovered.project===source.project,'Kopia pochodzi z innego projektu. Nie odtworzono danych.');
  const target=await restoreConfiguration({restoredDirectory:extraction,directory:recovery,project:`shadowbridge-contabo-restore-${suffix}`,httpsPort:await freePort()});
  try {
    await privateCompose(target.directory,['up','-d','--wait','--wait-timeout','120','postgres'],{capture:true});
    guard(await psql(target.directory,"SELECT to_regclass('auth.users') IS NULL AND to_regnamespace('sb') IS NULL")==='t','Cel odzyskiwania nie jest pusty. Niczego nie nadpisano.');
    const env={...process.env,...await readEnv(path.join(target.directory,'compose.env'))};
    const catalog=await privateArchiveCatalog({args:composeArguments(target.directory,['exec','-T','postgres','pg_restore','--list']),environment:env,cwd:repositoryRoot,dumpFile:recovered.databaseDump});
    if(archiveHasVault(catalog))await psql(target.directory,restoredVaultRolesSql);
    await new Promise((resolve,reject)=>{
      const child=spawn('docker',composeArguments(target.directory,['exec','-T','postgres','pg_restore','--clean','--if-exists','--exit-on-error','-U','postgres','-d','shadowbridge']),{cwd:repositoryRoot,env,stdio:['pipe','ignore','pipe']});
      const input=createReadStream(recovered.databaseDump);input.once('error',()=>{child.kill();reject(new Error('Nie można odczytać odzyskiwanej kopii.'));});
      child.stdin.on('error',()=>{});child.stderr.resume();input.pipe(child.stdin);
      child.once('error',()=>{input.destroy();reject(new Error('Nie uruchomiono testu odtworzenia.'));});
      child.once('exit',code=>{input.destroy();code===0?resolve():reject(new Error('Test pg_restore nie przeszedł. Źródłowa baza pozostała nienaruszona.'));});
    });
    await psql(target.directory,restoredSentinelRoleSql);
    assertPreserved(expected,await databaseFingerprints(target.directory));
    return { project:target.project,directory:target.directory,verified:true };
  } finally {
    await privateCompose(target.directory,['stop','postgres'],{capture:true}).catch(()=>{});
    // Only our authenticated temporary extraction is removed. Recovery project,
    // database volume, source backup and key are retained, never down -v.
    await rm(extraction,{recursive:true,force:true});
  }
}

// Deployment validates the existing backup without creating another database,
// project or environment. Full restore tests from the earlier report remain
// historical; an authenticated archive/catalog check is not a restore test.
export async function verifyBackupArchive({directory,backupFile,keyFile}) {
  const source=await checkStaging({directory});
  const extraction=path.join(repositoryRoot,'.local','restore-verify-'+randomBytes(6).toString('hex'));
  const recovered=await decryptBackup({backupFile,keyFile,destination:extraction});
  try {
    guard(recovered.project===source.project,'Kopia pochodzi z innej instalacji.');
    const env={...process.env,...await readEnv(path.join(source.directory,'compose.env'))};
    await new Promise((resolve,reject)=>{
      const child=spawn('docker',composeArguments(source.directory,['exec','-T','postgres','pg_restore','--list']),{cwd:repositoryRoot,env,stdio:['pipe','ignore','pipe']});
      const input=createReadStream(recovered.databaseDump);
      input.on('error',()=>{child.kill();reject(new Error('Nie można odczytać kopii.'));});child.stdin.on('error',()=>{});child.stderr.resume();input.pipe(child.stdin);
      child.once('error',()=>{input.destroy();reject(new Error('Nie uruchomiono kontroli kopii.'));});
      child.once('exit',code=>{input.destroy();code===0?resolve():reject(new Error('Kopia nie przeszła kontroli katalogu pg_restore. Niczego nie odtworzono.'));});
    });
    return {archiveAuthenticated:true,catalogReadable:true,restored:false,newInfrastructureCreated:false};
  } finally {await rm(extraction,{recursive:true,force:true});}
}

const publicConfigurationFiles=['compose.env','app.env','auth.env','proxy-token','Caddyfile','manifest.json'];
export async function savePublicConfiguration(profile, folder) {
  // Separate encrypted companion: Gmail/proxy settings are absent from the
  // original private-profile backup. No plaintext config leaves .local/.
  const archive=path.join(folder,'production-configuration.json');
  const values={};for(const name of publicConfigurationFiles)values[name]=await readFile(path.join(profile.directory,name),'utf8');
  await writeFile(archive,JSON.stringify(values)+'\n',{mode:0o600,flag:'wx'});
  try{return await encryptArchive({archiveFile:archive,backupFile:path.join(folder,'production-configuration.sbb'),keyFile:path.join(folder,'production-configuration.key')});}
  finally{await rm(archive,{force:true});}
}

export async function recoverPublicConfiguration({directory,checkpoint}={}) {
  const source=await checkStaging({directory});
  const folder=path.resolve(source.directory,'backups',checkpoint||'');
  guard(folder.startsWith(path.join(source.directory,'backups')+path.sep) && /^public-[a-zA-Z0-9-]+$/.test(path.basename(folder)),'Wskaż zachowany katalog public-... przez --checkpoint=.');
  let cursor=folder;
  while(cursor!==source.directory){guard(!(await lstat(cursor)).isSymbolicLink(),'Ścieżka odzyskiwania nie może zawierać dowiązań.');cursor=path.dirname(cursor);}
  const target=path.join(repositoryRoot,'.local','recovered-public-'+randomBytes(6).toString('hex'));
  await mkdir(target,{mode:0o700});
  const archive=path.join(target,'authenticated-configuration.json');
  await decryptArchive({backupFile:path.join(folder,'production-configuration.sbb'),keyFile:path.join(folder,'production-configuration.key'),archiveFile:archive});
  const values=JSON.parse(await readFile(archive,'utf8'));
  guard(Object.keys(values).length===publicConfigurationFiles.length && publicConfigurationFiles.every(name=>typeof values[name]==='string'),'Kopia publicznej konfiguracji zawiera nieznane lub brakujące pliki.');
  for(const name of publicConfigurationFiles)await writeFile(path.join(target,name),values[name],{mode:0o600,flag:'wx'});
  await rm(archive);
  console.log(`Uwierzytelniono kopię konfiguracji w nowym prywatnym katalogu ${target}. Działająca instalacja pozostała bez zmian.`);
  return {directory:target};
}

export async function verifyPublic(releaseSha, { request = globalThis.fetch, mailDisabled=false } = {}) {
  const read=async pathname=>{const result=await request(productionOrigin+pathname,{redirect:'manual',signal:AbortSignal.timeout(15000)});guard(result.headers.get('x-shadowbridge-release')===releaseSha,`Domena nie obsługuje oczekiwanego wydania: ${pathname}`);return result;};
  const health=await read('/health');guard(health.status===200 && (await health.json()).ok===true,'Backend domeny nie przeszedł kontroli zdrowia.');
  const config=await read('/api/config');const data=await config.json();guard(config.status===200 && data.backendEnabled===true && data.releaseSha===releaseSha,'Domena nadal wskazuje starą stronę lub niewłaściwy backend.');
  if(mailDisabled){
    guard(data.capabilities?.registration===false && data.capabilities?.passwordRecovery===false && data.capabilities?.emailVerification===false,'Ścieżki e-mail nie są wyłączone.');
    for(const route of ['/api/auth/register','/api/auth/recover','/api/auth/resend-verification']){
      const response=await request(productionOrigin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(15000)});
      guard(response.status===503 && (await response.json()).code==='MAIL_NOT_ENABLED','Ścieżka e-mail nadal przyjmuje żądania: '+route);
    }
  }
  for(const page of ['/','/member-sign-in/','/apply/buyer/','/apply/supplier/','/apply/partner/','/legal/','/cartel/'])guard((await read(page)).status===200,`Nie działa podstrona ${page}`);
  for(const page of ['/portal/admin/','/portal/buyer/','/portal/supplier/','/portal/partner/','/portal/offers/']){const r=await read(page);guard(r.status===303 && r.headers.get('location')==='/member-sign-in/',`Niepoprawna ochrona panelu ${page}`);}
  for(const page of ['/.env','/.git/config','/server/app.mjs','/auth/v1/settings','/prototypes/'])guard((await read(page)).status===404,`Niepożądany publiczny zasób ${page}`);
  return {origin:productionOrigin,releaseSha,publicSmokeVerified:true,credentialsTested:false};
}

async function autoDirectory() {
  const matches=[];
  for(const item of await readdir(path.join(repositoryRoot,'.local'),{withFileTypes:true}))if(item.isDirectory()) {
    const directory=path.join(repositoryRoot,'.local',item.name);
    try{const checked=await checkStaging({directory});const running=await privateCompose(directory,['ps','--services','--status','running'],{capture:true});if(running.split('\n').includes('postgres') && !checked.project.includes('restore-'))matches.push(directory);}catch{}
  }
  guard(matches.length===1,'Nie można jednoznacznie wybrać istniejącej instalacji. Użyj --dir=.local/istniejacy-katalog; nie twórz nowej konfiguracji.');return matches[0];
}
function currentRelease() {
  guard(execFileSync('git',['branch','--show-current'],{cwd:repositoryRoot,encoding:'utf8'}).trim()==='feature/secure-b2b-mvp','Wymagana gałąź feature/secure-b2b-mvp.');
  guard(!execFileSync('git',['status','--porcelain'],{cwd:repositoryRoot,encoding:'utf8'}).trim(),'Repozytorium ma niezapisane pliki. Zabezpiecz je; instalator niczego nie resetuje.');
  return execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
}

export async function deployProduction({ directory,ipv4='169.58.232.69' } = {}) {
  directory ||= await autoDirectory();
  const source=await checkStaging({directory});directory=source.directory;
  const releaseSha=currentRelease();
  guard(hostname() && process.platform==='linux','Uruchom instalator na istniejącym serwerze Linux.');
  const lock=path.join(directory,'production-operation.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw new Error('Istnieje blokada operacji. Sprawdź poprzedni proces przed jej ręcznym usunięciem.');});
  let paused=false,activated=false;
  let running=[],resume=[];
  const folder=path.join(directory,'backups','public-'+new Date().toISOString().replace(/[:.]/g,'-'));
  try {
    running=(await privateCompose(directory,['ps','--services','--status','running'],{capture:true})).split('\n');
    resume=running.filter(name=>['app','auth'].includes(name));
    guard(running.includes('postgres') && running.includes('app') && running.includes('auth'),'Istniejąca baza, API i Auth muszą działać przed aktualizacją.');
    guard(isIP(ipv4)===4 && Object.values(networkInterfaces()).flat().filter(Boolean).some(item=>item.address===ipv4),'Podaj publiczny IPv4 przypisany do tego VPS. Niczego nie zatrzymano.');
    await checkDomain(ipv4);
    const profile=await prepareProduction({directory,releaseSha,mailMode:'disabled'});
    publicCompose(profile,['config','--quiet']);
    // Check port ownership before stopping anything. Only an existing gateway
    // in THIS project may own public ports on an already activated installation.
    const exposed=safeDocker(['ps','--format','{{json .}}']).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const foreign=exposed.filter(row=>/:(?:80|443)->/.test(row.Ports||'') && !(row.Labels||'').split(',').includes(`com.docker.compose.project=${profile.project}`));
    guard(foreign.length<=1,'Porty 80/443 zajmują nieznane usługi; niczego nie zatrzymano.');
    const legacy=foreign.length?JSON.parse(safeDocker(['inspect',foreign[0].ID]))[0]:null;
    guard(!legacy||isLegacyPublicGateway(legacy),'Porty 80/443 zajmuje inny kontener. Nie zatrzymano go.');
    let listening;
    try{listening=execFileSync('ss',['-H','-ltn'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split('\n');}catch{throw new Error('Nie można sprawdzić portów 80/443 narzędziem ss. Niczego nie zatrzymano.');}
    for(const port of [80,443])if(listening.some(line=>new RegExp(':'+port+'$').test(line.trim().split(/\s+/)[3]||''))) {
      guard(exposed.some(row=>new RegExp(':'+port+'->').test(row.Ports||'') && ((row.Labels||'').split(',').includes(`com.docker.compose.project=${profile.project}`)||legacy&&row.ID===foreign[0].ID)),'Porty 80/443 zajmuje inny proces. Nie zatrzymano go.');
    }
    await mkdir(folder,{recursive:true,mode:0o700});
    const previous=safeDocker(['ps','-q','--filter',`label=com.docker.compose.project=${profile.project}`]).trim().split('\n').filter(Boolean);
    const identities=previous.map(id=>JSON.parse(safeDocker(['inspect',id]))[0]).map(item=>({service:item.Config.Labels['com.docker.compose.service'],image:item.Image}));
    for(const item of identities.filter(value=>['app','auth','gateway'].includes(value.service))){
      item.rollbackTag=`${profile.project}-rollback:${item.service}-${path.basename(folder)}`;
      safeDocker(['image','tag',item.image,item.rollbackTag]);
    }
    await writeFile(path.join(folder,'previous-images.json'),JSON.stringify({project:profile.project,releaseSha,images:identities,legacyPublicGateway:legacy?{id:legacy.Id,image:legacy.Image,originalConfigFiles:legacy.Config.Labels['com.docker.compose.project.config_files']}:null},null,2)+'\n',{mode:0o600,flag:'wx'});
    await savePublicConfiguration(profile,folder);
    await privateCompose(directory,['stop','app','auth'],{capture:true});paused=true;
    const before=await databaseFingerprints(directory);
    const ledger=JSON.parse(await psql(directory,'SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));
    validateApplied(await migrationSources(),ledger);
    const backup=await backupInstallation(directory);
    const recovery=await verifyBackupArchive({directory,...backup});
    console.log('Kopia zaszyfrowana i katalog pg_restore: OK. Nie tworzono dodatkowej bazy ani środowiska.');
    await writeFile(path.join(folder,'checkpoint.json'),JSON.stringify({releaseSha,project:profile.project,backup,recovery,createdAt:new Date().toISOString(),status:'backup-authenticated-before-update'},null,2)+'\n',{mode:0o600,flag:'wx'});
    // Build first: a build/network error resumes the previous private services.
    publicCompose(profile,['build','app','migrator']);
    publicCompose(profile,['run','--rm','--no-deps','migrator']);
    assertPreserved(before,await databaseFingerprints(directory),{allowMigrationBackfill:true});
    // Email and signup are disabled. Only Caddy has public host ports, and the
    // database volume/project stays exactly the same.
    activated=true;
    if(legacy){
      // No rm/down/prune. All legacy configuration, certificates and volumes
      // stay on disk for recovery. This happens only AFTER backup/restore/build.
      safeDocker(['stop',legacy.Id]);
      console.log('Zatrzymano rozpoznany poprzedni Caddy; kontener, konfiguracja i certyfikaty zostały zachowane.');
    }
    publicCompose(profile,['up','-d','--no-build','--wait','--wait-timeout','180','auth','app','gateway']);
    paused=false;
    let verified,lastError;
    for(let attempt=0;attempt<12;attempt++) {
      try{
        publicCompose(profile,['exec','-T','app','node','-e',"fetch(process.env.SUPABASE_URL+'/auth/v1/health',{signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]);
        verified=await verifyPublic(releaseSha,{mailDisabled:true});break;
      }catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,5000));}
    }
    if(!verified)throw lastError;
    await writeFile(path.join(folder,'result.json'),JSON.stringify({...verified,backup,recovery,completedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(`ZWERYFIKOWANO: ${productionOrigin}; wydanie ${releaseSha}. Brak Basic Auth; panele wymagają normalnego logowania i MFA.`);
    console.log('Rejestracja i ścieżki e-mail są tymczasowo wyłączone; istniejące konta, MFA i kolejka kontaktowa pozostają aktywne.');
    console.log('Sprawdź własne konto OWNER/MFA oraz testowe role w przeglądarce. Instalator nie zna Twojego hasła i nie tworzył żadnych kont.');
    console.log(`Kopia i klucz: ${backup.backupFile} / ${backup.keyFile}. Zachowaj je oddzielnie także poza VPS. Dodatkowa konfiguracja publiczna: ${folder}.`);
    return verified;
  } catch(error) {
    if(paused && !activated && resume.length)await privateCompose(directory,['start',...resume],{capture:true}).catch(()=>{});
    if(activated)console.error(`Nie potwierdzono wdrożenia. Dane i kopie zachowano w ${folder}. Nie cofaj bazy na miejscu. Użyj production:ops rollback, aby wrócić do prywatnej instalacji i diagnozy.`);
    throw error;
  } finally {await handle.close();await rm(lock,{force:true});}
}

export async function rollbackPrivate({directory,checkpoint}={}) {
  const source=await checkStaging({directory});
  const lock=path.join(source.directory,'production-operation.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw new Error('Trwa inne wdrożenie lub wycofanie. Nie uruchomiono równoległej operacji.');});
  try {
  const folder=path.resolve(source.directory,'backups',checkpoint||'');
  guard(path.dirname(folder)===path.join(source.directory,'backups') && /^public-[a-zA-Z0-9-]+$/.test(path.basename(folder)),'Wskaż nazwę zapisanego katalogu public-... przez --checkpoint=.');
  guard(!(await lstat(folder)).isSymbolicLink(),'Odmowa wycofania przez dowiązanie.');
  const previous=JSON.parse(await readFile(path.join(folder,'previous-images.json'),'utf8'));
  guard(previous.project===source.project,'Kopia pochodzi z innej instalacji.');
  const services={};
  for(const name of ['app','auth','gateway']){
    const item=previous.images.find(value=>value.service===name);guard(/^sha256:[a-f0-9]{64}$/.test(item?.image||''),'Brakuje poprzedniego obrazu '+name+'.');
    services[name]={image:item.image};
  }
  const override=path.join(folder,'rollback-images.json');await writeFile(override,JSON.stringify({services})+'\n',{mode:0o600});
  const env={...process.env,...await readEnv(path.join(source.directory,'compose.env'))};
  safeDocker(composeArguments(source.directory,['-f',override,'up','-d','--no-build','--wait','--wait-timeout','120','auth','app','gateway']).slice(2),{env});
  console.log('Przywrócono poprzednie obrazy i prywatną konfigurację. Bazy nie cofnięto. Publiczna domena nie jest w tym trybie obsługiwana; DNS pozostał bez zmian.');
  if(previous.legacyPublicGateway)console.log('Zachowano poprzedni publiczny Caddy. Jego ponowne uruchomienie wymaga sprawdzenia oryginalnej konfiguracji i sieci; nie uruchomiono go automatycznie.');
  } finally {await handle.close();await rm(lock,{force:true});}
}

async function prompt(label,{secret=false}={}) {
  guard(process.stdin.isTTY,'Uruchom interaktywnie przez SSH jako shadowadmin. Haseł nie przekazuj w argumentach ani przez czat.');
  process.stdout.write(label+' ');
  if(!secret){
    const {createInterface}=await import('node:readline/promises');
    const reader=createInterface({input:process.stdin,output:process.stdout}),cancel=new AbortController();
    reader.once('SIGINT',()=>cancel.abort());
    try{return(await reader.question('',{signal:cancel.signal})).trim();}
    catch{throw new Error('Przerwano pytanie instalatora; zachowano dane i kopie.');}
    finally{reader.close();}
  }
  process.stdin.setRawMode(true);process.stdin.resume();let value='';
  try{return await new Promise((resolve,reject)=>{const onData=chunk=>{for(const char of chunk.toString()){if(char==='\u0003'){cleanup();reject(new Error('Przerwano bez zmiany danych.'));return;}if(char==='\r'||char==='\n'){cleanup();resolve(value.trim());return;}if(char==='\u007f'){value=value.slice(0,-1);continue;}if(char>=' ')value+=char;}};const cleanup=()=>process.stdin.off('data',onData);process.stdin.on('data',onData);});}
  finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  (async()=>{
    const args=process.argv.slice(2),action=args.shift()||'deploy',options={};
    for(const arg of args){const match=/^--(dir|ipv4|checkpoint)=(.+)$/.exec(arg);guard(match,'Dozwolone: --dir=, --ipv4=, --checkpoint=. Hasła podaje się wyłącznie w ukrytym pytaniu.');options[match[1]==='dir'?'directory':match[1]]=match[2];}
    if(action==='deploy'){
      options.directory ||= await autoDirectory();
      options.ipv4 ||= '169.58.232.69';
      await deployProduction(options);
    }else if(action==='verify'){const profile=await checkProduction({directory:options.directory||await autoDirectory()});await verifyPublic(profile.releaseSha,{mailDisabled:profile.mailMode==='disabled'});console.log(`PASS: ${productionOrigin}, SHA ${profile.releaseSha}.`);}
    else if(action==='rollback')await rollbackPrivate(options);
    else if(action==='recover-config')await recoverPublicConfiguration(options);
    else throw new Error('Użyj deploy, verify, rollback albo recover-config.');
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
