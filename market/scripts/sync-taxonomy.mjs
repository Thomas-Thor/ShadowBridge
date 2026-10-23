// Read-only extraction from the existing canonical seed. No database access.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const migration = 'supabase/migrations/202610190008_taxonomy.sql';
const root = new URL('../../', import.meta.url);
const sql = await fs.readFile(new URL(migration, root), 'utf8');
const categorySeed = sql.split('INSERT INTO sb.categories')[1]?.split('CREATE TABLE sb.currencies')[0];
const categories = [...(categorySeed || '').matchAll(/\('([0-9a-f-]+)','([^']+)','([^']+)',(NULL|'[0-9a-f-]+'),true,false,(\d+)\)/g)].map(([,id,key,label,parent,position]) => ({ id, key, label, parentId: parent === 'NULL' ? null : parent.slice(1,-1), position: Number(position) }));
const currencySeed = sql.split('INSERT INTO sb.currencies(code,label,position) VALUES')[1]?.split(';')[0];
const currencies = [...(currencySeed || '').matchAll(/\('([A-Z]{3})','([^']+)',(\d+)\)/g)].map(([,code,label,position]) => ({ code, label, position: Number(position) }));
if (categories.length !== 32 || categories.filter(c => !c.parentId).length !== 8 || currencies.length !== 5) throw new Error('Canonical seed changed. Review the extractor and mapping before synchronizing.');
const output = `${JSON.stringify({ sourceMigration: migration, categories, currencies }, null, 2)}\n`;
const target = new URL('../public/data/taxonomy.json', import.meta.url);
if (process.argv[2] === '--check') {
  if (await fs.readFile(target, 'utf8') !== output) throw new Error('Market taxonomy snapshot differs from canonical seed.');
  console.log('PASS: 8 categories, 24 subcategories and 5 currencies match the canonical seed.');
} else if (process.argv[2] === '--write') {
  await fs.writeFile(target, output);
  console.log(`Updated ${fileURLToPath(target)} from the existing seed; no database or private API used.`);
} else throw new Error('Use --check or --write.');
