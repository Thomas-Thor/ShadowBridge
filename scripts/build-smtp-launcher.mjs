// Deterministic standalone bundle, no dependencies or secrets downloaded.
import{readFile,writeFile}from'node:fs/promises';
const core=(await readFile(new URL('smtp-operator-core.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const execution=(await readFile(new URL('smtp-launcher-execution.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const recovery=(await readFile(new URL('smtp-existing-checkpoint.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const preparation=(await readFile(new URL('smtp-preparation-resume.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const confirmation=(await readFile(new URL('smtp-confirmation-resume.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const inventory=(await readFile(new URL('smtp-n8n-metadata.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
const channel=(await readFile(new URL('smtp-mail-channel.mjs',import.meta.url),'utf8')).replace(/^import\{[^\n]+from'\.\/smtp-n8n-metadata\.mjs';\n/m,'').replace(/^export /gm,'');
const main=(await readFile(new URL('smtp-owner-launcher-main.mjs',import.meta.url),'utf8')).replace(/^import\{[^\n]+from'\.\/smtp-operator-core\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-mail-channel\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-launcher-execution\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-existing-checkpoint\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-preparation-resume\.mjs';\n/m,'').replace(/^import\{[^\n]+from'\.\/smtp-confirmation-resume\.mjs';\n/m,'').replace(/^export /gm,'');
await writeFile(new URL('smtp-owner-launcher.mjs',import.meta.url),'// Generated standalone OWNER launcher. Edit source modules, then rebuild.\n'+core+'\n'+execution+'\n'+recovery+'\n'+preparation+'\n'+confirmation+'\n'+inventory+'\n'+channel+'\n'+main);
