// Run once on OWNER's Linux computer, NOT Contabo. SSH uses existing known
// host keys and the operator's existing authentication; no credentials in chat.
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,chmod,statfs,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {homedir,hostname,platform} from 'node:os';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const must=(v,m)=>{if(!v)throw Error(m);};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const server='shadowadmin@169.58.232.69';
export async function digestFile(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
export function bootstrap(release,{bookApi=false,bookMcp=false,bookOAuth=false}={}){
 must([bookApi,bookMcp,bookOAuth].filter(Boolean).length<=1,'Choose one update mode.');
 must(/^[a-f0-9]{40}$/.test(release),'Wymagany pełny SHA wydania.');
 return `set -eu
umask 077
test "$(hostname)" = vmi3682957
cd /opt/shadowbridge
for SB_ACTIVE_LOCK in .local/r1-owner-release-*/operation.lock; do test ! -e "$SB_ACTIVE_LOCK"; done
if test -f '.local/r1-owner-release-${release}/state.json'; then
 test "$(git -c safe.directory=/opt/shadowbridge rev-parse HEAD)" = '${release}'
 exec node scripts/r1-production-release.mjs prepare --release='${release}'${bookOAuth?' --book-oauth':bookMcp?' --book-mcp':bookApi?' --book-api':''}
fi
test -z "$(git -c safe.directory=/opt/shadowbridge status --porcelain)"
git -c safe.directory=/opt/shadowbridge fetch --no-tags https://github.com/Thomas-Thor/ShadowBridge.git ${bookOAuth?'feature/owner-book-mcp-oauth':bookMcp?'feature/owner-book-mcp-readonly':'release/shadowbridge-international-r1'}
git -c safe.directory=/opt/shadowbridge merge-base --is-ancestor '${release}' FETCH_HEAD
DIAG_DIR=$(mktemp -d /tmp/shadowbridge-approved-r1.XXXXXX)
git -c safe.directory=/opt/shadowbridge show '${release}:scripts/international-r1-diagnose.mjs' > "$DIAG_DIR/check.mjs"
node "$DIAG_DIR/check.mjs" --repo=/opt/shadowbridge${bookOAuth?' --runtime=35c41f7a986d0cbe1f0b4b2aa87fa418cf762384':bookMcp?' --runtime=236e04bded81c406fb49ee0950ae20d139f257ec':bookApi?' --runtime=d5582ffd9f1e7f9a40a1a49f9e16a304eae64a4e':''}
if git -c safe.directory=/opt/shadowbridge show-ref --verify --quiet refs/heads/release/shadowbridge-international-r1; then
 git -c safe.directory=/opt/shadowbridge switch release/shadowbridge-international-r1
 git -c safe.directory=/opt/shadowbridge merge --ff-only '${release}'
else
 git -c safe.directory=/opt/shadowbridge switch -c release/shadowbridge-international-r1 '${release}'
fi
test "$(git -c safe.directory=/opt/shadowbridge rev-parse HEAD)" = '${release}'
mkdir -p .local
if ! node --input-type=module -e "await import('pg')" >/dev/null 2>&1; then npm ci --omit=dev --ignore-scripts > .local/r1-dependency-install.log 2>&1; fi
exec node scripts/r1-production-release.mjs prepare --release='${release}'${bookOAuth?' --book-oauth':bookMcp?' --book-mcp':bookApi?' --book-api':''}`;
}
function run(bin,args){const r=spawnSync(bin,args,{stdio:'inherit'});must(!r.error&&r.status===0,'Operacja zatrzymana. Zachowano checkpoint i kopie; nie uruchamiaj resetów ani powtórnych migracji.');}
const ssh=command=>run('ssh',['-t','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15',server,command]);
const remote=(phase,release,bookApi=false,bookMcp=false,bookOAuth=false)=>ssh('sudo node /opt/shadowbridge/scripts/r1-production-release.mjs '+phase+' --release='+release+(bookOAuth?' --book-oauth':bookMcp?' --book-mcp':bookApi?' --book-api':''));
export function oauthResumeAction(phase){
 if(['NONE','BACKUPS_VERIFIED_WAITING_OFFSITE'].includes(phase))return 'prepare';
 if(phase==='DEPLOYED_PENDING_OWNER_ACCEPTANCE')return 'accept';
 if(phase==='DEPLOYED_AND_VERIFIED')return 'verify';
 if(['MIGRATING','SCHEMA_VERIFIED','APP_STARTING'].includes(phase))return 'resume';
 throw Error('Checkpoint '+phase+' wymaga kontroli; nie ponowiono migracji ani wdrożenia.');
}
export function readInteractiveCheckpoint(command){
 // Stream the remote TTY, including sudo prompts, to OWNER. Capture only the
 // framed non-secret phase; never save terminal output or ask for a password.
 return new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-t','-o','StrictHostKeyChecking=yes',server,command],{stdio:['inherit','pipe','inherit']});let output='';
  child.stdout.on('data',chunk=>{process.stdout.write(chunk);output+=chunk.toString();if(output.length>8192)output=output.slice(-8192);});
  child.on('error',()=>reject(Error('Nie uruchomiono odczytu checkpointu.')));
  child.on('close',code=>{const matches=[...output.matchAll(/__SB_OAUTH_PHASE__=([A-Z_]+)/g)];if(code!==0||matches.length!==1)return reject(Error('Nie odczytano jednoznacznego checkpointu; nie wykonano prepare.'));resolve(matches[0][1]);});
 });
}
export async function ownerDeploy(release,{bookApi=false,bookMcp=false,bookOAuth=false,disable=false,acceptOnly=false}={}){
 must(platform()==='linux'&&hostname()!=='vmi3682957','Uruchom na lokalnym Linuxie OWNER, nie na Contabo.');
 must(/^[a-f0-9]{40}$/.test(release||''),'Podaj zatwierdzony pełny SHA.');
 must(process.stdin.isTTY,'Potrzebny interaktywny terminal; nie przekazuj haseł lub TOTP jako argumentów.');
 must([bookApi,bookMcp,bookOAuth].filter(Boolean).length<=1&&!(disable&&acceptOnly),'Choose one update purpose and action.');
 if(disable){must(bookApi||bookMcp||bookOAuth,'Wyłączenie dotyczy wyłącznie --book-api.');remote('off',release,bookApi,bookMcp,bookOAuth);return;}
 const ask=async text=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{return(await rl.question(text)).trim();}finally{rl.close();}};
 const confirm=async text=>{must(await ask(text+' Wpisz TAK: ')==='TAK','Przerwano bez zatwierdzenia.');};
 if(acceptOnly){await confirm('Potwierdź odbiór wdrożonej aplikacji i dotychczasowe logowanie OWNER + TOTP. Tylko zapis odbioru, bez prepare/apply.');remote('accept',release,bookApi,bookMcp,bookOAuth);return;}
 const base=path.join(homedir(),'.local','state','shadowbridge-release',release),archives=path.join(base,'archives'),keys=path.join(base,'recovery-keys');
 for(const dir of [base,archives,keys]){await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);must(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700,'Katalog lokalnej kopii musi być prywatny, bez dowiązań.');}
 const bundle='/home/shadowadmin/.shadowbridge-r1-'+release;
 const transfer=(from,to)=>run('scp',['-p','-o','StrictHostKeyChecking=yes','--',from,to]);
 must(await realpath(base)===base,'Dowiązania w ścieżce lokalnego backupu są zabronione.');
 let applied=false,prepared=false,applyAttempted=false;
 try{
  console.log(bookOAuth?'OAuth na istniejącym MCP 35c41f7: addytywna migracja 019, bez zmian kont/MFA/REST. ChatGPT wymaga osobnego rzeczywistego odczytu.':bookMcp?'Aktualizacja MCP z przyjętego 236e04b. REST pozostaje aktywne. Bez migracji, resetów i canary. Połączenie ChatGPT pozostaje niepotwierdzone.':bookApi?'Aktualizacja UI i aktywacja ograniczonego API Book. Bez migracji i bez zmian kont/TOTP/n8n. ChatGPT pozostaje NIEPOŁĄCZONY do rzeczywistego testu.': 'Aktualizacja R1 + OWNER Book. Zdalne API, SMTP, rejestracja i workflow pozostają wyłączone. Podczas kopii nastąpi przerwa app/Auth i krótka przerwa Caddy.');
  await confirm('Zaloguj się teraz na https://shadow-bridge.eu istniejącym OWNER i potwierdź dotychczasowy TOTP. Czy logowanie działa i zatwierdzasz okno aktualizacji?');
  // Existing checkpoint is never silently overwritten. Operator can resume only
  // the same exact release, using the same verified offsite bundle.
  if(bookOAuth){
   const code="const fs=require('node:fs'),p='/opt/shadowbridge/.local/r1-owner-release-"+release+"/state.json';if(!fs.existsSync(p)){console.log('__SB_OAUTH_PHASE__=NONE')}else{const s=JSON.parse(fs.readFileSync(p));if(s.release!=='"+release+"'||s.purpose!=='book-oauth')process.exit(2);console.log('__SB_OAUTH_PHASE__='+s.phase)}";
   const phase=await readInteractiveCheckpoint('sudo node -e '+quote(code));const action=oauthResumeAction(phase);
   if(action==='verify'){remote('verify',release,bookApi,bookMcp,bookOAuth);return;}
   if(action==='accept'){await confirm('Nowy obraz już działa. Potwierdź ponowne logowanie OWNER + TOTP po aktualizacji, aby zapisać wyłącznie odbiór.');remote('accept',release,bookApi,bookMcp,bookOAuth);return;}
   if(action==='resume'){remote('resume',release,bookApi,bookMcp,bookOAuth);await confirm('Wznowiono po sprawdzonej migracji. Zaloguj OWNER + TOTP i potwierdź odbiór.');remote('accept',release,bookApi,bookMcp,bookOAuth);return;}
  }
  ssh('sudo sh -c '+quote(bootstrap(release,{bookApi,bookMcp,bookOAuth})));
  prepared=true;
  const manifestFile=path.join(base,'manifest.json');
  let hasManifest=false;try{const f=await lstat(manifestFile);must(f.isFile()&&!f.isSymbolicLink(),'Niebezpieczny plik wykazu kopii.');hasManifest=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!hasManifest)transfer(server+':'+bundle+'/manifest.json',manifestFile);await chmod(manifestFile,0o600);
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));must(manifest.kind==='shadowbridge-r1-offsite-bundle-v1'&&manifest.release===release&&manifest.files.length===6,'Nieprawidłowa paczka kopii.');
  const fs=await statfs(base),needed=manifest.files.reduce((n,f)=>n+f.bytes,0);must(fs.bavail*fs.bsize>needed+512*1024**2,'Za mało miejsca na komputerze na pełną kopię poza VPS. Aplikacja pozostaje wstrzymana; nie wykonano migracji.');
  const files=[];
  for(const f of manifest.files){
   must(/^(database|configuration|certificates)\.(sbb|key)$/.test(f.name)&&/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0,'Nieprawidłowy wykaz kopii.');
   const file=path.join(f.name.endsWith('.key')?keys:archives,f.name);
   let exists=false;try{const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink(),'Niebezpieczny plik kopii.');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!exists)transfer(server+':'+bundle+'/'+f.name,file);
   await chmod(file,0o600);must((await lstat(file)).size===f.bytes&&await digestFile(file)===f.sha256,'Kopia lokalna nie przeszła kontroli SHA; niczego nie nadpisano.');files.push(f);
  }
  const receipt={kind:'shadowbridge-r1-offsite-receipt-v1',release,nonce:manifest.nonce,verifiedOnDifferentHost:true,files};
  const receiptFile=path.join(base,'offsite-receipt.json');await writeFile(receiptFile,JSON.stringify(receipt)+'\n',{mode:0o600});transfer(receiptFile,server+':'+bundle+'/offsite-receipt.json');
  console.log('Wszystkie trzy zaszyfrowane kopie zweryfikowano na komputerze OWNER. Klucze zapisano osobno: '+keys);
  applyAttempted=true;remote('apply',release,bookApi,bookMcp,bookOAuth);applied=true;
  console.log(bookOAuth?'Odbiór: istniejący OWNER + TOTP, Command Book, REST, discovery OAuth i anonimowa odmowa MCP. Po odbiorze podłącz ChatGPT przez OAuth; nie twórz klucza API.':bookMcp?'Odbiór: istniejący OWNER + TOTP, Command Book, REST, anonimowa odmowa MCP. Nie generuj klucza przed potwierdzeniem prywatnego Authentication. Tylko odczyt ChatGPT pozostaje do osobnego testu.':bookApi?'Odbiór: OWNER + TOTP, nowe terminy kluczy i CUSTOM, maskowanie/COPY/Revoke, TXT w Downloads oraz opcjonalne Reference / Source. API odrzuca żądania bez klucza. Połączenie ChatGPT wymaga osobnego testu w potwierdzonym Plugin Creator; nie wpisuj klucza w terminalu.': 'Odbiór w przeglądarce: zaloguj OWNER + TOTP; sprawdź Command Center/VAULT, Book (fikcyjne zadanie i edycja, notatka, pomysł, kalendarz, decyzja, historia), API Keys (utworzenie READ ONLY, zakresy, termin, cofnięcie, audyt). Sprawdź odmowę innemu użytkownikowi i ekran n8n. Nie włączaj zdalnego API.');
  const acceptance=await ask('Czy odbiór zakończył się poprawnie? Wpisz ODBIOR albo ROLLBACK: ');
  if(acceptance==='ROLLBACK'){remote('rollback',release,bookApi,bookMcp,bookOAuth);applied=false;return;}
  must(acceptance==='ODBIOR','Nowa aplikacja pozostaje uruchomiona, ale odbiór NIE jest potwierdzony. Zachowano plan rollbacku.');remote('accept',release,bookApi,bookMcp,bookOAuth);
  console.log((bookOAuth?'OAUTH ENABLED; CHATGPT CONNECTION NOT TESTED. SHA: ':bookMcp?'MCP ENABLED; CHATGPT CONNECTION NOT TESTED. SHA: ':bookApi?'API ENABLED; CHATGPT CONNECTION NOT TESTED. SHA: ':'DEPLOYED AND VERIFIED. SHA: ')+release+'. Zachowaj kopie i klucze poza repozytorium; nie przesyłaj ich w rozmowie.');
 }catch(e){
  if(prepared&&!applyAttempted){try{remote('cancel',release,bookApi,bookMcp,bookOAuth);}catch{console.error('Nie potwierdzono wznowienia starej aplikacji. Zachowano checkpoint; potrzebny operator.');}}
  console.error(applied?'DEPLOYED_PENDING_OWNER_ACCEPTANCE':'READY FOR OWNER ACTION / sprawdź zachowany checkpoint');throw e;
 }

}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);must(args.length>=1&&args.length<=4&&args[0].startsWith('--release=')&&args.slice(1).every(a=>['--book-api','--book-mcp','--book-oauth','--disable','--accept-only'].includes(a)),'Use --release=APPROVED_FULL_SHA [--book-api|--book-mcp] [--disable|--accept-only]');ownerDeploy(args[0].slice(10),{bookApi:args.includes('--book-api'),bookMcp:args.includes('--book-mcp'),bookOAuth:args.includes('--book-oauth'),disable:args.includes('--disable'),acceptOnly:args.includes('--accept-only')}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
