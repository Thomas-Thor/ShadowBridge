// Host-only R1 planning. Never deploys, migrates, stops services or rewrites an
// existing production/gateway profile. Operator approval is a separate step.
import { readFile, writeFile, mkdir, lstat, unlink, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkProduction } from './production-config.mjs';
import { publicComposeArguments,verifyPublic,databaseFingerprints,assertPreserved } from './production-ops.mjs';
import { productionBase, checkGatewayProfile, edgeNetwork, n8nContainer } from './n8n-gateway-profile.mjs';
import { repositoryRoot } from './staging-prepare.mjs';
import { encryptArchive } from './staging-backup.mjs';
import { migrationSources,validateApplied } from './staging-migrate.mjs';
import {ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1} from './international-r1-diagnose.mjs';
const must=(ok,message)=>{if(!ok)throw new Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const releasePattern=/^[a-f0-9]{40}$/,imagePattern=/^sha256:[a-f0-9]{64}$/;
async function regular(file,directory=false){const s=await lstat(file);must(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile())&&(s.mode&0o777)===(directory?0o700:0o600),'R1 requires private regular files/directories, no symlinks.');}
const override=(image,release,ownerBookApi,ownerBookMcp,ownerBookOAuth,ownerBookMcpCreate,ownerBookMcpWrite)=>({services:{app:{image,environment:{RELEASE_SHA:release,...(ownerBookApi===undefined?{}:{OWNER_BOOK_API_ENABLED:String(ownerBookApi)}),...(ownerBookMcp===undefined?{}:{OWNER_BOOK_MCP_ENABLED:String(ownerBookMcp)}),...(ownerBookOAuth===undefined?{}:{OWNER_BOOK_OAUTH_ENABLED:String(ownerBookOAuth)}),...(ownerBookMcpCreate===undefined?{}:{OWNER_BOOK_MCP_CREATE_ENABLED:String(ownerBookMcpCreate)}),...(ownerBookMcpWrite===undefined?{}:{OWNER_BOOK_MCP_WRITE_ENABLED:String(ownerBookMcpWrite)})}}}});
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function operatorScript(profile,directory,rollback){
 const action=rollback?'--application-only-no-database-restore':'--after-reviewed-backup-and-migrations';
 return '#!/bin/sh\nset -eu\n'+`[ "$#" -eq 1 ] && [ "$1" = ${quote(action)} ] || { echo 'Explicit operator acknowledgement required.' >&2; exit 2; }\n`+
  'cd '+quote(repositoryRoot)+'\nnode '+quote(path.join(repositoryRoot,'scripts/international-r1.mjs'))+' check '+quote('--dir='+profile.sourceDirectory)+' '+quote('--plan='+directory)+'\n'+
  'exec '+['docker','--context','default',...applicationArguments(profile,directory,rollback)].map(quote).join(' ')+'\n';
}
export function assertApplicationOnly(base,merged,{image,releaseSha,ownerBookApi,ownerBookMcp,ownerBookOAuth,ownerBookMcpCreate,ownerBookMcpWrite}){
 must(imagePattern.test(image)&&releasePattern.test(releaseSha),'Invalid immutable application identity.');
 const expected=structuredClone(base);
 expected.services.app.image=image;
 expected.services.app.environment={...expected.services.app.environment,RELEASE_SHA:releaseSha};
 must(ownerBookApi===undefined||typeof ownerBookApi==='boolean','Explicit boolean Command Book API selection required.');
 must(ownerBookMcp===undefined||typeof ownerBookMcp==='boolean','Explicit boolean MCP selection required.');
 must(ownerBookOAuth===undefined||typeof ownerBookOAuth==='boolean','Explicit OAuth selection required.');
 must(ownerBookMcpCreate===undefined||typeof ownerBookMcpCreate==='boolean','Explicit temporary-create selection required.');
 must(ownerBookMcpWrite===undefined||typeof ownerBookMcpWrite==='boolean','Explicit scoped-write selection required.');
 if(ownerBookMcpWrite!==undefined)expected.services.app.environment.OWNER_BOOK_MCP_WRITE_ENABLED=String(ownerBookMcpWrite);
 if(ownerBookMcpCreate!==undefined)expected.services.app.environment.OWNER_BOOK_MCP_CREATE_ENABLED=String(ownerBookMcpCreate);
 if(ownerBookOAuth!==undefined)expected.services.app.environment.OWNER_BOOK_OAUTH_ENABLED=String(ownerBookOAuth);
 if(ownerBookMcp!==undefined)expected.services.app.environment.OWNER_BOOK_MCP_ENABLED=String(ownerBookMcp);
 if(ownerBookApi!==undefined)expected.services.app.environment.OWNER_BOOK_API_ENABLED=String(ownerBookApi);
 must(isDeepStrictEqual(expected,merged),'R1 may change only the application image, RELEASE_SHA and explicitly approved Command Book API flag; gateway, Auth, networks, volumes and other environment must remain identical.');
}
async function anchors(profile){
 must(profile.releaseSha===productionBase&&profile.mailMode==='disabled'&&profile.gatewayOverride,'R1 requires the verified no-mail 7f794a2 profile with active n8n gateway. No fallback to a base-only gateway.');
 const gateway=await checkGatewayProfile(profile);
 const files=[...['manifest.json','compose.env','app.env','auth.env','proxy-token','Caddyfile'].map(n=>path.join(profile.directory,n)),
  ...['manifest.json','Caddyfile','compose.override.json','state.json'].map(n=>path.join(gateway.directory,n)),path.join(profile.sourceDirectory,'manifest.json'),path.join(profile.sourceDirectory,'production-no-mail/selected.json')];
 const result={};for(const file of files){await regular(file);result[file]=sha(await readFile(file));}
 for(const name of ['deploy/production/compose.yaml','deploy/production/caddy-entrypoint.sh','deploy/automation/Caddyfile.append'])result[path.join(repositoryRoot,name)]=sha(await readFile(path.join(repositoryRoot,name)));
 return result;
}
async function updateAnchors(profile,previousRelease){
 const result=await anchors(profile);
 if([ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(previousRelease)){
  const directory=path.join(profile.sourceDirectory,'international-r1',previousRelease);
  // The active R1 override is part of the current production configuration,
  // even though original 7f manifests deliberately remain unchanged.
  const prior=await checkApplicationPlan({profile,directory});Object.assign(result,prior.fingerprints);
  for(const name of ['plan.json','application.json','rollback.json','apply-application.sh','rollback-application.sh',...(prior.ownerBookApi===true?['disabled.json']:[]),...(prior.ownerBookMcp===true?['mcp-disabled.json','previous-acceptance.json']:[]),...(prior.ownerBookOAuth===true?['oauth-disabled.json']:[]),...(prior.ownerBookMcpCreate===true?['create-disabled.json']:[]),...(prior.ownerBookMcpWrite===true?['write-disabled.json']:[])]){const file=path.join(directory,name),s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===(name.endsWith('.sh')?0o700:0o600),'Unsafe previous R1 configuration file.');result[file]=sha(await readFile(file));}
 }
 return result;
}
export async function prepareApplicationPlan({profile,image,releaseSha,previousImage,previousReleaseSha,ownerBookApi,previousOwnerBookApi,ownerBookMcp,previousOwnerBookMcp,ownerBookOAuth,previousOwnerBookOAuth,ownerBookMcpCreate,previousOwnerBookMcpCreate,ownerBookMcpWrite,previousOwnerBookMcpWrite,previousAcceptance,expectedPreviousReleaseSha=productionBase}){
 must(imagePattern.test(image)&&imagePattern.test(previousImage)&&releasePattern.test(releaseSha)&&[productionBase,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha)&&previousReleaseSha===expectedPreviousReleaseSha,'Use actual immutable images and an explicitly reviewed update base.');
 must(releaseSha!==previousReleaseSha,'Update and previous release must be distinct.');
 const fingerprints=await updateAnchors(profile,expectedPreviousReleaseSha);
 if([ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha)){const old=await checkApplicationPlan({profile,directory:path.join(profile.sourceDirectory,'international-r1',expectedPreviousReleaseSha)});must(old.image===previousImage&&old.ownerBookApi===[ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha),'The active R1 image/flag differs from its verified plan.');}
 must([ownerBookApi,previousOwnerBookApi,ownerBookMcp,previousOwnerBookMcp,ownerBookOAuth,previousOwnerBookOAuth,ownerBookMcpCreate,previousOwnerBookMcpCreate,ownerBookMcpWrite,previousOwnerBookMcpWrite].every(v=>v===undefined||typeof v==='boolean'),'Invalid Command Book API selection.');
 if(expectedPreviousReleaseSha===ownerBookApiR1)must(ownerBookMcp===true&&ownerBookApi===true&&previousOwnerBookApi===true&&previousOwnerBookMcp!==true,'MCP update must preserve the accepted REST API and start with MCP disabled.');
 if(ownerBookMcp!==undefined)must([ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha),'MCP selection requires the accepted API base.');
 if(expectedPreviousReleaseSha===ownerBookApiR1)must(previousAcceptance?.release===ownerBookApiR1&&previousAcceptance.phase==='DEPLOYED_AND_VERIFIED'&&previousAcceptance.purpose==='book-api'&&previousAcceptance.ownerInteractiveAcceptance===true&&previousAcceptance.image===previousImage&&previousAcceptance.sourceDirectory===profile.sourceDirectory,'Verified previous OWNER acceptance and image required.');
 if(expectedPreviousReleaseSha===ownerBookMcpR1)must(ownerBookOAuth===true&&ownerBookApi===true&&ownerBookMcp===true&&previousOwnerBookApi===true&&previousOwnerBookMcp===true&&previousOwnerBookOAuth!==true&&previousAcceptance?.release===ownerBookMcpR1&&previousAcceptance.phase==='DEPLOYED_AND_VERIFIED'&&previousAcceptance.purpose==='book-mcp'&&previousAcceptance.ownerInteractiveAcceptance===true&&previousAcceptance.image===previousImage&&previousAcceptance.sourceDirectory===profile.sourceDirectory,'Accepted deployed MCP checkpoint required for OAuth.');
 if(ownerBookOAuth!==undefined)must([ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha),'OAuth requires the reviewed MCP base.');
 if(expectedPreviousReleaseSha===ownerBookOAuthR1)must(ownerBookMcpCreate===true&&previousOwnerBookMcpCreate!==true&&ownerBookOAuth===true&&previousOwnerBookOAuth===true&&ownerBookMcp===true&&previousOwnerBookMcp===true&&ownerBookApi===true&&previousOwnerBookApi===true&&previousAcceptance?.release===ownerBookOAuthR1&&previousAcceptance.phase==='DEPLOYED_AND_VERIFIED'&&previousAcceptance.purpose==='book-oauth'&&previousAcceptance.ownerInteractiveAcceptance===true&&previousAcceptance.image===previousImage&&previousAcceptance.sourceDirectory===profile.sourceDirectory,'Accepted OAuth release required for temporary additions.');
 if(ownerBookMcpCreate!==undefined)must([ownerBookOAuthR1,ownerBookAppendR1].includes(expectedPreviousReleaseSha),'Temporary additions require accepted 599fc33.');
 if(expectedPreviousReleaseSha===ownerBookAppendR1)must(ownerBookMcpWrite===true&&previousOwnerBookMcpWrite===false&&ownerBookMcpCreate===true&&previousOwnerBookMcpCreate===true&&ownerBookOAuth===true&&previousOwnerBookOAuth===true&&ownerBookMcp===true&&previousOwnerBookMcp===true&&ownerBookApi===true&&previousOwnerBookApi===true&&previousAcceptance?.release===ownerBookAppendR1&&previousAcceptance.purpose==='book-create'&&previousAcceptance.phase==='DEPLOYED_AND_VERIFIED'&&previousAcceptance.ownerInteractiveAcceptance===true&&previousAcceptance.image===previousImage&&previousAcceptance.sourceDirectory===profile.sourceDirectory,'Accepted append release required for scoped writes.');
 if(ownerBookMcpWrite!==undefined)must(expectedPreviousReleaseSha===ownerBookAppendR1,'Scoped writes require accepted 14cc879.');
 const parent=path.join(profile.sourceDirectory,'international-r1');await mkdir(parent,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await regular(parent,true);
 const directory=path.join(parent,releaseSha);await mkdir(directory,{mode:0o700});
 const app=override(image,releaseSha,ownerBookApi,ownerBookMcp,ownerBookOAuth,ownerBookMcpCreate,ownerBookMcpWrite),rollback=override(previousImage,previousReleaseSha,previousOwnerBookApi,previousOwnerBookMcp,previousOwnerBookOAuth,previousOwnerBookMcpCreate,previousOwnerBookMcpWrite);
 if(ownerBookApi===true)await writeFile(path.join(directory,'disabled.json'),JSON.stringify(override(image,releaseSha,false,ownerBookMcp===undefined?undefined:false,ownerBookOAuth===undefined?undefined:false,ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite===undefined?undefined:false),null,2)+'\n',{mode:0o600,flag:'wx'});
 if(ownerBookMcp===true)await writeFile(path.join(directory,'mcp-disabled.json'),JSON.stringify(override(image,releaseSha,ownerBookApi,false,ownerBookOAuth===undefined?undefined:false,ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite===undefined?undefined:false),null,2)+'\n',{mode:0o600,flag:'wx'});
 if(ownerBookOAuth===true)await writeFile(path.join(directory,'oauth-disabled.json'),JSON.stringify(override(image,releaseSha,ownerBookApi,ownerBookMcp,false,ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite===undefined?undefined:false),null,2)+'\n',{mode:0o600,flag:'wx'});
 if(ownerBookMcpWrite===true)await writeFile(path.join(directory,'write-disabled.json'),JSON.stringify(override(image,releaseSha,ownerBookApi,ownerBookMcp,ownerBookOAuth,ownerBookMcpCreate,false),null,2)+'\n',{mode:0o600,flag:'wx'});
 if(ownerBookMcpCreate===true)await writeFile(path.join(directory,'create-disabled.json'),JSON.stringify(override(image,releaseSha,ownerBookApi,ownerBookMcp,ownerBookOAuth,false,ownerBookMcpWrite),null,2)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(path.join(directory,'application.json'),JSON.stringify(app,null,2)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(path.join(directory,'rollback.json'),JSON.stringify(rollback,null,2)+'\n',{mode:0o600,flag:'wx'});
 for(const rollback of [false,true])await writeFile(path.join(directory,rollback?'rollback-application.sh':'apply-application.sh'),operatorScript(profile,directory,rollback),{mode:0o700,flag:'wx'});
 let previousAcceptanceSha;if(previousAcceptance){const bytes=JSON.stringify(previousAcceptance,null,2)+'\n';previousAcceptanceSha=sha(bytes);await writeFile(path.join(directory,'previous-acceptance.json'),bytes,{mode:0o600,flag:'wx'});}
 const plan={kind:'shadowbridge-international-r1-plan-v1',project:profile.project,sourceDirectory:profile.sourceDirectory,productionDirectory:profile.directory,releaseSha,previousReleaseSha,expectedPreviousReleaseSha,image,previousImage,ownerBookApi,previousOwnerBookApi,ownerBookMcp,previousOwnerBookMcp,ownerBookOAuth,previousOwnerBookOAuth,ownerBookMcpCreate,previousOwnerBookMcpCreate,ownerBookMcpWrite,previousOwnerBookMcpWrite,previousAcceptanceSha,fingerprints,createdAt:new Date().toISOString(),deployed:false};
 await writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
 return {directory,plan};
}
export async function checkApplicationPlan({profile,directory}){
 must(path.dirname(directory)===path.join(profile.sourceDirectory,'international-r1')&&releasePattern.test(path.basename(directory)),'R1 plan must belong to this exact installation.');
 await regular(path.dirname(directory),true);await regular(directory,true);await regular(path.join(directory,'plan.json'));
 const plan=JSON.parse(await readFile(path.join(directory,'plan.json'),'utf8'));
 must(plan.previousReleaseSha!==plan.releaseSha,'A rollback plan cannot reference its own release.');
 must(plan.kind==='shadowbridge-international-r1-plan-v1'&&plan.sourceDirectory===profile.sourceDirectory&&plan.productionDirectory===profile.directory&&plan.project===profile.project&&plan.releaseSha===path.basename(directory)&&[productionBase,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(plan.expectedPreviousReleaseSha??productionBase)&&plan.previousReleaseSha===(plan.expectedPreviousReleaseSha??productionBase)&&imagePattern.test(plan.image)&&imagePattern.test(plan.previousImage),'Invalid R1 installation/rollback identity.');
 must(isDeepStrictEqual(plan.fingerprints,await updateAnchors(profile,plan.expectedPreviousReleaseSha??productionBase)),'Existing production or gateway configuration changed after planning. Stop; do not regenerate manifests.');
 must([plan.ownerBookApi,plan.previousOwnerBookApi,plan.ownerBookMcp,plan.previousOwnerBookMcp,plan.ownerBookOAuth,plan.previousOwnerBookOAuth,plan.ownerBookMcpCreate,plan.previousOwnerBookMcpCreate,plan.ownerBookMcpWrite,plan.previousOwnerBookMcpWrite].every(v=>v===undefined||typeof v==='boolean'),'Invalid Command Book API selection.');
 if(plan.ownerBookOAuth!==undefined)must([ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(plan.expectedPreviousReleaseSha),'OAuth cannot be added to a historical release plan.');
 for(const [name,expected] of [['application.json',override(plan.image,plan.releaseSha,plan.ownerBookApi,plan.ownerBookMcp,plan.ownerBookOAuth,plan.ownerBookMcpCreate,plan.ownerBookMcpWrite)],['rollback.json',override(plan.previousImage,plan.previousReleaseSha,plan.previousOwnerBookApi,plan.previousOwnerBookMcp,plan.previousOwnerBookOAuth,plan.previousOwnerBookMcpCreate,plan.previousOwnerBookMcpWrite)]]){
  const file=path.join(directory,name);await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),expected),'R1 application override was modified.');
 }
 if(plan.ownerBookApi===true){const file=path.join(directory,'disabled.json');await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),override(plan.image,plan.releaseSha,false,plan.ownerBookMcp===undefined?undefined:false,plan.ownerBookOAuth===undefined?undefined:false,plan.ownerBookMcpCreate===undefined?undefined:false,plan.ownerBookMcpWrite===undefined?undefined:false)),'API disable override was modified.');}
 if(plan.expectedPreviousReleaseSha===ownerBookApiR1)must(plan.ownerBookMcp===true&&plan.ownerBookApi===true&&plan.previousOwnerBookApi===true&&plan.previousOwnerBookMcp!==true,'Invalid MCP update policy.');
 if(plan.expectedPreviousReleaseSha===ownerBookApiR1){const file=path.join(directory,'previous-acceptance.json');await regular(file);const bytes=await readFile(file),old=JSON.parse(bytes);must(sha(bytes)===plan.previousAcceptanceSha&&old.release===ownerBookApiR1&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.purpose==='book-api'&&old.ownerInteractiveAcceptance===true&&old.image===plan.previousImage&&old.sourceDirectory===profile.sourceDirectory,'Previous accepted checkpoint changed.');}
 if(plan.ownerBookMcp===true){const file=path.join(directory,'mcp-disabled.json');await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),override(plan.image,plan.releaseSha,plan.ownerBookApi,false,plan.ownerBookOAuth===undefined?undefined:false,plan.ownerBookMcpCreate===undefined?undefined:false,plan.ownerBookMcpWrite===undefined?undefined:false)),'MCP disable override was modified.');}
 if(plan.expectedPreviousReleaseSha===ownerBookMcpR1){must(plan.ownerBookOAuth===true&&plan.ownerBookApi===true&&plan.ownerBookMcp===true&&plan.previousOwnerBookApi===true&&plan.previousOwnerBookMcp===true&&plan.previousOwnerBookOAuth!==true,'Invalid OAuth policy.');const file=path.join(directory,'previous-acceptance.json');await regular(file);const bytes=await readFile(file),old=JSON.parse(bytes);must(sha(bytes)===plan.previousAcceptanceSha&&old.release===ownerBookMcpR1&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.purpose==='book-mcp'&&old.ownerInteractiveAcceptance===true&&old.image===plan.previousImage&&old.sourceDirectory===profile.sourceDirectory,'Previous accepted MCP changed.');}
 if(plan.ownerBookOAuth===true){const file=path.join(directory,'oauth-disabled.json');await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),override(plan.image,plan.releaseSha,plan.ownerBookApi,plan.ownerBookMcp,false,plan.ownerBookMcpCreate===undefined?undefined:false,plan.ownerBookMcpWrite===undefined?undefined:false)),'OAuth disable changed.');}
 if(plan.expectedPreviousReleaseSha===ownerBookOAuthR1){must(plan.ownerBookMcpCreate===true&&plan.previousOwnerBookMcpCreate!==true&&plan.ownerBookOAuth===true&&plan.previousOwnerBookOAuth===true&&plan.ownerBookMcp===true&&plan.previousOwnerBookMcp===true&&plan.ownerBookApi===true&&plan.previousOwnerBookApi===true,'Invalid append policy.');const f=path.join(directory,'previous-acceptance.json');await regular(f);const bytes=await readFile(f),old=JSON.parse(bytes);must(sha(bytes)===plan.previousAcceptanceSha&&old.release===ownerBookOAuthR1&&old.purpose==='book-oauth'&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.ownerInteractiveAcceptance===true&&old.image===plan.previousImage&&old.sourceDirectory===profile.sourceDirectory,'Previous accepted OAuth changed.');}
 if(plan.ownerBookMcpCreate!==undefined)must([ownerBookOAuthR1,ownerBookAppendR1].includes(plan.expectedPreviousReleaseSha),'Append cannot alter a historical plan.');
 if(plan.ownerBookMcpCreate===true){const file=path.join(directory,'create-disabled.json');await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),override(plan.image,plan.releaseSha,plan.ownerBookApi,plan.ownerBookMcp,plan.ownerBookOAuth,false,plan.ownerBookMcpWrite)),'Append disable changed.');}
 if(plan.ownerBookMcpWrite!==undefined)must(plan.expectedPreviousReleaseSha===ownerBookAppendR1,'Scoped writes cannot alter a historical plan.');
 if(plan.expectedPreviousReleaseSha===ownerBookAppendR1){must(plan.ownerBookMcpWrite===true&&plan.previousOwnerBookMcpWrite===false&&plan.ownerBookMcpCreate===true&&plan.previousOwnerBookMcpCreate===true&&plan.ownerBookOAuth===true&&plan.previousOwnerBookOAuth===true&&plan.ownerBookMcp===true&&plan.previousOwnerBookMcp===true&&plan.ownerBookApi===true&&plan.previousOwnerBookApi===true,'Invalid scoped-write policy.');const file=path.join(directory,'previous-acceptance.json');await regular(file);const bytes=await readFile(file),old=JSON.parse(bytes);must(sha(bytes)===plan.previousAcceptanceSha&&old.release===ownerBookAppendR1&&old.purpose==='book-create'&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.ownerInteractiveAcceptance===true&&old.image===plan.previousImage&&old.sourceDirectory===profile.sourceDirectory,'Previous accepted append changed.');}
 if(plan.ownerBookMcpWrite===true){const file=path.join(directory,'write-disabled.json');await regular(file);must(isDeepStrictEqual(JSON.parse(await readFile(file,'utf8')),override(plan.image,plan.releaseSha,plan.ownerBookApi,plan.ownerBookMcp,plan.ownerBookOAuth,plan.ownerBookMcpCreate,false)),'Write disable changed.');}
 for(const rollback of [false,true]){
  const file=path.join(directory,rollback?'rollback-application.sh':'apply-application.sh');
  const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700&&(await readFile(file,'utf8'))===operatorScript(profile,directory,rollback),'R1 operator script was modified.');
 }
 return plan;
}
export function applicationArguments(profile,directory,rollback=false){
 must(path.dirname(directory)===path.join(profile.sourceDirectory,'international-r1')&&releasePattern.test(path.basename(directory)),'Invalid R1 plan location.');
 return publicComposeArguments(profile,['-f',path.join(directory,rollback?'rollback.json':'application.json'),'up','-d','--no-build','--no-deps','--wait','--wait-timeout','120','app']);
}
export function disabledApplicationArguments(profile,directory,{mcpOnly=false,oauthOnly=false,createOnly=false,writeOnly=false}={}){
 must(path.dirname(directory)===path.join(profile.sourceDirectory,'international-r1')&&releasePattern.test(path.basename(directory)),'Invalid R1 plan location.');
 return publicComposeArguments(profile,['-f',path.join(directory,writeOnly?'write-disabled.json':createOnly?'create-disabled.json':oauthOnly?'oauth-disabled.json':mcpOnly?'mcp-disabled.json':'disabled.json'),'up','-d','--no-build','--no-deps','--wait','--wait-timeout','120','app']);
}
const docker=(args,env={})=>{
 try{return execFileSync('docker',['--context','default',...args],{cwd:repositoryRoot,env:{...process.env,...env},encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024}).trim();}
 catch{throw new Error('R1 Docker inspection/configuration failed. Private output was suppressed.');}
};
export function checkMergedApplication(profile,directory,plan){
 const env=profile.composeEnvironment;
 const base=JSON.parse(docker(publicComposeArguments(profile,['config','--format','json']),env));
 for(const rollback of [false,true]){
  const args=applicationArguments(profile,directory,rollback).slice(0,-8); // replace the fixed up command by read-only config
  const merged=JSON.parse(docker([...args,'config','--format','json'],env));
  assertApplicationOnly(base,merged,{image:rollback?plan.previousImage:plan.image,releaseSha:rollback?plan.previousReleaseSha:plan.releaseSha,ownerBookApi:rollback?plan.previousOwnerBookApi:plan.ownerBookApi,ownerBookMcp:rollback?plan.previousOwnerBookMcp:plan.ownerBookMcp,ownerBookOAuth:rollback?plan.previousOwnerBookOAuth:plan.ownerBookOAuth,ownerBookMcpCreate:rollback?plan.previousOwnerBookMcpCreate:plan.ownerBookMcpCreate,ownerBookMcpWrite:rollback?plan.previousOwnerBookMcpWrite:plan.ownerBookMcpWrite});
 }
 if(plan.ownerBookApi===true){const args=disabledApplicationArguments(profile,directory).slice(0,-8),merged=JSON.parse(docker([...args,'config','--format','json'],env));assertApplicationOnly(base,merged,{image:plan.image,releaseSha:plan.releaseSha,ownerBookApi:false,ownerBookMcp:plan.ownerBookMcp===undefined?undefined:false,ownerBookOAuth:plan.ownerBookOAuth===undefined?undefined:false,ownerBookMcpCreate:plan.ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite:plan.ownerBookMcpWrite===undefined?undefined:false});}
 if(plan.ownerBookMcpWrite===true){const args=disabledApplicationArguments(profile,directory,{writeOnly:true}).slice(0,-8),merged=JSON.parse(docker([...args,'config','--format','json'],env));assertApplicationOnly(base,merged,{image:plan.image,releaseSha:plan.releaseSha,ownerBookApi:plan.ownerBookApi,ownerBookMcp:plan.ownerBookMcp,ownerBookOAuth:plan.ownerBookOAuth,ownerBookMcpCreate:plan.ownerBookMcpCreate,ownerBookMcpWrite:false});}
 if(plan.ownerBookMcpCreate===true){const args=disabledApplicationArguments(profile,directory,{createOnly:true}).slice(0,-8),merged=JSON.parse(docker([...args,'config','--format','json'],env));assertApplicationOnly(base,merged,{image:plan.image,releaseSha:plan.releaseSha,ownerBookApi:plan.ownerBookApi,ownerBookMcp:plan.ownerBookMcp,ownerBookOAuth:plan.ownerBookOAuth,ownerBookMcpCreate:false,ownerBookMcpWrite:plan.ownerBookMcpWrite});}
 if(plan.ownerBookOAuth===true){const args=disabledApplicationArguments(profile,directory,{oauthOnly:true}).slice(0,-8),merged=JSON.parse(docker([...args,'config','--format','json'],env));assertApplicationOnly(base,merged,{image:plan.image,releaseSha:plan.releaseSha,ownerBookApi:plan.ownerBookApi,ownerBookMcp:plan.ownerBookMcp,ownerBookOAuth:false,ownerBookMcpCreate:plan.ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite:plan.ownerBookMcpWrite===undefined?undefined:false});}
 if(plan.ownerBookMcp===true){const args=disabledApplicationArguments(profile,directory,{mcpOnly:true}).slice(0,-8),merged=JSON.parse(docker([...args,'config','--format','json'],env));assertApplicationOnly(base,merged,{image:plan.image,releaseSha:plan.releaseSha,ownerBookApi:plan.ownerBookApi,ownerBookMcp:false,ownerBookOAuth:plan.ownerBookOAuth===undefined?undefined:false,ownerBookMcpCreate:plan.ownerBookMcpCreate===undefined?undefined:false,ownerBookMcpWrite:plan.ownerBookMcpWrite===undefined?undefined:false});}
}
export async function applicationBackupFiles(profile,directory,plan){
 const result=Object.fromEntries(Object.entries(plan.fingerprints).filter(([f])=>f.startsWith(profile.sourceDirectory+path.sep)).map(([f,h])=>[path.relative(profile.sourceDirectory,f),h]));
 for(const name of ['plan.json','application.json','rollback.json','apply-application.sh','rollback-application.sh',...(plan.ownerBookApi===true?['disabled.json']:[]),...(plan.ownerBookMcp===true?['mcp-disabled.json','previous-acceptance.json']:[]),...(plan.ownerBookOAuth===true?['oauth-disabled.json']:[]),...(plan.ownerBookMcpCreate===true?['create-disabled.json']:[]),...(plan.ownerBookMcpWrite===true?['write-disabled.json']:[])])result[path.relative(profile.sourceDirectory,path.join(directory,name))]=sha(await readFile(path.join(directory,name)));
 return result;
}
export async function backupApplicationConfiguration({profile,directory}){
 const plan=await checkApplicationPlan({profile,directory});
 const folder=path.join(directory,'configuration-backup-'+randomBytes(5).toString('hex'));await mkdir(folder,{mode:0o700});
 const files=Object.keys(await applicationBackupFiles(profile,directory,plan));
 const scratch=path.join(folder,'.plaintext-scratch.tar');
 const prior=process.umask(0o077);
 try{execFileSync('tar',['--format=ustar','-cf',scratch,'-C',profile.sourceDirectory,'--',...files],{stdio:['ignore','pipe','pipe']});}finally{process.umask(prior);}
 const backup=await encryptArchive({archiveFile:scratch,backupFile:path.join(folder,'production-and-gateway.sbb'),keyFile:path.join(folder,'production-and-gateway.key')});
 // Only this newly created plaintext scratch copy is removed after encryption.
 // Neither an existing backup/key nor any original configuration is removed.
 await unlink(scratch);
 return backup;
}
// A stopped gateway gives a consistent copy of its certificate/ACME state.
// Nothing is stopped here. These volumes are never restored onto the source.
export async function backupGatewayVolumes({profile,directory}){
 const plan=await checkApplicationPlan({profile,directory});
 const running=docker(publicComposeArguments(profile,['ps','--services','--status','running']),profile.composeEnvironment).split('\n');
 must(!['gateway','app','auth'].some(s=>running.includes(s)),'Pause this installation gateway, app and auth before its certificate backup. No service was stopped automatically.');
 const id=docker(publicComposeArguments(profile,['ps','--all','--quiet','gateway']),profile.composeEnvironment);
 must(/^[a-f0-9]{64}$/.test(id),'One existing stopped gateway is required.');
 const container=JSON.parse(docker(['inspect',id]))[0];
 must(!container.State.Running&&container.Config.Labels?.['com.docker.compose.project']===profile.project&&container.Config.Labels?.['com.docker.compose.service']==='gateway','Gateway does not belong to the selected installation.');
 const mounts=['/data','/config'].map(destination=>container.Mounts.find(m=>m.Destination===destination));
 must(mounts.every(m=>m?.Type==='volume'&&typeof m.Name==='string'),'Persistent Caddy data/config volumes are required.');
 const folder=path.join(directory,'edge-backup-'+randomBytes(5).toString('hex'));await mkdir(folder,{mode:0o700});
 for(const name of ['data','config']){await mkdir(path.join(folder,name),{mode:0o700});docker(['cp',id+':/'+name+'/.',path.join(folder,name)]);}
 const hashes={};let bytes=0;
 async function walk(relative){
  for(const name of await readdir(path.join(folder,relative))){
   const file=path.join(relative,name),info=await lstat(path.join(folder,file));
   must(!info.isSymbolicLink(),'Certificate backup refuses symbolic links.');
   if(info.isDirectory())await walk(file);
   else{must(info.isFile()&&info.size<=64*1024**2,'Unexpected certificate storage file.');bytes+=info.size;must(bytes<=256*1024**2,'Certificate storage exceeds the reviewed backup bound.');hashes[file]=sha(await readFile(path.join(folder,file)));}
  }
 }
 await walk('data');await walk('config');
 await writeFile(path.join(folder,'edge.json'),JSON.stringify({kind:'shadowbridge-r1-edge-backup-v1',project:profile.project,release:plan.releaseSha,container:id,volumes:mounts.map(m=>m.Name),hashes})+'\n',{mode:0o600,flag:'wx'});
 const scratch=path.join(folder,'edge.tar'),previous=process.umask(0o077);
 try{execFileSync('tar',['--format=ustar','-cf',scratch,'-C',folder,'--','data','config','edge.json'],{stdio:['ignore','pipe','pipe']});}finally{process.umask(previous);}
 const backup=await encryptArchive({archiveFile:scratch,backupFile:path.join(folder,'caddy-state.sbb'),keyFile:path.join(folder,'caddy-state.key')});
 await unlink(scratch);
 // Private copied files are retained for diagnostics/recovery; source volumes,
 // backup and recovery key are never removed or changed.
 return {...backup,encrypted:true,sourceVolumesUnchanged:true};
}
export async function verifyR1Http(releaseSha,{request=fetch,readOnly=false}={}){
 const application=await verifyPublic(releaseSha,{request,mailDisabled:true,readOnly});
 for(const pathname of ['/healthz','/signin']){
  const response=await request('https://automation.shadow-bridge.eu'+pathname,{redirect:'manual',headers:{Accept:pathname==='/signin'?'text/html':'application/json'},signal:AbortSignal.timeout(15000)});
  must(response.status===200&&!response.headers.has('www-authenticate'),'Automation HTTPS health/sign-in failed.');
  if(pathname==='/healthz')must((await response.json()).status==='ok','n8n health is not OK.');else {must(/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||''),'n8n sign-in must be an HTML page.');await response.arrayBuffer();}
 }
 return {...application,automationHttpVerified:true,credentialsTested:false};
}
export async function preflightExistingR1(profile,{request=fetch,runtimeRelease=productionBase}={}){
 must([productionBase,ownerBookR1,ownerBookApiR1,ownerBookMcpR1,ownerBookOAuthR1,ownerBookAppendR1].includes(runtimeRelease),'Unreviewed runtime base.');
 await anchors(profile);
 const inspect=id=>JSON.parse(docker(['inspect',id]))[0];
 const service=name=>{
  const id=docker(publicComposeArguments(profile,['ps','-q',name]),profile.composeEnvironment);
  must(/^[a-f0-9]{64}$/.test(id),'One running '+name+' service is required.');
  const c=inspect(id);must(c.State.Running&&c.Config.Labels?.['com.docker.compose.project']===profile.project,'Unexpected running installation.');return c;
 };
 const app=service('app'),gateway=service('gateway');
 must(app.Config.Env.includes('RELEASE_SHA='+runtimeRelease),'Preflight requires the existing baseline release; never overwrite a newer installation.');
 for(const c of [app,service('auth'),service('postgres')])must(Object.values(c.HostConfig.PortBindings||{}).every(v=>!v?.length),'Application, Auth and database must not publish host ports.');
 const automation=inspect(n8nContainer),edge=JSON.parse(docker(['network','inspect',edgeNetwork]))[0];
 must(edge.Internal&&automation.State.Running&&gateway.NetworkSettings.Networks[edgeNetwork]?.NetworkID===edge.Id&&automation.NetworkSettings.Networks[edgeNetwork]?.NetworkID===edge.Id,'Existing Caddy/n8n internal network is not ready.');
 must(Object.values(automation.HostConfig.PortBindings||{}).flat().filter(Boolean).every(p=>['127.0.0.1','::1'].includes(p.HostIp)),'n8n must not publish public host ports.');
 const query=text=>docker(publicComposeArguments(profile,['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',text]),profile.composeEnvironment);
 const ledger=JSON.parse(query('SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));
 validateApplied(await migrationSources(),ledger);must(runtimeRelease===productionBase||ledger.length===(runtimeRelease===ownerBookAppendR1?20:runtimeRelease===ownerBookOAuthR1?19:18),'Reviewed baseline migration count required.');must(ledger.length>=15,'The existing schema must include the reviewed MVP/Sentinel foundation.');
 const owners=Number(query("SELECT count(*) FROM sb.staff_role_assignments r JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND g.active AND a.status='active' AND lower(a.email)=lower(u.email) AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.factor_type='totp' AND f.status='verified')"));
 must(owners>0,'No existing active OWNER with verified email and enrolled MFA was found. Stop and review access; no account was changed.');
 docker(publicComposeArguments(profile,['exec','-T','app','node','-e',"fetch('https://auth-proxy:8444/auth/v1/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{await r.arrayBuffer();if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]),profile.composeEnvironment);
 await verifyR1Http(runtimeRelease,{request,readOnly:true});
 return {result:'PASS',readOnly:true,configurationAnchor:productionBase,appliedMigrations:ledger.length,ownerWithVerifiedEmailAndMfaConfigured:true,ownerInteractiveLoginStillRequired:true,automationHttpVerified:true,secretsPrinted:false,deployed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 (async()=>{
  const [action,...args]=process.argv.slice(2),options={};
  for(const arg of args){const m=/^--(dir|release|image|plan|book-api)=(.+)$/.exec(arg);must(m,'Use --dir=, --release=, --image=, --plan= or prepare --book-api=enabled|disabled.');options[m[1]]=m[2];}
  must(options['book-api']===undefined||action==='prepare'&&['enabled','disabled'].includes(options['book-api']),'Command Book API selection is explicit and allowed only while preparing a new plan.');
  const profile=await checkProduction({directory:options.dir});let directory,plan;
  if(action==='preflight'){console.log(JSON.stringify(await preflightExistingR1(profile)));return;}
  if(action==='prepare'){
   const git=parts=>execFileSync('git',parts,{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
   must(git(['branch','--show-current'])==='release/shadowbridge-international-r1'&&git(['rev-parse','HEAD'])===options.release&&!git(['status','--porcelain']),'Prepare only from the clean, reviewed R1 branch and its full HEAD.');
   for(const ref of [productionBase,'9a64cc0a0e4831e786e19bc1101a4126d66756ff','188cdafd8a91f215fd2c10aa4f893f482cb54564'])git(['merge-base','--is-ancestor',ref,'HEAD']);
   must(imagePattern.test(options.image||''),'Specify the built app image digest, never a mutable tag.');
   const candidate=JSON.parse(docker(['image','inspect',options.image]))[0];
   must(candidate.Id===options.image&&candidate.Config.Labels?.['org.opencontainers.image.revision']===options.release,'Candidate image is unavailable or its source revision does not match the reviewed release.');
   const id=docker(publicComposeArguments(profile,['ps','-q','app']),profile.composeEnvironment);must(/^[a-f0-9]{64}$/.test(id),'One running app container is required.');
   const app=JSON.parse(docker(['inspect',id]))[0];must(app.State.Running,'Existing application is not running.');
   const previousReleaseSha=(app.Config.Env||[]).find(v=>v.startsWith('RELEASE_SHA='))?.slice(12);
   const previousFlag=(app.Config.Env||[]).find(v=>v.startsWith('OWNER_BOOK_API_ENABLED='))?.split('=')[1];
   ({directory,plan}=await prepareApplicationPlan({profile,image:options.image,releaseSha:options.release,previousImage:app.Image,previousReleaseSha,ownerBookApi:options['book-api']===undefined?undefined:options['book-api']==='enabled',previousOwnerBookApi:previousFlag===undefined?undefined:previousFlag==='true'}));
  }else{must(['check','backup-config','backup-edge','verify','snapshot','preserved'].includes(action)&&options.plan,'Use prepare, check, backup-config, backup-edge, snapshot, preserved or verify. No automatic deployment command exists.');directory=path.resolve(repositoryRoot,options.plan);plan=await checkApplicationPlan({profile,directory});}
  checkMergedApplication(profile,directory,plan);
  if(action==='backup-config'){console.log(JSON.stringify({...(await backupApplicationConfiguration({profile,directory})),encrypted:true,sourceUnchanged:true}));return;}
  if(action==='backup-edge'){console.log(JSON.stringify(await backupGatewayVolumes({profile,directory})));return;}
  if(['snapshot','preserved'].includes(action)){
   const running=docker(publicComposeArguments(profile,['ps','--services','--status','running']),profile.composeEnvironment).split('\n');
   must(running.includes('postgres')&&!running.includes('app')&&!running.includes('auth'),'Pause this installation app and auth before taking/comparing data fingerprints. Leave PostgreSQL and gateway running.');
   const file=path.join(directory,'data-before.json');
   if(action==='snapshot')await writeFile(file,JSON.stringify({project:profile.project,release:plan.releaseSha,fingerprints:await databaseFingerprints(profile.sourceDirectory)})+'\n',{mode:0o600,flag:'wx'});
   else{
    await regular(file);const before=JSON.parse(await readFile(file,'utf8'));must(before.project===profile.project&&before.release===plan.releaseSha,'Snapshot belongs to another operation.');
    assertPreserved(before.fingerprints,await databaseFingerprints(profile.sourceDirectory),{allowMigrationBackfill:true});
    const ledger=JSON.parse(docker(publicComposeArguments(profile,['exec','-T','postgres','psql','-XqAt','-U','postgres','-d','shadowbridge','-c','SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t']),profile.composeEnvironment));
    const sources=await migrationSources();validateApplied(sources,ledger);must(ledger.length===sources.length,'The complete reviewed migration history is required.');
   }
   console.log(JSON.stringify({result:'PASS',action,recordsPrinted:false}));return;
  }
  if(action==='verify'){
   const id=docker(publicComposeArguments(profile,['ps','-q','app']),profile.composeEnvironment);must(/^[a-f0-9]{64}$/.test(id),'One app container is required.');
   const app=JSON.parse(docker(['inspect',id]))[0];must(app.State.Running&&app.Image===plan.image&&(app.Config.Env||[]).includes('RELEASE_SHA='+plan.releaseSha),'The planned R1 app image is not running.');
   docker(publicComposeArguments(profile,['exec','-T','app','node','-e',"fetch(process.env.SUPABASE_URL+'/auth/v1/health',{signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]),profile.composeEnvironment);
   console.log(JSON.stringify({...(await verifyR1Http(plan.releaseSha)),release:plan.releaseSha}));return;
  }
  console.log(JSON.stringify({result:'PASS',planDirectory:directory,project:profile.project,sourceDirectory:profile.sourceDirectory,productionDirectory:profile.directory,release:plan.releaseSha,configurationAnchor:profile.releaseSha,changes:'app image, release marker and only an explicitly selected book API flag',ownerBookApi:plan.ownerBookApi??'preserved',deployed:false}));
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
