import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { archiveHasVault, restoredVaultRolesSql } from '../scripts/vault-recovery-roles.mjs';

test('only an exact Vault SCHEMA entry activates role recovery, not a comment/name substring',()=>{
 assert.equal(archiveHasVault('; owner_vault\n123; 1 1 TABLE other owner_vault postgres\n'),false);
 assert.equal(archiveHasVault('123; 2615 12345 SCHEMA - owner_vault postgres\n'),true);
 assert.equal(archiveHasVault('123; 2615 12345 SCHEMA - sb postgres\n'),false);
 assert.throws(()=>archiveHasVault('x'.repeat(4*1024*1024+1)));
});
test('Vault recovery refuses a nonempty DB, preexisting principals and non-DBA access',()=>{
 assert.match(restoredVaultRolesSql,/current_user<>'postgres'/);
 assert.match(restoredVaultRolesSql,/to_regnamespace\('sb'\) IS NOT NULL/);
 assert.match(restoredVaultRolesSql,/Existing Vault recovery principal/);
 assert.equal((restoredVaultRolesSql.match(/CREATE ROLE/g)||[]).length,2);
 assert.doesNotMatch(restoredVaultRolesSql,/\b(?:GRANT|ALTER|DROP|INSERT|UPDATE|DELETE)\b/);
});
test('existing restore prepares roles after empty guard, only for a Vault archive, before pg_restore',async()=>{
 const source=await readFile(new URL('../scripts/staging-ops.mjs',import.meta.url),'utf8');
 const restore=source.slice(source.indexOf('export async function restoreInstallation'),source.indexOf('export async function operate'));
 assert.ok(restore.indexOf("if (empty !== 't')")<restore.indexOf('const catalog=await privateArchiveCatalog'));
 assert.ok(restore.indexOf('if(archiveHasVault(catalog))')<restore.indexOf("'pg_restore', '--clean'"));
});
test('preservation fingerprints include every Vault table and the legacy restore helper knows its roles',async()=>{
 const source=await readFile(new URL('../scripts/production-ops.mjs',import.meta.url),'utf8');
 const fingerprint=source.slice(source.indexOf('export async function databaseFingerprints'),source.indexOf('export function assertPreserved'));
 assert.match(fingerprint,/schemaname IN \('sb','owner_vault','portal','auth'\)/);
 assert.match(fingerprint,/\(\?:sb\|auth\|owner_vault\|portal\)/);
 const proof=source.slice(source.indexOf('export async function proveBackup'),source.indexOf('export async function verifyBackupArchive'));
 assert.ok(proof.indexOf('if(archiveHasVault(catalog))')<proof.indexOf("'pg_restore','--clean'"));
});
