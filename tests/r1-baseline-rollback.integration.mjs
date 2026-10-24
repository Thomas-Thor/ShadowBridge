// Actual 7f794a2 image against a NEW fictional clone with migrations 001–018.
// This checks the exact production rollback pairing, without restoring data.
import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
import{readFile,mkdir,writeFile}from'node:fs/promises';import{randomBytes}from'node:crypto';
import{inspectSpace}from'../scripts/workspace-space.mjs';import{baseline,catalog}from'../scripts/international-r1-diagnose.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');assert.equal((await inspectSpace({dockerRoot:'/tmp/shadowbridge-r1-isolated/overlay-data'})).result,'PASS');
const D=['--host','unix:///tmp/shadowbridge-r1-isolated/overlay.sock'],pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
const docker=(a,o={})=>execFileSync('docker',[...D,...a],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024**2,...o}).trim();
assert.equal(JSON.parse(docker(['inspect',pg]))[0].Config.Labels['com.docker.compose.project'],'shadowbridge-stageg-r1full-cd6f2078e0');
const id=randomBytes(4).toString('hex'),db='r1_old_app_018_'+id,app='shadowbridge-r1-old-app-018-'+id,dir=new URL('../.local/r1-old-app-018-'+id+'/',import.meta.url);await mkdir(dir,{mode:0o700,recursive:true});
const sql=(q,database=db)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q});
const report={kind:'actual-7f794a2-runtime-on-018',productionChanges:false,interactiveGoTrueLoginTested:false};let started=false;
try{
 const image=JSON.parse(docker(['image','inspect','shadowbridge-r1-full:baseline']))[0];assert.equal(image.Config.Labels['org.opencontainers.image.revision'],baseline);
 sql('CREATE DATABASE '+db+' TEMPLATE owner_book_test_2db3cf7b','postgres');assert.equal(sql('SELECT count(*) FROM shadowbridge_migrations.applied'),'18');
 const fingerprints=()=>sql("SELECT jsonb_object_agg(name,h)::text FROM (SELECT name,(xpath('/row/h/text()',query_to_xml(format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) AS h FROM %s t',name),false,true,'')))[1]::text h FROM (SELECT quote_ident(schemaname)||'.'||quote_ident(tablename) name FROM pg_tables WHERE schemaname IN ('auth','sb','portal','owner_vault','owner_book'))s)q");const before=fingerprints();
 const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0];
 const env=template.Config.Env.map(line=>{const i=line.indexOf('='),n=line.slice(0,i);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(n)){const u=new URL(line.slice(i+1));u.pathname='/'+db;return n+'='+u.href;}return n==='RELEASE_SHA'?'RELEASE_SHA='+baseline:line;});
 const file=new URL('app.env',dir).pathname;await writeFile(file,env.join('\n')+'\n',{mode:0o600});
 const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-/);const args=['run','-d','--name',app,'--network',network,'--env-file',file];
 for(const m of template.Mounts){assert.equal(m.Type,'bind');assert.equal(m.RW,false);args.push('--mount','type=bind,source='+m.Source+',target='+m.Destination+',readonly');}args.push(image.Id);docker(args);started=true;
 const request=p=>JSON.parse(docker(['exec',app,'node','-e',"fetch('http://127.0.0.1:8088'+process.argv[1]).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()})))",p]));
 let ready=false;for(let n=0;n<100;n++){try{ready=request('/health').status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true);
 assert.equal(JSON.parse(request('/api/config').body).backendEnabled,true);assert.equal(request('/assets/owner-book.js').status,404);
 const files=Object.keys(catalog.baselineRuntime),observed=docker(['exec',app,'sha256sum',...files.map(f=>'/app/'+f)]).split('\n');assert.equal(observed.length,61);
 for(const line of observed){const[digest,name]=line.split(/\s+/);assert.equal(digest,catalog.baselineRuntime[name.replace('/app/','')]);}
 assert.equal(fingerprints(),before);Object.assign(report,{result:'PASS',baselineImage:image.Id,baselineSha:baseline,baselineRuntimeFilesMatched:61,existingRowsUnchanged:true,bookRecordsRetained:true,databaseRetained:db});console.log('PASS actual 7f794a2 image + 018: health/config, all 61 source checksums, all protected data retained');
}catch(e){report.result='FAIL';await writeFile(new URL('private-failure.json',dir),JSON.stringify({message:e.message,stderr:String(e.stderr||'')})+'\n',{mode:0o600});process.exitCode=1;console.error('FAIL: private baseline rollback diagnostic retained');}
finally{if(started)docker(['stop',app]);await writeFile(new URL('results.json',dir),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
