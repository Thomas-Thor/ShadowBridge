import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, chmod, rm, stat, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaging, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { encryptArchive, decryptBackup } from '../scripts/staging-backup.mjs';

// File/crypto tests only. No database, container or owner installation is used.
test('authenticated recovery files are private, complete and fail closed',async t=>{
  const id=randomBytes(6).toString('hex');
  const base=path.join(repositoryRoot,'.local',`backup-test-${id}`);
  const config=path.join(base,'configuration');
  const secretFiles=['compose.env','postgres.env','auth.env','app.env','migration.env','tester-password','Caddyfile','manifest.json',
    ...['internal-ca.crt','internal-ca.key','postgres.crt','postgres.key','auth-proxy.crt','auth-proxy.key','public.crt','public.key'].map(name=>`certs/${name}`)];
  const names=['database.dump','backup.json',...secretFiles.map(name=>`configuration/${name}`)];
  const archive=path.join(base,'source.tar'), encrypted=path.join(base,'recovery.sbb'), key=path.join(base,'recovery.key');
  const destinations=[];
  const target=label=>{const value=path.join(repositoryRoot,'.local',`restore-${id}-${label}`);destinations.push(value);return value;};
  try {
    await mkdir(base,{mode:0o700});
    await prepareStaging({directory:config,project:`shadowbridge-stageg-bkp-${id}`,httpsPort:25443});
    await writeFile(path.join(base,'database.dump'),'PGDMP FICTIONAL UNIT FIXTURE ONLY\n',{mode:0o600});
    await writeFile(path.join(base,'backup.json'),JSON.stringify({kind:'shadowbridge-recovery-v1',database:'shadowbridge',project:`shadowbridge-stageg-bkp-${id}`}),{mode:0o600});
    execFileSync('tar',['--format=ustar','-cf',archive,'--',...names],{cwd:base});await chmod(archive,0o600);
    await t.test('round trip verifies GCM and extracts only complete allowlisted regular files',async()=>{
      await encryptArchive({archiveFile:archive,backupFile:encrypted,keyFile:key});
      assert.equal((await stat(encrypted)).mode&0o777,0o600);assert.equal((await stat(key)).mode&0o777,0o600);
      const result=await decryptBackup({backupFile:encrypted,keyFile:key,destination:target('valid')});
      assert.equal(await readFile(result.databaseDump,'utf8'),'PGDMP FICTIONAL UNIT FIXTURE ONLY\n');
      for(const name of secretFiles)assert.deepEqual(await readFile(path.join(result.configuration,name)),await readFile(path.join(config,name)));
      await assert.rejects(access(path.join(result.directory,'authenticated-payload.tar')));
    });
    await t.test('existing backup is never overwritten and existing extraction is refused',async()=>{
      const before=await readFile(encrypted);
      await assert.rejects(encryptArchive({archiveFile:archive,backupFile:encrypted,keyFile:key}),/EEXIST/);
      assert.deepEqual(await readFile(encrypted),before);
      const existing=target('occupied');await mkdir(existing,{mode:0o700});
      await writeFile(path.join(existing,'preserve'),'preserve');
      await assert.rejects(decryptBackup({backupFile:encrypted,keyFile:key,destination:existing}),/EEXIST/);
      assert.equal(await readFile(path.join(existing,'preserve'),'utf8'),'preserve');
    });
    await t.test('wrong key and ciphertext modification authenticate before extraction',async()=>{
      const wrong=path.join(base,'wrong.key');await writeFile(wrong,randomBytes(32).toString('hex')+'\n',{mode:0o600});
      const a=target('wrong');
      await assert.rejects(decryptBackup({backupFile:encrypted,keyFile:wrong,destination:a}),/authentication failed/);
      await assert.rejects(access(a));
      const data=await readFile(encrypted);data[Math.floor(data.length/2)]^=1;
      const corrupted=path.join(base,'corrupted.sbb');await writeFile(corrupted,data,{mode:0o600});
      const b=target('corrupt');
      await assert.rejects(decryptBackup({backupFile:corrupted,keyFile:key,destination:b}),/authentication failed/);
      await assert.rejects(access(b));
    });
    await t.test('authenticated unknown tar paths and symlink input are refused',async()=>{
      await writeFile(path.join(base,'forbidden.txt'),'FICTIONAL forbidden archive entry',{mode:0o600});
      const badTar=path.join(base,'bad.tar');
      execFileSync('tar',['--format=ustar','-cf',badTar,'--',...names,'forbidden.txt'],{cwd:base});await chmod(badTar,0o600);
      const bad=path.join(base,'bad.sbb');await encryptArchive({archiveFile:badTar,backupFile:bad,keyFile:key});
      const destination=target('forbidden');
      await assert.rejects(decryptBackup({backupFile:bad,keyFile:key,destination}),/forbidden path/);
      await assert.rejects(access(destination));
      const linked=path.join(base,'linked.sbb');await symlink(encrypted,linked);
      await assert.rejects(decryptBackup({backupFile:linked,keyFile:key,destination:target('linked')}),/symlinks/);
    });
    await t.test('nonprivate key and paths outside ignored state are refused',async()=>{
      await chmod(key,0o644);
      await assert.rejects(decryptBackup({backupFile:encrypted,keyFile:key,destination:target('mode')}),/0600/);
      await chmod(key,0o600);
      await assert.rejects(encryptArchive({archiveFile:archive,backupFile:path.join(repositoryRoot,'backup.sbb'),keyFile:key}),/ignored/);
    });
  }finally{for(const value of destinations)await rm(value,{recursive:true,force:true});await rm(base,{recursive:true,force:true});}
});
