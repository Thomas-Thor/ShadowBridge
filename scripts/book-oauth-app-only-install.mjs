// Standalone launcher downloaded and checksum-verified on OWNER Pop!_OS.
// Uses existing SSH/known_hosts; no API keys, tokens or password arguments.
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,lstat,chmod,statfs,realpath} from 'node:fs/promises';
import {homedir,hostname,platform} from 'node:os';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const targetRelease='e871f2e09c25dc79f5222fa738ac446a103f1edc';
const server='shadowadmin@169.58.232.69',must=(v,m)=>{if(!v)throw Error(m);};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function digestFile(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
function run(bin,args){const r=spawnSync(bin,args,{stdio:'inherit'});must(!r.error&&r.status===0,'STOP. Checkpoint i kopie zachowane. Nie uruchamiaj resetu, migracji ani starego instalatora.');}
const ssh=command=>run('ssh',['-t','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15',server,command]);
const remote=(phase,release)=>ssh('sudo node /opt/shadowbridge/scripts/book-oauth-app-only.mjs '+phase+' --installer-release='+release);
export function bootstrap(release){
 must(/^[a-f0-9]{40}$/.test(release),'Full installer SHA required.');
 return `set -eu
umask 077
test "$(hostname)" = vmi3682957
cd /opt/shadowbridge
for SB_LOCK in .local/r1-owner-release-*/operation.lock; do test ! -e "$SB_LOCK"; done
test "$(git -c safe.directory=/opt/shadowbridge branch --show-current)" = release/shadowbridge-international-r1
test -z "$(git -c safe.directory=/opt/shadowbridge status --porcelain)"
git -c safe.directory=/opt/shadowbridge fetch --no-tags https://github.com/Thomas-Thor/ShadowBridge.git feature/owner-book-mcp-scoped-write
git -c safe.directory=/opt/shadowbridge merge-base --is-ancestor '${release}' FETCH_HEAD
git -c safe.directory=/opt/shadowbridge merge --ff-only '${release}'
test "$(git -c safe.directory=/opt/shadowbridge rev-parse HEAD)" = '${release}'
node --input-type=module -e "await import('pg')"
exec node scripts/book-oauth-app-only.mjs prepare --installer-release='${release}'`;
}
async function readPhase(){
 const code="const fs=require('node:fs'),p='/opt/shadowbridge/.local/r1-owner-release-"+targetRelease+"/state.json';if(!fs.existsSync(p)){console.log('__SB_APP_ONLY_PHASE__=NONE')}else{const s=JSON.parse(fs.readFileSync(p));if(s.release!=='"+targetRelease+"'||s.kind!=='shadowbridge-book-oauth-app-only-v1')process.exit(2);console.log('__SB_APP_ONLY_PHASE__='+s.phase)}";
 return new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-t','-o','StrictHostKeyChecking=yes',server,'sudo node -e '+quote(code)],{stdio:['inherit','pipe','inherit']});let tail='';
  child.stdout.on('data',b=>{process.stdout.write(b);tail=(tail+b.toString()).slice(-8192);});
  child.on('error',()=>reject(Error('Nie uruchomiono odczytu checkpointu.')));
  child.on('close',code=>{const matches=[...tail.matchAll(/__SB_APP_ONLY_PHASE__=([A-Z_]+)/g)];if(code!==0||matches.length!==1)reject(Error('Nie odczytano jednoznacznego checkpointu.'));else resolve(matches[0][1]);});
 });
}
export function nextAction(phase){
 const actions={NONE:'prepare',BACKUPS_VERIFIED_WAITING_OFFSITE:'apply',SWAPPING_APP:'resume',DEPLOYED_PENDING_OWNER_ACCEPTANCE:'accept',DEPLOYED_AND_VERIFIED:'verify'};
 must(actions[phase],'Checkpoint wymaga kontroli; nie ponowiono operacji.');return actions[phase];
}
export function validateManifest(m){
 const expected=['certificates.key','certificates.sbb','configuration.key','configuration.sbb','database.key','database.sbb'];
 must(m.kind==='shadowbridge-r1-offsite-bundle-v1'&&m.release===targetRelease&&typeof m.nonce==='string'&&Array.isArray(m.files)&&JSON.stringify(m.files.map(f=>f.name).sort())===JSON.stringify(expected),'Nieprawidłowy wykaz kopii.');
 for(const f of m.files)must(/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0,'Nieprawidłowy rozmiar/checksum kopii.');return m;
}
async function offsite(){
 const base=path.join(homedir(),'.local','state','shadowbridge-oauth-app-only',targetRelease),archives=path.join(base,'archives'),keys=path.join(base,'recovery-keys');
 for(const dir of [base,archives,keys]){await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);must(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700&&await realpath(dir)===dir,'Kopia wymaga prywatnego katalogu bez dowiązań.');}
 const bundle='/home/shadowadmin/.shadowbridge-oauth-app-only-'+targetRelease,transfer=(from,to)=>run('scp',['-p','-o','StrictHostKeyChecking=yes','--',from,to]);
 const manifestFile=path.join(base,'manifest.json');let exists=false;try{const s=await lstat(manifestFile);must(s.isFile()&&!s.isSymbolicLink(),'Niebezpieczny wykaz.');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!exists)transfer(server+':'+bundle+'/manifest.json',manifestFile);await chmod(manifestFile,0o600);
 const manifest=validateManifest(JSON.parse(await readFile(manifestFile,'utf8'))),f=await statfs(base);must(f.bavail*f.bsize>manifest.files.reduce((n,f)=>n+f.bytes,0)+512*1024**2,'Za mało miejsca na kopię poza VPS; aplikacja nie została zmieniona.');
 for(const f of manifest.files){
  const file=path.join(f.name.endsWith('.key')?keys:archives,f.name);let exists=false;
  try{const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink(),'Niebezpieczny plik kopii.');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!exists)transfer(server+':'+bundle+'/'+f.name,file);await chmod(file,0o600);
  must((await lstat(file)).size===f.bytes&&await digestFile(file)===f.sha256,'Kopia nie przeszła kontroli SHA-256. Niczego nie nadpisano.');
 }
 const receipt=path.join(base,'offsite-receipt.json');
 try{const s=await lstat(receipt);must(s.isFile()&&!s.isSymbolicLink(),'Niebezpieczne potwierdzenie kopii.');}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeFile(receipt,JSON.stringify({kind:'shadowbridge-r1-offsite-receipt-v1',release:targetRelease,nonce:manifest.nonce,verifiedOnDifferentHost:true,files:manifest.files})+'\n',{mode:0o600});await chmod(receipt,0o600);transfer(receipt,server+':'+bundle+'/offsite-receipt.json');
 console.log('Kopie poza VPS zweryfikowane. Archiwa: '+archives+'. Klucze oddzielnie: '+keys+'.');
}
export async function install(installerRelease,{rollback=false,verify=false}={}){
 must(/^[a-f0-9]{40}$/.test(installerRelease||'')&&!(rollback&&verify),'Podaj pełny SHA instalatora i jedną czynność.');
 must(platform()==='linux'&&hostname()!=='vmi3682957'&&process.stdin.isTTY,'Uruchom w terminalu na Pop!_OS OWNER, nie na VPS.');
 const ask=async message=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{return(await rl.question(message)).trim();}finally{rl.close();}};
 if(verify){remote('verify',installerRelease);return;}
 must(await ask('Potwierdź dotychczasowy TOTP przez Reconfirm MFA w istniejącym panelu OWNER. '+(rollback?'Zatwierdzasz cofnięcie wyłącznie obrazu app, bez przywracania bazy?':'Zatwierdzasz aktualizację samego obrazu app z 80f4a0d do e871f2e?')+' Wpisz TAK: ')==='TAK','Przerwano przed operacją.');
 if(rollback){remote('rollback',installerRelease);return;}
 const action=nextAction(await readPhase());
 if(action==='verify'){remote('verify',installerRelease);return;}
 if(action==='accept'){remote('accept',installerRelease);return;}
 if(action==='prepare')ssh('sudo sh -c '+quote(bootstrap(installerRelease)));
 if(action==='prepare'||action==='apply'){
  await offsite();
  must(await ask('Kopie zweryfikowane. Jeśli minęło 30 minut, ponownie potwierdź MFA OWNER w przeglądarce. Uruchomić wymianę tylko app? Wpisz TAK: ')==='TAK','Przerwano; stara aplikacja nadal działa, checkpoint zachowany.');
  remote('apply',installerRelease);
 }else remote('resume',installerRelease);
 console.log('Sprawdź istniejące logowanie OWNER, ponownie potwierdź MFA, odczyt Book oraz odśwież discovery ChatGPT. To nie jest jeszcze potwierdzenie rzeczywistego zapisu ChatGPT.');
 const decision=await ask('Wpisz ODBIOR albo ROLLBACK: ');
 if(decision==='ROLLBACK'){remote('rollback',installerRelease);return;}
 must(decision==='ODBIOR','Odbiór pozostaje niepotwierdzony; wznowienie nie powtórzy wymiany obrazu.');remote('accept',installerRelease);
 console.log('APP-ONLY ACCEPTED; REAL CHATGPT WRITE NOT VERIFIED. SHA: '+targetRelease);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [arg,...rest]=process.argv.slice(2);must(arg?.startsWith('--installer-release=')&&rest.length<=1&&rest.every(a=>['--rollback','--verify'].includes(a)),'Use --installer-release=FULL_SHA [--rollback|--verify].');
 install(arg.slice(20),{rollback:rest.includes('--rollback'),verify:rest.includes('--verify')}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
