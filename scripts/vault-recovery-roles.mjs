// Host-only support for the existing, authenticated empty-target restore path.
// Never invoked during normal startup/migration or added to a runtime image.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';

export function archiveHasVault(catalog) {
  if (typeof catalog !== 'string' || Buffer.byteLength(catalog) > 4*1024*1024) throw new Error('Invalid recovery catalog.');
  return /^\d+; \d+ \d+ SCHEMA - owner_vault \S+\s*$/m.test(catalog);
}

export const restoredVaultRolesSql = `DO $vault_recovery$
BEGIN
 IF current_user<>'postgres' OR current_database()<>'shadowbridge'
  OR to_regnamespace('sb') IS NOT NULL OR to_regnamespace('owner_vault') IS NOT NULL
  OR EXISTS(SELECT FROM information_schema.tables WHERE table_schema='auth') THEN
  RAISE EXCEPTION 'Vault role recovery requires the empty recovery target' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('shadowbridge_vault_executor','shadowbridge_vault_ingest')) THEN
  RAISE EXCEPTION 'Existing Vault recovery principal requires administrative review' USING ERRCODE='42501';
 END IF;
 CREATE ROLE shadowbridge_vault_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 CREATE ROLE shadowbridge_vault_ingest NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END $vault_recovery$;`;

export async function privateArchiveCatalog({args,environment,cwd,dumpFile}) {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{env:environment,cwd,stdio:['pipe','pipe','pipe']});
    const input=createReadStream(dumpFile);let size=0;const chunks=[];
    const fail=()=>{input.destroy();child.kill();reject(new Error('Private backup catalog could not be verified.'));};
    input.on('error',fail);child.once('error',fail);child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)fail();else chunks.push(chunk);});
    input.pipe(child.stdin);
    child.once('exit',code=>{input.destroy();code===0?resolve(Buffer.concat(chunks).toString('utf8')):reject(new Error('Private backup catalog could not be verified.'));});
  });
}
