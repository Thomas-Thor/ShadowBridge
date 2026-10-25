// Standalone, dependency-free, READ-ONLY Contabo inventory. Download to /tmp;
// do not switch the live checkout to run this. Never prints Env/config records.
import {execFileSync} from 'node:child_process';
import {readFile,readdir,lstat,realpath,statfs} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve4,resolve6} from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
export const baseline='7f794a298713d820af033ba2174cd60bfaa81e4b';
export const ownerBookR1='d5582ffd9f1e7f9a40a1a49f9e16a304eae64a4e';
export const ownerBookOAuthR1='599fc3359ecd3d87868cb6056e35214c0baa3c00';
export const ownerBookMcpR1='35c41f7a986d0cbe1f0b4b2aa87fa418cf762384';
export const ownerBookApiR1='236e04bded81c406fb49ee0950ae20d139f257ec';
export const catalog={
  "deploy/production/compose.yaml": "8419746e90fa3a055b4006652c35e9870d6347159162f8f8811be000f19617dd",
  "deploy/production/caddy-entrypoint.sh": "6ffa8573784757749f0626a79a4ec34659c1154e0769a24fc3607a8692b21225",
  "deploy/production/Caddyfile.in": "414913b978f12ba7adcd47b681d5daad8f311cca745e9ea5880ea9732e1a0320",
  "gatewayCaddy": "fc536047e35d9eb3868141da723e0fae669d2d17e49a168a04ad032ae1ef2338",
  "migrations": [
    {
      "name": "202610180001_private_b2b.sql",
      "sha256": "8f9aeccadb03d2c854d08673a09dfc474758beb475fc923db9c0e1e109cf6161"
    },
    {
      "name": "202610180002_private_threads.sql",
      "sha256": "5289649125bdb17dedf615d0adca48db0027f73a857cd81959ac25a8a1bb224a"
    },
    {
      "name": "202610180003_registration_intents.sql",
      "sha256": "a4c08ffceb8669b08dac76d24530cdfbc11857d70d0d62a00cb0a6ac161e9c09"
    },
    {
      "name": "202610180004_security_events.sql",
      "sha256": "5c63108a8f8f91084171639f5a3eb3e342030ba19322fb6cbe2de666dff5c02b"
    },
    {
      "name": "202610190005_contact_queue.sql",
      "sha256": "d3ed4a0d147764e292107cba5c3225206aa71cfe6b13157b90d46956a3c4ea6d"
    },
    {
      "name": "202610190006_staff_rbac.sql",
      "sha256": "94eaef16e0f082ad6295bb5c17f688d1e0c9b27197d130928482c493ccb11aac"
    },
    {
      "name": "202610190007_offers_workspace.sql",
      "sha256": "c93a6538f359291b09fa6f9f44f81a47575e87cfc4d5960e07e9e69c5cc531ea"
    },
    {
      "name": "202610190008_taxonomy.sql",
      "sha256": "9cc6e92b4ddeabd9002ba533342954d2a4aaefd15d5c9ae9c8b5fd6f688e3a44"
    },
    {
      "name": "202610190009_rbac_fixes.sql",
      "sha256": "667968d1e0d5fb1eee94cbcc7fb9d06a7d82c3d4f73669cafa569154cb28e852"
    },
    {
      "name": "202610190010_taxonomy_fixes.sql",
      "sha256": "36326d27aac4fb2be154742b85506da17fa9cc0f982fb2c6a713968148d74640"
    },
    {
      "name": "202610200011_project_partner_eligibility.sql",
      "sha256": "df6e4175bd07aa818b8228d49107623340eef4692d23ef4a42038b60cb44d4f3"
    },
    {
      "name": "202610210012_registration_drafts.sql",
      "sha256": "539fb5093f7fdefc82a3f31528352ed93744b619a88bdb12497643e1167205ee"
    },
    {
      "name": "202610210013_recruitment_visibility.sql",
      "sha256": "4c9ee5dbda8ee48edf77f338d328c00e49cfe31418cd941d040edb31308e9253"
    },
    {
      "name": "202610210014_application_decision_history.sql",
      "sha256": "1bf825fc7d2f80826927c6eddab2408d979a8b9534f0fe78e6023182446826b3"
    },
    {
      "name": "202610210015_sentinel_verification.sql",
      "sha256": "f9c9fdd80004ebf30daa124d8b1fe1bcece4dcd396be1bf0388a3b1faf19b000"
    },
    {
      "name": "202610220016_owner_vault.sql",
      "sha256": "7a4a4293871dc9596f18b9b39d905d27da428abed755a50746a48b6624b86985"
    },
    {
      "name": "202610230017_owner_vault_workspace.sql",
      "sha256": "5c4bc2069e080b6ce623bece92b0c10f289aa5794a4fe44357463e29fabbce6e"
    },
    {
      "name": "202610240018_owner_command_book.sql",
      "sha256": "300d772a3ad4893175fc1bc503d0edd5aca80c80d0d48fde3794c59b3caf9a34"
    }
  ],
  "baseline:server/app.mjs": "eb0af1bfeffed09d60bd143971e85eefb0ee1973a6c1c4a63bea9f56b60e7f44",
  "baseline:server/config.mjs": "c02de1d312412046ecb9361d7411735acbe1582347e2dd06eac79089af04be5c",
  "baselineRuntime": {
    "apply/buyer/index.html": "089a218b4289fb01cbe7ab78cf389f6e665761ac6d0e1f60fcef303845333e02",
    "apply/partner/index.html": "162a4e365cddb6c66f5bb06305f1ef3411c5b447454655e943b81481db0c5405",
    "apply/supplier/index.html": "4924e4d22bae581e440a2fa089256649f3ce60f6db516602d294389c4519c21a",
    "assets/account.js": "59d1a1cd549de9fc3fa19964027a90b9d327ac94c6954efc1584a792d7765ed5",
    "assets/app.js": "09ebf39f8a1b687bb71b3638720462bf9939aa09aedc808386cef2aff46e2ba3",
    "assets/bridge-mark.svg": "b4de42f328adfbab421a5d6281a303a29d4057ed595255c052335ef0313a3a70",
    "assets/business-config.js": "b2954257cff6ce048b5285fffec8adeeb157b7039dfef5feec3fc5838de169ae",
    "assets/business-contact-config.js": "da70bf1233225d914aec0452676075556fe853b845db85c6dc38c383aae16d9a",
    "assets/business-contact.css": "bd8ca9420f8f771f2dd4f05be13258876e051ac9d98669c36d3104f3a61051a8",
    "assets/business-contact.js": "d847f3d54b6ba8a2883993d1c6b22db27d0718f7f1bdea9801241bee18b1acdc",
    "assets/cartel-eye.png": "7936834b498f7359484b71626744a99ed3f6290a432872133a91fe81a492704a",
    "assets/cartel.css": "07306a0237cb63b3c513ce5a669c9f91a280fba50f8bfb54aa60db9fab4e9f5c",
    "assets/command-dashboard.js": "95fa8279999e4fff48d047098102c11208b3ca7cbc327f8ee1e333e1ff559456",
    "assets/content.en.js": "084df97fd0115edbf377270290d8c7a3f4b73a7a71d4ef132b98332e0aaa31e7",
    "assets/dashboard.css": "6b6022e13578a6c6cdef51aa89c8a357deaa44991bd39fea4376f64032061511",
    "assets/dashboard.js": "ab2caee55141cffcb4baae09464a3f80d95c3b91cfa80a3224e829321bba178a",
    "assets/entry.css": "3678ea6808e8a493fea601a41e39b9c3839108f6f74c3369870da6ad50997551",
    "assets/fonts/dm-sans-LICENSE.txt": "6fbd040a29c2037a765dfb9f2561e9965b5c95c6dcb5dce516089d63d5f17af7",
    "assets/fonts/dm-sans-latin-wght-normal.woff2": "9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543",
    "assets/fonts/instrument-serif-LICENSE.txt": "b6106a757902d2d412e09d94dc4a226fe3da80485208a98003969f1b8b6b1d74",
    "assets/fonts/instrument-serif-latin-400-italic.woff2": "5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7",
    "assets/fonts/instrument-serif-latin-400-normal.woff2": "5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31",
    "assets/fonts/sources.json": "efd157291841e73e786d11138f924245b0fffed917d6b426b29078e7fae08965",
    "assets/global-bridge.svg": "631445011a5736a904ecdcf2d256d5090bed83dc33c4ec8819dbaca3bb2d2e6d",
    "assets/legal-information.js": "af137f5b17a10c7740219b36b07eb58975ee257ee8cc50346298376a352648f2",
    "assets/member-access.css": "1a4f43e6a008a3c078b17ccd20a7f577de531e337015b3cdae0676a62797c45d",
    "assets/member-access.svg": "819f538419f78a3aad8ed4e962462ecaf53c7322bc80e9618e2e4348560829d1",
    "assets/member-dashboard.js": "52bb4b95d3bb8f0972bd98cbca28c3a545f2a0999828b80df92af06d2ea08d51",
    "assets/member-entry-gate.svg": "5490dbce841061a8e6fe388304a548242b44765029e3073ce4cba00d470b005e",
    "assets/member-entry-seal.svg": "6374092485cdc5c2d86820be9b8755a070f75230a9332a2d408463557b9b2e1b",
    "assets/member-entry.css": "29f7903234fdb7b41cc919653ff16e5a8d3948722a3d95c064026c145ed4e229",
    "assets/offers-workspace.css": "6619002c9ae7db8b420439534beac088067e21db4a795b2f8c808b401523e8c8",
    "assets/offers-workspace.js": "c3ddf67c673043f30924e9db4beb707f71e0fdd9b3432776322b71e3dff609a7",
    "assets/portal.css": "a64752b93312b9d5bfd116940ed80361de37b54eabb79a6cb2371887155ea1b6",
    "assets/portal.js": "2d963eeb8c66b54586bbc0aed23f2bf05c0cdc68c792002820182f3ea912b55a",
    "assets/styles.css": "abe584242f593e250661d0f91a5e5c50598229c3281fe0f22b738345959d7996",
    "cartel/index.html": "7b97d0aa5559c016fb919882ce94d7bb43036a694bcb00eef34c1538236f2d39",
    "index.html": "8bbf269089c0686d4c73aef8ada0b65e57341f063096a858139cb39ca4fd6f56",
    "legal/index.html": "ba20572387dc5301c07e6aa9df8c5befd3573f18fe0f05ac5e334b1bfd7053d3",
    "member-sign-in/index.html": "5de788c83c1d1d844bb89d8756332537d51cbc11a63378810da629d96b726e88",
    "package.json": "da2bec4d1c3e5c12eb49e3f411f579d58e0718445a8386df597216553b9a764a",
    "portal/admin/index.html": "00f5ac784273dd4aa7e357b2b7f27e65bf0884982f2ab135b55d6692c0f7e01d",
    "portal/buyer/index.html": "aea32427de70fb62f344e16e0413e0d8591df101b096213fbfa4e120306001ca",
    "portal/index.html": "a5765c16fe3640f3af7b45b8ccea543dbaba47aaedc56dd79d1980a1156e7693",
    "portal/offers/index.html": "e8f6ebf224efab8def1bfb3131f6fee8083ad69afcfc7bf072cddf99656fc8f0",
    "portal/partner/index.html": "620441d3b999bd2844ce369fabc63a9b5669ba7e02bae0fdc79e3d3345755de4",
    "portal/supplier/index.html": "9373f94052788c21822e52eb52e51fe739d54cffa3eeb2c2068ec8bf93137cfd",
    "robots.txt": "255388fde81e360a72493b842c3f202bf7547fa27a018a3b225015760fcbcedc",
    "server/app.mjs": "eb0af1bfeffed09d60bd143971e85eefb0ee1973a6c1c4a63bea9f56b60e7f44",
    "server/auth.mjs": "429984a56595c2f5fdf28d537689719d817525cdf5de69899929a7ea3df6c858",
    "server/client-address.mjs": "d3a731573bae99761e00f99457df65e5692b67f2282ba88e720efa12b1362738",
    "server/config.mjs": "c02de1d312412046ecb9361d7411735acbe1582347e2dd06eac79089af04be5c",
    "server/db.mjs": "fcf7a5f626b8a4b7a7b9b0a5165bdbf66b9e77454de4a70b49e83b4146b59223",
    "server/mail-policy.mjs": "60122abb092f795df0cba6ee49771613153a302d9338bb9fd4393625382c09c3",
    "server/offers-workspace.mjs": "e24341a59bb57b87b33c7ef8d98e5f76665e8f9fbe996731ccd77f26606720c5",
    "server/recruitment.mjs": "8140ff97393199788feb271f490a68d1aae61680194ed886cfa73d46d1d31038",
    "server/registration.mjs": "57c629dc12547e21fea93c2740f3dda4523dfcee1d26d3da18dbea91e4d3a3f4",
    "server/staff-management.mjs": "f00cfa08417ca42b5f728c18c34762b342f965203aa7ce0f50db37dfe90325d9",
    "server/taxonomy.mjs": "b42863f8fa4ca63a6fe6c1183f6b5bd139c36c2aa9f2dc34a54c63bfb03dd5c5",
    "server/validation.mjs": "d0e58b1ff2b2e1d6a1be0ce5f9fbc113883444a86f07f0f376303123ec462783",
    "sitemap.xml": "afd307f69233a9cf1c0661b630d40a4544d168c8348898324c5a9653a180e920"
  }
};
const hash=b=>createHash('sha256').update(b).digest('hex');
const must=(x,m)=>{if(!x)throw new Error(m);};
const run=(bin,args,input)=>execFileSync(bin,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:15000,maxBuffer:8*1024**2}).trim();
const docker=(args,input)=>run('docker',['--context','default',...args],input);
const envValue=(c,key)=>(c.Config?.Env||[]).find(v=>v.startsWith(key+'='))?.slice(key.length+1);
export function safeContainer(c){return {
 name:c.Name?.replace(/^\//,''),running:!!c.State?.Running,imageId:c.Image,
 project:c.Config?.Labels?.['com.docker.compose.project']||null,service:c.Config?.Labels?.['com.docker.compose.service']||null,
 release:/^[a-f0-9]{40}$/.test(envValue(c,'RELEASE_SHA')||'')?envValue(c,'RELEASE_SHA'):null,
 ports:Object.entries(c.HostConfig?.PortBindings||{}).flatMap(([target,bindings])=>(bindings||[]).map(p=>({target,host:p.HostIp,port:p.HostPort}))),
 networks:Object.keys(c.NetworkSettings?.Networks||{}),
 volumes:(c.Mounts||[]).filter(m=>m.Type==='volume').map(m=>({name:m.Name,target:m.Destination})),
 };}
export function evaluateInventory(r,{runtimeRelease=baseline}={}){
 must([baseline,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(runtimeRelease),'UNREVIEWED_RUNTIME_RELEASE');
 const blockers=[];
 if(r.legacyPublicGateway)blockers.push('LEGACY_PUBLIC_CADDY_REQUIRES_COMPATIBILITY_STAGE');
 if(!r.installation?.unique)blockers.push('INSTALLATION_NOT_UNIQUE');
 if(!r.repository?.trackedClean||r.repository?.untrackedCount)blockers.push('WORKTREE_REQUIRES_PRESERVATION_REVIEW');
 if(r.application?.release!==runtimeRelease||!r.application?.sourceMatchesBaseline)blockers.push('RUNNING_BASELINE_NOT_PROVEN');
 if(!r.profiles?.valid||!r.profiles?.gatewayMounted||r.profiles?.gatewayState!=='active'||!r.profiles?.runtimeConfigurationMatchesProfile)blockers.push('ACTIVE_FINGERPRINTED_GATEWAY_NOT_PROVEN');
 if(!r.application?.internalAuthTlsVerified)blockers.push('PRIVATE_AUTH_TLS_NOT_PROVEN');
 if(!r.network?.internal||!r.network?.gatewayConnected||!r.network?.n8nConnected||!r.network?.webhookUrlCorrect)blockers.push('AUTOMATION_NETWORK_OR_URL_NOT_PROVEN');
 if(runtimeRelease!==baseline&&r.application?.ownerBookApiEnabled!==[ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(runtimeRelease))blockers.push('ACTIVE_R1_API_STATE_NOT_PROVEN');
 if(runtimeRelease===ownerBookApiR1&&r.application?.ownerBookMcpEnabled!==false)blockers.push('MCP_ALREADY_ENABLED_OR_NOT_PROVEN');
 if(runtimeRelease===ownerBookMcpR1&&(r.application?.ownerBookMcpEnabled!==true||r.application?.ownerBookOAuthEnabled===true||r.database?.migrationCount!==18))blockers.push('ACCEPTED_MCP_OAUTH_STATE_NOT_PROVEN');
 if(runtimeRelease===ownerBookOAuthR1&&(r.application?.ownerBookMcpEnabled!==true||r.application?.ownerBookOAuthEnabled!==true||r.application?.ownerBookMcpCreateEnabled===true||r.database?.migrationCount!==19))blockers.push('ACCEPTED_OAUTH_CREATE_STATE_NOT_PROVEN');
 if(!r.privatePorts)blockers.push('PRIVATE_PORTS_NOT_PROVEN');
 if(!r.database?.migrationPrefixValid||r.database?.migrationCount<(runtimeRelease!==baseline?18:15))blockers.push('MIGRATION_PROVENANCE_NOT_PROVEN');
 if(!(r.database?.activeOwnersWithVerifiedTotp>0))blockers.push('OWNER_WITH_EMAIL_AND_TOTP_NOT_PROVEN');
 if(!r.domains?.main?.ok||!r.domains?.automation?.ok||!r.domains?.automationSignIn?.ok||!r.domains?.dnsMatchesExpected)blockers.push('DOMAIN_TLS_RELEASE_OR_N8N_NOT_PROVEN');
 if(!r.disk?.enoughForBuildAndBackup)blockers.push('SERVER_BUILD_AND_BACKUP_SPACE_NOT_PROVEN');
 return {status:blockers.length?'BLOCKED':'READY FOR PREFLIGHT',blockers,
  next:!blockers.length?'Existing-server preflight and OWNER interactive login; deployment still requires separate approval':'Review this inventory first; do not run deploy, migrations or regenerate manifests',
  deploymentApproved:false};
}
async function regular(file,mode){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===mode,'UNSAFE_PROFILE_FILE');return readFile(file);}
async function privateFolder(file){const s=await lstat(file);must(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700&&(await realpath(file))===file,'UNSAFE_PROFILE_DIRECTORY');}
export async function profileEvidence(repo,pg,gateway){
 const cert=pg.Mounts?.find(m=>m.Destination==='/run/secrets/postgres.crt');must(cert,'CONFIGURATION_LOCATION_UNKNOWN');
 const source=path.dirname(path.dirname(cert.Source));
 must(source.startsWith(path.join(repo,'.local')+path.sep)&&(await realpath(source))===source,'UNSUPPORTED_CONFIGURATION_LOCATION');
 await privateFolder(source);await privateFolder(path.join(source,'certs'));
 const privateManifest=JSON.parse(await regular(path.join(source,'manifest.json'),0o600));
 const project=pg.Config.Labels['com.docker.compose.project'];must(privateManifest.kind==='shadowbridge-private-contabo-v1'&&privateManifest.project===project,'PRIVATE_PROJECT_MISMATCH');
 const privateFiles=['compose.env','postgres.env','auth.env','app.env','migration.env','tester-password','Caddyfile',...['internal-ca.crt','internal-ca.key','postgres.crt','postgres.key','auth-proxy.crt','auth-proxy.key','public.crt','public.key'].map(n=>'certs/'+n)];
 for(const name of privateFiles)must(hash(await regular(path.join(source,name),name==='certs/internal-ca.crt'?0o644:0o600))===privateManifest.hashes?.[name],'PRIVATE_FINGERPRINT_CHANGED');
 await privateFolder(path.join(source,'production-no-mail'));
 const selector=JSON.parse(await regular(path.join(source,'production-no-mail','selected.json'),0o600));
 must(selector.kind==='shadowbridge-no-mail-selection-v1'&&selector.purpose==='prepared-configuration-only'&&selector.releaseSha===baseline,'PUBLIC_BASELINE_SELECTOR_NOT_PROVEN');
 const folder=path.join(source,'production-no-mail',baseline),manifest=JSON.parse(await regular(path.join(folder,'manifest.json'),0o600));
 await privateFolder(folder);
 must(manifest.kind==='shadowbridge-production-v1'&&manifest.project===project&&manifest.sourceDirectory===source&&manifest.releaseSha===baseline&&manifest.mailMode==='disabled'&&manifest.origin==='https://shadow-bridge.eu','PUBLIC_PROFILE_IDENTITY_MISMATCH');
 for(const name of ['compose.env','app.env','auth.env','proxy-token','Caddyfile'])must(hash(await regular(path.join(folder,name),0o600))===manifest.hashes?.[name],'PUBLIC_FINGERPRINT_CHANGED');
 must(manifest.hashes.Caddyfile===catalog['deploy/production/Caddyfile.in'],'PUBLIC_TEMPLATE_CHANGED');
 const edge=path.join(source,'automation-gateway'),m=JSON.parse(await regular(path.join(edge,'manifest.json'),0o600));
 await privateFolder(edge);
 must(m.kind==='shadowbridge-n8n-gateway-profile-v1'&&m.project===project&&m.baseRelease===baseline&&m.sourceDirectory===source&&m.productionDirectory===folder&&m.network==='shadowbridge-edge'&&m.upstream==='shadowbridge-automation-n8n-1:5678','GATEWAY_PROFILE_IDENTITY_MISMATCH');
 must(m.baseProductionManifestSha===hash(await readFile(path.join(folder,'manifest.json')))&&m.privateManifestSha===hash(await readFile(path.join(source,'manifest.json'))),'GATEWAY_ANCHORS_CHANGED');
 for(const [field,file]of [['baseComposeSha','deploy/production/compose.yaml'],['entrypointSha','deploy/production/caddy-entrypoint.sh']])must(m[field]===catalog[file]&&hash(await readFile(path.join(repo,file)))===catalog[file],'GATEWAY_SOURCE_CHANGED');
 for(const name of ['Caddyfile','compose.override.json'])must(hash(await regular(path.join(edge,name),0o600))===m.hashes?.[name],'GATEWAY_FINGERPRINT_CHANGED');
 must(m.hashes.Caddyfile===catalog.gatewayCaddy,'GATEWAY_TEMPLATE_CHANGED');
 const override=JSON.parse(await readFile(path.join(edge,'compose.override.json')));
 must(isDeepStrictEqual(override,{services:{gateway:{volumes:[{type:'bind',source:path.join(edge,'Caddyfile'),target:'/etc/caddy/Caddyfile',read_only:true,bind:{create_host_path:false}}],networks:{automation_edge:{}}}},networks:{automation_edge:{external:true,name:'shadowbridge-edge'}}}),'GATEWAY_OVERLAY_MISMATCH');
 const state=JSON.parse(await regular(path.join(edge,'state.json'),0o600));
 must(state.kind==='shadowbridge-n8n-gateway-state-v1','GATEWAY_STATE_UNVERIFIED');
 const mounted=gateway?.Mounts?.find(v=>v.Destination==='/etc/caddy/Caddyfile')?.Source===path.join(edge,'Caddyfile');
 return {valid:true,sourceDirectory:source,project,gatewayState:state.phase,gatewayMounted:mounted,configurationOnlyNotDeploymentProof:true};
}
export function probeSpecification(host,route,kind){
 const specs={main:['shadow-bridge.eu','/health','application/json'],automation:['automation.shadow-bridge.eu','/healthz','application/json'],signin:['automation.shadow-bridge.eu','/signin','text/html']};
 const spec=specs[kind];must(spec&&spec[0]===host&&spec[1]===route,'UNEXPECTED_HEALTH_ENDPOINT');
 return {hostname:host,port:443,path:route,servername:host,headers:{Accept:spec[2]},rejectUnauthorized:true,signal:AbortSignal.timeout(10000)};
}
export function safeHttpEvidence({status,headers={},body={},certificate,authorized},kind,{expectedRelease=baseline}={}){
 must([baseline,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(expectedRelease),'UNREVIEWED_RUNTIME_RELEASE');
 const release=headers['x-shadowbridge-release'],httpOk=status===200,tlsVerified=authorized===true;
 const endpointOk=kind==='main'?release===expectedRelease&&body.ok===true:kind==='automation'?body.status==='ok':kind==='signin'?/^text\/html(?:;|$)/i.test(headers['content-type']||''):false;
 const ok=httpOk&&tlsVerified&&!headers['www-authenticate']&&endpointOk;
 return {ok,status,httpOk,endpointOk,tlsVerified,basicAuth:!!headers['www-authenticate'],release:/^[a-f0-9]{40}$/.test(release||'')?release:null,...(certificate?{certificate:{sha256:certificate.fingerprint256,validTo:certificate.valid_to}}:{})};
}
export async function probe(host,route,kind,{get=https.get,expectedRelease=baseline}={}){
 const options=probeSpecification(host,route,kind);
 return new Promise(resolve=>{
  const req=get(options,res=>{
   const cert=res.socket.getPeerCertificate(),authorized=res.socket.authorized;let body='',bytes=0,oversized=false;
   res.on('data',b=>{bytes+=b.length;if(bytes<=8192)body+=b;else oversized=true;});
   res.on('end',()=>{let value={};try{value=JSON.parse(body);}catch{}resolve({...safeHttpEvidence({status:res.statusCode,headers:res.headers,body:value,certificate:cert,authorized},kind,{expectedRelease}),...(oversized&&kind!=='signin'?{ok:false,error:'HEALTH_BODY_TOO_LARGE'}:{}),endpoint:route,accept:options.headers.Accept});});
   res.on('error',()=>resolve({ok:false,error:'HTTPS_RESPONSE_INCOMPLETE',endpoint:route}));
  });req.setTimeout(8000,()=>req.destroy());req.on('error',()=>resolve({ok:false,tlsVerified:false,error:'HTTPS_UNVERIFIED',endpoint:route}));
 });
}
export async function pinnedR1Runtime(repo,release=ownerBookR1){
 must([ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(release),'UNREVIEWED_RUNTIME_RELEASE');
 // Expected files come from one reviewed immutable Git object, never HEAD or a
 // caller-provided revision. Binary assets are hashed as bytes.
 const args=['-c','safe.directory='+repo,'-C',repo];
 const names=run('git',[...args,'ls-tree','-r','--name-only',release]).split('\n');
 const files=names.filter(f=>{const p=f.split('/'),ext=path.extname(f);return !f.startsWith('assets/prototypes.')&&(['package.json','index.html','robots.txt','sitemap.xml','member-sign-in/index.html','legal/index.html','cartel/index.html'].includes(f)||f.startsWith('apply/')||f.startsWith('portal/')||f.startsWith('assets/fonts/')||p.length===2&&p[0]==='server'&&ext==='.mjs'||p.length===2&&p[0]==='assets'&&['.js','.css','.svg','.png'].includes(ext));});
 must(files.length===(release===ownerBookOAuthR1?70:release===ownerBookMcpR1?68:67),'INCOMPLETE_PINNED_R1_RUNTIME');const result={};for(const file of files)result[file]=hash(execFileSync('git',[...args,'show',release+':'+file],{stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2}));return result;
}
async function databaseEvidence(pg,{runtimeRelease,repo}={}){
 const sql=text=>docker(['exec','-i',pg.Id,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge'],"BEGIN READ ONLY; SET LOCAL statement_timeout='5s';\n"+text+';\nROLLBACK;');
 const exists=sql("SELECT to_regclass('shadowbridge_migrations.applied') IS NOT NULL AND to_regclass('sb.staff_role_assignments') IS NOT NULL");must(exists==='t','MIGRATION_LEDGER_OR_RBAC_MISSING');
 const migrations=JSON.parse(sql("SELECT coalesce(json_agg(json_build_object('name',name,'sha256',sha256) ORDER BY name),'[]'::json) FROM shadowbridge_migrations.applied"));
 const expected=[...catalog.migrations];if(runtimeRelease===ownerBookOAuthR1){const name='202610250019_owner_book_oauth.sql';expected.push({name,sha256:hash(execFileSync('git',['-c','safe.directory='+repo,'-C',repo,'show',ownerBookOAuthR1+':supabase/migrations/'+name],{stdio:['ignore','pipe','pipe']}))});}
 const valid=migrations.length<=expected.length&&migrations.every((m,i)=>m.name===expected[i].name&&m.sha256===expected[i].sha256);
 const owner=sql("SELECT count(*) FROM sb.staff_role_assignments r JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND g.active AND a.status='active' AND lower(a.email)=lower(u.email) AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.factor_type='totp' AND f.status='verified')");
 const size=Number(sql('SELECT pg_database_size(current_database())'));
 return {migrationPrefixValid:valid,migrationCount:migrations.length,migrations,activeOwnersWithVerifiedTotp:Number(owner),databaseBytes:size,ownerIdentityNotInferred:true,interactiveOwnerLoginStillRequired:true,passwordsOrFactorSecretsRead:false,transactionReadOnly:true};
}
export async function diagnose({repo='/opt/shadowbridge',runtimeRelease=baseline}={}){
 must([baseline,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(runtimeRelease),'UNREVIEWED_RUNTIME_RELEASE');
 const r={kind:'shadowbridge-international-r1-read-only-inventory-v1',readOnly:true,deployed:false,knownBaselineIsOwnerStatementNotSshEvidence:true};
 repo=await realpath(repo);must(repo==='/opt/shadowbridge','Run only against the existing /opt/shadowbridge; never the Codex/owner local database');
 const git=args=>run('git',['-c','safe.directory='+repo,'-C',repo,...args]);
 const changes=git(['status','--porcelain=v1','-z']).split('\0').filter(Boolean);
 r.repository={head:git(['rev-parse','HEAD']),trackedClean:!changes.some(x=>!x.startsWith('??')),untrackedCount:changes.filter(x=>x.startsWith('??')).length};
 const endpoint=JSON.parse(run('docker',['context','inspect','default','--format','{{json .Endpoints.docker}}']));must(['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint.Host),'REMOTE_DOCKER_REFUSED');
 const dockerRoot=docker(['info','--format','{{.DockerRootDir}}']);r.docker={dataRoot:dockerRoot,driver:docker(['info','--format','{{.Driver}}']),localContext:true};
 const rows=docker(['ps','-aq','--no-trunc']).split('\n').filter(Boolean),all=rows.length?JSON.parse(docker(['inspect',...rows])):[];
 const inRepo=c=>(c.Config?.Labels?.['com.docker.compose.project.working_dir']||'')===repo||(c.Config?.Labels?.['com.docker.compose.project.config_files']||'').split(',').some(f=>f.startsWith(repo+'/deploy/'));
 const related=all.filter(c=>inRepo(c)||c.Name==='/shadowbridge-automation-n8n-1'||c.Config?.Labels?.['com.docker.compose.project.working_dir']==='/opt/shadowbridge-public');
 r.containers=related.map(safeContainer);
 r.legacyPublicGateway=related.some(c=>c.State.Running&&c.Config?.Labels?.['com.docker.compose.project.working_dir']==='/opt/shadowbridge-public');
 const pg=related.filter(c=>inRepo(c)&&c.State.Running&&c.Config?.Labels?.['com.docker.compose.service']==='postgres');r.installation={unique:pg.length===1};
 if(pg.length===1){
  const project=pg[0].Config.Labels['com.docker.compose.project'];r.installation.project=project;
  const member=service=>related.filter(c=>c.State.Running&&c.Config?.Labels?.['com.docker.compose.project']===project&&c.Config?.Labels?.['com.docker.compose.service']===service);
  const app=member('app'),gateway=member('gateway');
  const sourceCandidate=pg[0].Mounts?.find(m=>m.Destination==='/run/secrets/postgres.crt')?.Source;
  const sourceDirectory=sourceCandidate?path.dirname(path.dirname(sourceCandidate)):null;
  if(sourceDirectory?.startsWith(path.join(repo,'.local')+path.sep)&&(await realpath(sourceDirectory))===sourceDirectory)r.installation.sourceDirectory=sourceDirectory;
  r.application=app.length===1?{release:safeContainer(app[0]).release,imageId:app[0].Image,ownerBookApiEnabled:envValue(app[0],'OWNER_BOOK_API_ENABLED')==='true',ownerBookMcpEnabled:envValue(app[0],'OWNER_BOOK_MCP_ENABLED')==='true',ownerBookOAuthEnabled:envValue(app[0],'OWNER_BOOK_OAUTH_ENABLED')==='true',ownerBookMcpCreateEnabled:envValue(app[0],'OWNER_BOOK_MCP_CREATE_ENABLED')==='true'}:{};
  try{const runtimeFiles=runtimeRelease===baseline?catalog.baselineRuntime:await pinnedR1Runtime(repo,runtimeRelease),files=Object.keys(runtimeFiles),values=docker(['exec',app[0].Id,'sha256sum',...files.map(f=>'/app/'+f)]).split('\n');r.application.sourceMatchesBaseline=values.length===files.length&&values.every(line=>{const [digest,file]=line.trim().split(/\s+/);return digest===runtimeFiles[file.replace('/app/','')];});r.application.baselineFilesCompared=files.length;r.application.expectedRuntime=runtimeRelease;}catch{r.application.sourceMatchesBaseline=false;}
  try{r.profiles=await profileEvidence(repo,pg[0],gateway[0]);}catch(e){r.profiles={valid:false,error:e.message.match(/^[A-Z_]+$/)?e.message:'PROFILE_UNVERIFIED'};}
  if(r.profiles.valid){
   try{
    const folder=path.join(r.profiles.sourceDirectory,'production-no-mail',baseline);
    const match=async(file,c)=>{const values=(await regular(path.join(folder,file),0o600)).toString().split('\n').filter(v=>v&&!v.startsWith('#'));return !!c&&values.every(line=>{const i=line.indexOf('=');return i>0&&envValue(c,line.slice(0,i))===(file==='app.env'&&line.startsWith('RELEASE_SHA=')?runtimeRelease:file==='app.env'&&line.startsWith('OWNER_BOOK_API_ENABLED=')&&[ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(runtimeRelease)?'true':line.slice(i+1));})&&!c.Config.Env.includes('NODE_TLS_REJECT_UNAUTHORIZED=0');};
    r.profiles.runtimeConfigurationMatchesProfile=(await match('app.env',app[0]))&&(await match('auth.env',member('auth')[0]))&&(runtimeRelease===baseline||envValue(app[0],'OWNER_BOOK_API_ENABLED')===String([ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].includes(runtimeRelease)))&&(runtimeRelease!==ownerBookApiR1||envValue(app[0],'OWNER_BOOK_MCP_ENABLED')!=='true')&&(runtimeRelease!==ownerBookMcpR1||envValue(app[0],'OWNER_BOOK_MCP_ENABLED')==='true'&&envValue(app[0],'OWNER_BOOK_OAUTH_ENABLED')!=='true')&&(runtimeRelease!==ownerBookOAuthR1||envValue(app[0],'OWNER_BOOK_MCP_ENABLED')==='true'&&envValue(app[0],'OWNER_BOOK_OAUTH_ENABLED')==='true'&&envValue(app[0],'OWNER_BOOK_MCP_CREATE_ENABLED')!=='true');
   }catch{r.profiles.runtimeConfigurationMatchesProfile=false;}
  }
  try{r.application.internalAuthTlsVerified=docker(['exec',app[0].Id,'node','--input-type=module','-e',"const r=await fetch('https://auth-proxy:8444/auth/v1/health',{signal:AbortSignal.timeout(5000)});await r.arrayBuffer();if(!r.ok)process.exit(1);console.log('PASS');"])==='PASS';}catch{r.application.internalAuthTlsVerified=false;}
  try{r.database=await databaseEvidence(pg[0],{runtimeRelease,repo});}catch{r.database={error:'DATABASE_METADATA_UNVERIFIED'};}
  r.privatePorts=['postgres','app','auth','mailpit'].every(s=>member(s).every(c=>safeContainer(c).ports.length===0))&&app.length===1&&member('auth').length===1;
  const n8n=related.find(c=>c.Name==='/shadowbridge-automation-n8n-1'&&c.State.Running);
  r.privatePorts&&=!!n8n&&safeContainer(n8n).ports.every(p=>['127.0.0.1','::1'].includes(p.host));
  try{const n=JSON.parse(docker(['network','inspect','shadowbridge-edge']))[0];r.network={internal:n.Internal,gatewayConnected:gateway[0]?.NetworkSettings.Networks['shadowbridge-edge']?.NetworkID===n.Id,n8nConnected:n8n?.NetworkSettings.Networks['shadowbridge-edge']?.NetworkID===n.Id,webhookUrlCorrect:envValue(n8n||{},'N8N_WEBHOOK_URL')==='https://automation.shadow-bridge.eu/'};}catch{r.network={error:'AUTOMATION_NETWORK_UNVERIFIED'};}
  if(r.installation.sourceDirectory){
   const source=r.installation.sourceDirectory;
   try{const files=await readdir(path.join(source,'backups'));r.backup={encryptedArchives:files.filter(n=>n.endsWith('.sbb')).length,offHostCopyConfirmed:false,restoreOnThisServerTested:false};}catch{r.backup={error:'BACKUP_INVENTORY_UNVERIFIED'};}
   try{const a=await statfs(source),b=await statfs(dockerRoot),need=Math.max(8*1024**3,4*(r.database?.databaseBytes||0)+4*1024**3);r.disk={configurationFreeBytes:a.bavail*a.bsize,dockerFreeBytes:b.bavail*b.bsize,freeInodes:Math.min(a.ffree,b.ffree),requiredBytesPerFilesystem:need,enoughForBuildAndBackup:Math.min(a.bavail*a.bsize,b.bavail*b.bsize)>=need&&Math.min(a.ffree,b.ffree)>=100000};}catch{r.disk={enoughForBuildAndBackup:false};}
  }
 }
 const [main,automation,automationSignIn,mainA,automationA,mainAAAA,automationAAAA]=await Promise.all([probe('shadow-bridge.eu','/health','main',{expectedRelease:runtimeRelease}),probe('automation.shadow-bridge.eu','/healthz','automation'),probe('automation.shadow-bridge.eu','/signin','signin'),resolve4('shadow-bridge.eu').catch(()=>[]),resolve4('automation.shadow-bridge.eu').catch(()=>[]),resolve6('shadow-bridge.eu').catch(()=>[]),resolve6('automation.shadow-bridge.eu').catch(()=>[])]);
 r.domains={main,automation,automationSignIn,dnsMatchesExpected:mainA.length>0&&automationA.length>0&&[...mainA,...automationA].every(ip=>ip==='169.58.232.69')&&!mainAAAA.length&&!automationAAAA.length};
 return {...r,...evaluateInventory(r,{runtimeRelease})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);must(args.length<=2&&args.every(a=>a==='--repo=/opt/shadowbridge'||[ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1].some(r=>a==='--runtime='+r)),'Use --repo=/opt/shadowbridge and optionally the reviewed R1 --runtime.');
 diagnose({runtimeRelease:args.find(a=>a.startsWith('--runtime='))?.slice(10)||baseline}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.status==='BLOCKED')process.exitCode=2;}).catch(()=>{console.log(JSON.stringify({status:'BLOCKED',readOnly:true,error:'INVENTORY_INCOMPLETE_NO_CHANGES_MADE'}));process.exitCode=2;});
}
