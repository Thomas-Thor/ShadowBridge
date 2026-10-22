import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rm, chmod, symlink, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaging, checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { prepareProduction, checkProduction } from '../scripts/production-config.mjs';
import { savePublicConfiguration, recoverPublicConfiguration, rollbackPrivate } from '../scripts/production-ops.mjs';

// File/configuration tests only. No Docker, DNS, database or SMTP request.
test('public profile preserves a new fictional private installation and its secrets', async t => {
  const suffix = randomBytes(6).toString('hex');
  const directory = path.join(repositoryRoot, '.local', `production-config-test-${suffix}`);
  const project = `shadowbridge-stageg-production-test-${suffix}`;
  const releaseSha = randomBytes(20).toString('hex');
  const smtpPassword = randomBytes(8).toString('hex');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const prepareSmtp = options => prepareProduction({ ...options, mailMode: 'smtp' });
  try {
    await prepareStaging({ directory, project });
    const privateManifestBefore = hash(await readFile(path.join(directory, 'manifest.json')));
    let prepared;
    await t.test('explicit release and local Gmail app password are required', async () => {
      await assert.rejects(prepareSmtp({ directory, smtpPassword }), /release SHA/);
      await assert.rejects(prepareSmtp({ directory, releaseSha, smtpPassword: 'ordinary-password' }), /16 letters/);
      await assert.rejects(prepareSmtp({ directory, releaseSha, smtpPassword: smtpPassword + '\n' }), /locally/);
    });
    await t.test('new public files retain all authentication and database secrets', async () => {
      prepared = await prepareSmtp({ directory, releaseSha, smtpPassword });
      assert.equal(prepared.created, true);
      assert.equal(prepared.project, project);
      assert.equal(prepared.origin, 'https://shadow-bridge.eu');
      assert.equal(prepared.sourceDirectory, directory);
      assert.equal(prepared.directory, path.join(directory, 'production'));
      assert.deepEqual(prepared.composeEnvironment, { STAGING_DIR: directory, STAGING_PROJECT: project, PRODUCTION_DIR: prepared.directory });
      const sourceApp = await readEnv(path.join(directory, 'app.env'));
      const sourceAuth = await readEnv(path.join(directory, 'auth.env'));
      const app = await readEnv(path.join(prepared.directory, 'app.env'));
      const auth = await readEnv(path.join(prepared.directory, 'auth.env'));
      for (const key of ['DATABASE_URL', 'SESSION_DATABASE_URL', 'SESSION_ENCRYPTION_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_URL']) assert.equal(app[key], sourceApp[key]);
      for (const key of ['GOTRUE_DB_DATABASE_URL', 'GOTRUE_JWT_SECRET', 'GOTRUE_MAILER_AUTOCONFIRM', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED', 'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED']) assert.equal(auth[key], sourceAuth[key]);
      assert.equal(app.MAIL_DELIVERY_MODE, 'smtp');
      assert.equal(app.TRANSACTIONAL_MAIL_ENABLED, 'true');
      assert.equal(app.RELEASE_SHA, releaseSha);
      assert.match(app.PROXY_AUTH_TOKEN, /^[a-f0-9]{64}$/);
      assert.notEqual(app.PROXY_AUTH_TOKEN, sourceApp.SESSION_ENCRYPTION_KEY);
      assert.equal(auth.GOTRUE_SMTP_HOST, 'smtp.gmail.com');
      assert.equal(auth.GOTRUE_SMTP_PORT, '465');
      assert.equal(auth.GOTRUE_SMTP_USER, 'shadowbridge.trade@gmail.com');
      assert.equal(auth.GOTRUE_SMTP_ADMIN_EMAIL, 'shadowbridge.trade@gmail.com');
      assert.equal(auth.GOTRUE_SMTP_PASS, smtpPassword);
      assert.equal(auth.GOTRUE_URI_ALLOW_LIST, 'https://shadow-bridge.eu/auth/confirm,https://shadow-bridge.eu/auth/recover');
      assert.equal(hash(await readFile(path.join(directory, 'manifest.json'))), privateManifestBefore);
      assert.equal((await checkStaging({ directory })).project, project);
    });
    await t.test('repeated preparation is stable and refuses release or secret replacement', async () => {
      const before = hash(await readFile(path.join(prepared.directory, 'manifest.json')));
      assert.equal((await prepareSmtp({ directory, releaseSha })).created, false);
      await assert.rejects(prepareSmtp({ directory, releaseSha: randomBytes(20).toString('hex') }), /another release/);
      await assert.rejects(prepareSmtp({ directory, releaseSha, smtpPassword: randomBytes(8).toString('hex') }), /SMTP credential differs/);
      assert.equal(hash(await readFile(path.join(prepared.directory, 'manifest.json'))), before);
    });
    await t.test('tampering and unsafe modes fail closed without overwriting config', async () => {
      const file = path.join(prepared.directory, 'app.env');
      await chmod(file, 0o644);
      await assert.rejects(checkProduction({ directory }), /private regular/);
      await chmod(file, 0o600);
      const original = await readFile(file);
      await writeFile(file, Buffer.concat([original, Buffer.from('# deliberate test modification\n')]));
      await assert.rejects(prepareSmtp({ directory, releaseSha }), /fingerprint changed/);
      assert.equal((await readFile(file)).equals(original), false);
      await writeFile(file, original);
      await checkProduction({ directory });
    });
    await t.test('a forged manifest cannot authorize changing stored JWT, MFA or session secrets', async () => {
      const file = path.join(prepared.directory, 'app.env');
      const manifestPath = path.join(prepared.directory, 'manifest.json');
      const original = await readFile(file), manifestOriginal = await readFile(manifestPath);
      const replacement = Buffer.from(original.toString().replace(/^SESSION_ENCRYPTION_KEY=.+$/m, 'SESSION_ENCRYPTION_KEY=' + randomBytes(32).toString('base64')));
      const manifest = JSON.parse(manifestOriginal); manifest.hashes['app.env'] = hash(replacement);
      await writeFile(file, replacement); await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(checkProduction({ directory }), /preserve every original/);
      await writeFile(file, original); await writeFile(manifestPath, manifestOriginal);
      await checkProduction({ directory });
    });
    await t.test('production symlinks are refused', async () => {
      const file = path.join(prepared.directory, 'proxy-token');
      const original = await readFile(file);
      await rm(file); await symlink(path.join(directory, 'tester-password'), file);
      await assert.rejects(checkProduction({ directory }), /private regular/);
      await rm(file); await writeFile(file, original, { mode: 0o600 });
      await checkProduction({ directory });
    });
    await t.test('public configuration companion encrypts and restores only into a new private directory', async () => {
      const checkpoint='public-unit-'+suffix;
      const folder=path.join(directory,'backups',checkpoint);await mkdir(folder,{recursive:true,mode:0o700});
      const backup=await savePublicConfiguration(prepared,folder);
      assert.equal((await lstat(backup.backupFile)).mode&0o777,0o600);
      assert.equal((await readFile(backup.backupFile)).includes(Buffer.from(smtpPassword)),false);
      const recovered=await recoverPublicConfiguration({directory,checkpoint});
      try {
        assert.notEqual(recovered.directory,prepared.directory);
        for(const file of ['compose.env','app.env','auth.env','proxy-token','Caddyfile','manifest.json']){
          assert.deepEqual(await readFile(path.join(recovered.directory,file)),await readFile(path.join(prepared.directory,file)));
          assert.equal((await lstat(path.join(recovered.directory,file))).mode&0o777,0o600);
        }
        assert.equal((await checkProduction({directory})).releaseSha,releaseSha);
      }finally{await rm(recovered.directory,{recursive:true,force:true});}
    });
    await t.test('rollback cannot race an existing deployment lock', async () => {
      const lock=path.join(directory,'production-operation.lock');await writeFile(lock,'',{mode:0o600,flag:'wx'});
      try{await assert.rejects(rollbackPrivate({directory,checkpoint:'public-unit-'+suffix}),/inne wdrożenie/);await lstat(lock);}
      finally{await rm(lock);}
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('public gateway template authenticates edge client identity without Basic Auth', async () => {
  const caddy = await readFile(path.join(repositoryRoot, 'deploy/production/Caddyfile.in'), 'utf8');
  assert.match(caddy, /https:\/\/shadow-bridge\.eu\s*\{/);
  assert.match(caddy, /header_up X-ShadowBridge-Proxy-Token \{\$SB_PROXY_TOKEN\}/);
  assert.match(caddy, /header_up X-ShadowBridge-Client-IP \{remote_host\}/);
  assert.match(caddy, /https:\/\/auth-proxy:8444/);
  assert.match(caddy, /tls \/run\/secrets\/auth-proxy\.crt \/run\/secrets\/auth-proxy\.key/);
  assert.doesNotMatch(caddy, /basic_auth|tester-password|public\.key|tls internal/);
  const compose = await readFile(path.join(repositoryRoot, 'deploy/production/compose.yaml'), 'utf8');
  assert.equal((compose.match(/^\s+ports:/gm) || []).length, 1);
  assert.match(compose, /- "80:80"\n\s+- "443:443"/);
  assert.match(compose, /database:\/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(compose, /networks: \[private, public\]/);
  assert.doesNotMatch(compose, /network_mode: host|privileged: true/);
});

test('no-mail release needs no SMTP and preserves the existing installation and profiles', async t => {
  const suffix=randomBytes(6).toString('hex');
  const directory=path.join(repositoryRoot,'.local',`production-no-mail-config-test-${suffix}`);
  const oldSha=randomBytes(20).toString('hex'),releaseSha=randomBytes(20).toString('hex'),nextSha=randomBytes(20).toString('hex');
  const smtpPassword=randomBytes(8).toString('hex');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  try {
    await prepareStaging({directory,project:`shadowbridge-stageg-no-mail-${suffix}`});
    const privateBefore=hash(await readFile(path.join(directory,'manifest.json')));
    const legacy=await prepareProduction({directory,releaseSha:oldSha,smtpPassword,mailMode:'smtp'});
    const legacyBefore=hash(await readFile(path.join(legacy.directory,'manifest.json')));
    const previousProxy=(await readEnv(path.join(legacy.directory,'app.env'))).PROXY_AUTH_TOKEN;
    let profile,next;
    await t.test('default profile disables signup and SMTP without disabling password login or MFA',async()=>{
      profile=await prepareProduction({directory,releaseSha});
      assert.equal(profile.mailMode,'disabled');
      assert.equal(profile.directory,path.join(directory,'production-no-mail',releaseSha));
      assert.equal((await checkProduction({directory})).directory,profile.directory);
      const app=await readEnv(path.join(profile.directory,'app.env')),auth=await readEnv(path.join(profile.directory,'auth.env'));
      const originalApp=await readEnv(path.join(directory,'app.env')),originalAuth=await readEnv(path.join(directory,'auth.env'));
      assert.equal(app.MAIL_DELIVERY_MODE,'disabled');assert.equal(app.TRANSACTIONAL_MAIL_ENABLED,'false');
      assert.equal(app.PROXY_AUTH_TOKEN,previousProxy);
      for(const key of ['DATABASE_URL','SESSION_DATABASE_URL','SESSION_ENCRYPTION_KEY','SUPABASE_ANON_KEY','SUPABASE_URL'])assert.equal(app[key],originalApp[key]);
      for(const key of ['GOTRUE_DB_DATABASE_URL','GOTRUE_JWT_SECRET','GOTRUE_MAILER_AUTOCONFIRM','GOTRUE_MFA_TOTP_VERIFY_ENABLED','GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED','GOTRUE_EXTERNAL_EMAIL_ENABLED'])assert.equal(auth[key],originalAuth[key]);
      assert.equal(auth.GOTRUE_DISABLE_SIGNUP,'true');assert.equal(auth.GOTRUE_EXTERNAL_EMAIL_ENABLED,'true');
      assert.equal(auth.GOTRUE_SMTP_HOST,'127.0.0.1');assert.equal(auth.GOTRUE_SMTP_PORT,'1');
      assert.equal(Object.hasOwn(auth,'GOTRUE_SMTP_USER'),false);assert.equal(Object.hasOwn(auth,'GOTRUE_SMTP_PASS'),false);
      assert.equal((await readFile(path.join(profile.directory,'auth.env'),'utf8')).includes(smtpPassword),false);
      assert.equal((await prepareProduction({directory,releaseSha})).created,false);
      await assert.rejects(prepareProduction({directory,releaseSha,smtpPassword}),/No SMTP credential/);
    });
    await t.test('a newer no-mail release preserves old profiles, keys and the Docker project',async()=>{
      const before=hash(await readFile(path.join(profile.directory,'manifest.json')));
      next=await prepareProduction({directory,releaseSha:nextSha});
      assert.equal(next.project,profile.project);
      assert.equal((await readEnv(path.join(next.directory,'app.env'))).PROXY_AUTH_TOKEN,previousProxy);
      assert.equal(hash(await readFile(path.join(profile.directory,'manifest.json'))),before);
      assert.equal(hash(await readFile(path.join(legacy.directory,'manifest.json'))),legacyBefore);
      assert.equal(hash(await readFile(path.join(directory,'manifest.json'))),privateBefore);
      assert.equal((await checkProduction({directory})).releaseSha,nextSha);
      assert.equal((await checkProduction({directory,mailMode:'smtp'})).releaseSha,oldSha);
    });
    await t.test('forged no-mail manifest cannot re-enable signup or change critical secrets',async()=>{
      const file=path.join(next.directory,'auth.env'),manifestFile=path.join(next.directory,'manifest.json');
      const original=await readFile(file),manifestOriginal=await readFile(manifestFile);
      const changed=Buffer.from(original.toString().replace('GOTRUE_DISABLE_SIGNUP=true','GOTRUE_DISABLE_SIGNUP=false'));
      const manifest=JSON.parse(manifestOriginal);manifest.hashes['auth.env']=hash(changed);
      await writeFile(file,changed);await writeFile(manifestFile,JSON.stringify(manifest));
      await assert.rejects(checkProduction({directory}),/No-mail Auth/);
      await writeFile(file,original);await writeFile(manifestFile,manifestOriginal);
      await checkProduction({directory});
    });
    await t.test('a partial new profile fails without overwriting it or changing the selector',async()=>{
      const partial=randomBytes(20).toString('hex'),target=path.join(directory,'production-no-mail',partial);
      await mkdir(target,{mode:0o700});
      await assert.rejects(prepareProduction({directory,releaseSha:partial}));
      assert.equal((await checkProduction({directory})).releaseSha,nextSha);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
