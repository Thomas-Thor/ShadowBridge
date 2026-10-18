// Static public preview only. This script has no network or deployment step.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') {
  throw new Error('Usage: node scripts/build-preview.mjs --out /absolute/new-preview-directory');
}
if (!path.isAbsolute(args[1])) throw new Error('Use an absolute output directory outside the repository.');
// Resolve the parent to prevent an existing symlink from redirecting the output.
const requested = path.resolve(args[1]);
await fs.mkdir(path.dirname(requested), { recursive: true });
const output = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
const relative = path.relative(await fs.realpath(root), output);
if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
  throw new Error('Preview output must be outside the checkout.');
}

const pages = ['index.html', 'apply/buyer/index.html', 'apply/supplier/index.html',
  'apply/partner/index.html', 'member-sign-in/index.html', 'cartel/index.html'];
const assets = ['assets/app.js', 'assets/content.en.js', 'assets/styles.css',
  'assets/entry.css', 'assets/business-contact.css', 'assets/business-contact.js', 'assets/business-contact-config.js', 'assets/cartel-eye.png', 'assets/cartel.css', 'assets/bridge-mark.svg', 'assets/global-bridge.svg',
  'assets/fonts/dm-sans-LICENSE.txt', 'assets/fonts/dm-sans-latin-wght-normal.woff2',
  'assets/fonts/instrument-serif-LICENSE.txt', 'assets/fonts/instrument-serif-latin-400-italic.woff2',
  'assets/fonts/instrument-serif-latin-400-normal.woff2', 'assets/fonts/sources.json', '.nojekyll'];
const prepared = new Map();
for (const name of [...pages, ...assets]) {
  const file = path.join(root, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular source file: ${name}`);
  if (!pages.includes(name)) prepared.set(name, await fs.readFile(file));
  else {
    let html = await fs.readFile(file, 'utf8');
    if (!/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i.test(html)) {
      throw new Error(`Missing robots directive: ${name}`);
    }
    // Auth is activated only by the private BFF, never by the static public package.
    html = html.replace(/<script[^>]+src="[^"]*assets\/account\.js"[^>]*>\s*<\/script>/gi, '');
    html = html.replace(/(<meta\s+name="robots"\s+content=")[^"]*("\s*\/?>)/i, '$1noindex, nofollow$2')
      .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '')
      .replace(/\s*<meta\s+property="og:url"[^>]*>/gi, '');
    prepared.set(name, html);
  }
}
prepared.set('robots.txt', 'User-agent: *\nDisallow: /\n');
// Never overwrite a previous review, user files or a live publishing directory.
await fs.mkdir(output);
for (const [name, content] of prepared) {
  const target = path.join(output, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, { flag: 'wx' });
}
console.log(`Prepared ${prepared.size} public preview files in ${output}`);
console.log('No private portal, account runtime, prototypes, docs, tests, CNAME, sitemap, repository files, credentials or backend included.');
console.log('No upload, Git push, hosting or DNS changes performed. Existing outputs are preserved.');
