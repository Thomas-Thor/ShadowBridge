// Actual file restoration and read-only Docker target isolation. No service is
// started, no real profile is read, and no owner data or secret is printed.
import test from'node:test';import assert from'node:assert/strict';import{randomBytes,createHash}from'node:crypto';import{mkdir,readFile,writeFile,cp}from'node:fs/promises';import path from'node:path';
import{prepareStaging,readEnv,repositoryRoot}from'../scripts/staging-prepare.mjs';import{restoreConfiguration}from'../scripts/staging-backup.mjs';
test('restored configuration preserves credentials but disables remote book API so old backups cannot silently resurrect access',async()=>{
 const tag=randomBytes(5).toString('hex'),source=path.join(repositoryRoot,'.local','book-source-'+tag),extracted=path.join(repositoryRoot,'.local','restore-book-'+tag),target=path.join(repositoryRoot,'.local','contabo-restore-book-'+tag);
 await prepareStaging({directory:source,project:'shadowbridge-stageg-booksource-'+tag,httpsPort:25443});
 const appFile=path.join(source,'app.env');await writeFile(appFile,(await readFile(appFile,'utf8'))+'OWNER_BOOK_API_ENABLED=true\n',{mode:0o600});
 const file=path.join(source,'manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));manifest.hashes['app.env']=createHash('sha256').update(await readFile(appFile)).digest('hex');await writeFile(file,JSON.stringify(manifest)+'\n',{mode:0o600});
 const before=await readFile(appFile),values=await readEnv(appFile);await mkdir(extracted,{mode:0o700});await cp(source,path.join(extracted,'configuration'),{recursive:true});
 await restoreConfiguration({restoredDirectory:extracted,directory:target,project:'shadowbridge-stageg-restore-book-'+tag,httpsPort:26443});
 const restored=await readEnv(path.join(target,'app.env'));assert.equal(restored.OWNER_BOOK_API_ENABLED,'false');assert.equal(restored.APP_URL,'https://localhost:26443');
 for(const name of ['DATABASE_URL','SESSION_DATABASE_URL','SESSION_ENCRYPTION_KEY','SUPABASE_ANON_KEY'])assert.equal(restored[name],values[name]);
 assert.deepEqual(await readFile(appFile),before);
});
