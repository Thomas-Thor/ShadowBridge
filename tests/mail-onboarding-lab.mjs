// Offline cached-image test lab only. No production access, image build or sends.
import assert from 'node:assert/strict';import {randomBytes,createHash}from'node:crypto';
import {execFileSync}from'node:child_process';import {mkdir,writeFile,readFile,readdir,chmod}from'node:fs/promises';
import path from'node:path';import {inspectSpace}from'../scripts/workspace-space.mjs';
assert.deepEqual(process.argv.slice(2),['--isolated-lab']);
const base='/tmp/shadowbridge-r1-isolated',repo=process.cwd();assert.ok(repo.startsWith(base+'/'));assert.equal((await inspectSpace({dockerRoot:base+'/overlay-data'})).result,'PASS');
const D=(a,o={})=>execFileSync(base+'/app-only-bin/docker',a,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024**2,...o}).trim();
assert.equal(D(['info','--format','{{.DockerRootDir}}']),base+'/overlay-data');
const image='shadowbridge-app-only:80f4a0d333d31a6d57ada714b0df17bc0584a07b';assert.equal(JSON.parse(D(['image','inspect',image]))[0].Config.Labels['org.opencontainers.image.revision'],image.split(':')[1]);
const prefix='shadowbridge-mail-audit-'+randomBytes(4).toString('hex'),dir=path.join(repo,'.local',prefix);await mkdir(dir,{mode:0o700});
const password=()=>randomBytes(32).toString('hex'),admin=password(),auth=password(),api=password(),sessions=password();
async function env(name,data){const p=path.join(dir,name+'.env');await writeFile(p,Object.entries(data).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});return p;}
const noneProxy={HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:''};
const pgEnv=await env('postgres',{POSTGRES_DB:'shadowbridge',POSTGRES_USER:'postgres',POSTGRES_PASSWORD:admin,SB_AUTH_PASSWORD:auth,SB_API_PASSWORD:api,SB_SESSION_PASSWORD:sessions});
const authEnv=await env('auth',{...noneProxy,GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:8088',GOTRUE_SITE_URL:'http://127.0.0.1:8088',GOTRUE_URI_ALLOW_LIST:'http://127.0.0.1:8088/auth/confirm,http://127.0.0.1:8088/auth/recover',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${auth}@127.0.0.1:5432/shadowbridge?search_path=auth`,GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:password(),GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_MAILER_OTP_EXP:'3600',GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION:'false',GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED:'true',GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL:'10',GOTRUE_PASSWORD_MIN_LENGTH:'12',GOTRUE_MFA_ENABLED:'true',GOTRUE_MFA_TOTP_ENROLL_ENABLED:'true',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true',GOTRUE_MFA_MAX_ENROLLED_FACTORS:'5',GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1025',GOTRUE_SMTP_ADMIN_EMAIL:'test-auth@shadowbridge.invalid',GOTRUE_SMTP_SENDER_NAME:'FICTIONAL captured test',GOTRUE_MAILER_URLPATHS_CONFIRMATION:'/auth/confirm',GOTRUE_MAILER_URLPATHS_RECOVERY:'/auth/recover',GOTRUE_RATE_LIMIT_EMAIL_SENT:'200',GOTRUE_SMTP_MAX_FREQUENCY:'1s',GOTRUE_LOG_LEVEL:'error'});
const appEnv=await env('app',{...noneProxy,APP_ENV:'test',APP_URL:'http://127.0.0.1:8088',HOST:'127.0.0.1',PORT:'8088',SUPABASE_URL:'http://127.0.0.1:9999',SUPABASE_ANON_KEY:password(),DATABASE_URL:`postgres://shadowbridge_api:${api}@127.0.0.1:5432/shadowbridge`,SESSION_DATABASE_URL:`postgres://shadowbridge_sessions:${sessions}@127.0.0.1:5432/shadowbridge`,SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),MAIL_DELIVERY_MODE:'captured',SHADOWBRIDGE_MAIL_FIXTURE:'fresh-offline-namespace',SHADOWBRIDGE_MAIL_TEST_ADMIN:`postgres://postgres:${admin}@127.0.0.1:5432/shadowbridge`,SHADOWBRIDGE_TEST_URL:'http://127.0.0.1:8088',SHADOWBRIDGE_MAILPIT_URL:'http://127.0.0.1:8025'});
const readableBootstrap=path.join(dir,'bootstrap.sh');await writeFile(readableBootstrap,await readFile(path.join(repo,'deploy/staging/bootstrap.sh')),{mode:0o444,flag:'wx'});
const readableCycle=path.join(dir,'cycle.mjs'),readableHelpers=path.join(dir,'helpers.mjs');for(const [target,source]of [[readableCycle,'tests/mail-onboarding-cycle.mjs'],[readableHelpers,'server/tests/helpers.mjs']])await writeFile(target,await readFile(path.join(repo,source)),{mode:0o444,flag:'wx'});
let current='initialization';
await Promise.all([readableBootstrap,readableCycle,readableHelpers].map(p=>chmod(p,0o444)));
const names=['postgres','mailpit','auth','test'].map(n=>prefix+'-'+n),created=[],report={kind:'isolated-mail-onboarding-lab',productionChanged:false,externalEmailSent:false,imageBuildTested:false,transport:'offline shared network namespace; no published ports; local HTTP only',release:image.split(':')[1],cases:[]};
function start(name,args){D(['run','-d','--pull=never','--name',name,'--label','shadowbridge.mail-audit='+prefix,...args]);created.push(name);}
const query=q=>D(['exec','-i',names[0],'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge'],{input:q});
async function wait(fn){for(let i=0;i<60;i++){try{if(fn())return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Isolated service readiness timeout');}
try{
 current='postgres-bootstrap';start(names[0],['--network','none','--env-file',pgEnv,'--mount','type=volume,source='+prefix+'-database,target=/var/lib/postgresql/data','--mount','type=bind,source='+readableBootstrap+',target=/docker-entrypoint-initdb.d/10-shadowbridge.sh,readonly','postgres:17-alpine']);
 await wait(()=>query("SELECT count(*) FROM pg_roles WHERE rolname='shadowbridge_api'")==='1');
 current='mailpit-auth';start(names[1],['--network','container:'+names[0],'-e','MP_MAX_MESSAGES=200','-e','MP_SMTP_AUTH_ACCEPT_ANY=false','axllent/mailpit:v1.27.8']);
 start(names[2],['--network','container:'+names[0],'--env-file',authEnv,'supabase/gotrue:v2.184.0']);
 await wait(()=>query("SELECT count(*) FROM information_schema.tables WHERE table_schema='auth' AND table_name='mfa_factors'")==='1');
 current='migrations-fresh-only';query('CREATE SCHEMA shadowbridge_migrations; CREATE TABLE shadowbridge_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());');
 const migrations=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();assert.equal(migrations.length,21);
 for(const name of migrations){const sql=await readFile('supabase/migrations/'+name,'utf8');query(sql);query("INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES('"+name+"','"+createHash('sha256').update(sql).digest('hex')+"')");}
 report.migrationsAppliedToFreshTestDatabase=21;
 current='mail-regression';start(names[3],['--network','container:'+names[0],'--env-file',appEnv,'--read-only','--tmpfs','/tmp','--cap-drop=ALL','--security-opt','no-new-privileges:true','--mount','type=bind,source='+readableCycle+',target=/app/tests/mail-onboarding-cycle.mjs,readonly','--mount','type=bind,source='+readableHelpers+',target=/app/server/tests/helpers.mjs,readonly',image,'node','tests/mail-onboarding-cycle.mjs']);
 const status=D(['wait',names[3]],{timeout:120000});const output=D(['logs',names[3]]),data=JSON.parse(output.split('\n').at(-1));report.test=data;assert.equal(status,'0');assert.equal(data.result,'PASS');report.result='PASS';
}catch(e){report.result='FAIL';report.failedCase=current;report.errorType=e.name;report.failedMessage=e.message?.startsWith('Isolated ')?e.message:'See private lab failure';await writeFile(path.join(dir,'failure.private.log'),String(e.stack||e)+'\n'+String(e.stderr||''),{mode:0o600});process.exitCode=1;}
finally{
 for(const name of created.reverse())try{D(['stop','--time','10',name]);}catch{}
 try{report.containersStopped=D(['ps','-q','--filter','label=shadowbridge.mail-audit='+prefix])==='';}catch{report.containersStopped=false;}if(!report.containersStopped){report.result='BLOCKED';report.stopReviewRequired=true;process.exitCode=1;}report.volumesRetained=true;await writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));console.log('PRIVATE_CHECKPOINT '+dir);
}
