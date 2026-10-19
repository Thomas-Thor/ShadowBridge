import pg from 'pg';

const args = process.argv.slice(2);
const email = args.find((value) => value.startsWith('--email='))?.slice(8)?.trim().toLowerCase();
if (!email || !args.includes('--grant-owner') || !process.env.DATABASE_ADMIN_URL) {
  console.error('Usage: DATABASE_ADMIN_URL=<DBA URL> node scripts/bootstrap-admin.mjs --email=owner@example.com --grant-owner');
  console.error('Run locally as the database administrator after verified email registration. This never creates credentials or bypasses MFA.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: 'shadowbridge-bootstrap' });
try {
  await client.connect();
  await client.query('BEGIN');
  const result = await client.query(`SELECT id FROM auth.users WHERE lower(email)=$1 AND email_confirmed_at IS NOT NULL`, [email]);
  if (result.rowCount !== 1) throw new Error('Exactly one verified Auth account is required; no grant was created');
  const id = result.rows[0].id;
  await client.query('SELECT sb.bootstrap_owner($1::uuid)', [id]);
  await client.query('COMMIT');
  console.log('Explicit OWNER grant created for the verified account. Administrative API access still requires live aal2 MFA.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.end(); }
