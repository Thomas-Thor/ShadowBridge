// Deterministic standalone bundle, no dependencies or secrets downloaded.
import{readFile,writeFile}from'node:fs/promises';
const core=(await readFile(new URL('smtp-operator-core.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const channel=(await readFile(new URL('smtp-mail-channel.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const main=(await readFile(new URL('smtp-owner-launcher-main.mjs',import.meta.url),'utf8')).replace(/^import\{[^\n]+from'\.\/smtp-operator-core\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-mail-channel\.mjs';\n/m,'').replace(/^export /gm,'');
await writeFile(new URL('smtp-owner-launcher.mjs',import.meta.url),'// Generated standalone OWNER launcher. Edit source modules, then rebuild.\n'+core+'\n'+channel+'\n'+main);
