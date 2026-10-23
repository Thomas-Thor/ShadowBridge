import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scout } from './scout.mjs';

export function buildWorkflow() {
  const nodes = [], connections = {};
  const add = (name, type, typeVersion, parameters, extra = {}) => {
    nodes.push({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: `n8n-nodes-base.${type}`, typeVersion,
      position: [nodes.length % 6 * 280, Math.floor(nodes.length / 6) * 260], parameters, ...extra });
  };
  const link = (from, to, output = 0) => {
    connections[from] ??= { main: [] };
    connections[from].main[output] ??= [];
    connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  };
  const expr = (action, args) => `={{ (${scout.toString()})(${JSON.stringify(action)}, ${args}) }}`;
  const clock = 'now:$now.toISO(),day:$now.setZone("Europe/Oslo").toISODate()';
  const set = (name, field, value, type = 'object') => add(name, 'set', 3.4, {
    assignments: { assignments: [{ id: field, name: field, type, value }] }, options: {},
  });
  const conditions = [{ keyName: 'scout_key', condition: 'eq', keyValue: 'europe-scout-v1' }];
  const table = { __rl: true, mode: 'name', value: 'shadowbridge_europe_scout_pilot_v1' };
  const read = name => add(name, 'dataTable', 1.1, {
    resource: 'row', operation: 'get', dataTableId: table, matchType: 'allConditions',
    filters: { conditions }, returnAll: false, limit: 2,
  }, { alwaysOutputData: true });
  const cas = (name, path) => add(name, 'dataTable', 1.1, {
    resource: 'row', operation: 'update', dataTableId: table, matchType: 'allConditions',
    filters: { conditions: [...conditions, { keyName: 'id', condition: 'eq', keyValue: `={{ ${path}.id }}` },
      { keyName: 'revision', condition: 'eq', keyValue: `={{ ${path}.previous }}` }] },
    columns: { mappingMode: 'defineBelow', value: { revision: `={{ ${path}.revision }}`, state_json: `={{ ${path}.state_json }}` },
      schema: ['revision', 'state_json'].map(id => ({ id, displayName: id, required: false, defaultMatch: false, display: true,
        type: id === 'revision' ? 'number' : 'string', canBeUsedToMatch: true })) }, options: {},
  }, { alwaysOutputData: true });
  const branch = (name, value) => add(name, 'if', 2.2, { conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: 'check', leftValue: value, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and',
  }, options: {} });
  add('Manual pilot', 'manualTrigger', 1, {});
  add('Oslo night 0315', 'scheduleTrigger', 1.2, { rule: { interval: [{ field: 'cronExpression', expression: '15 3 * * *' }] } });
  set('Source approvals', 'approvals', { NO: false, CZ: false });
  read('Read initial journal');
  set('Rotate sources and sectors', 'plan', expr('jobs', `{rows:$input.all().map(x=>x.json),${clock}}`));
  add('Split jobs', 'splitOut', 1, { fieldToSplitOut: 'plan.jobs', include: 'noOtherFields', options: { destinationFieldName: 'job' } });
  add('Each source', 'splitInBatches', 3, { batchSize: 1, options: {} });
  read('Read reservation');
  set('Draft reservation', 'query', expr('reserve', `{rows:$input.all().map(x=>x.json),job:$('Each source').item.json.job,approvals:JSON.parse(JSON.stringify($('Source approvals').first().json.approvals)),execution:$execution.id,${clock}}`));
  branch('Source eligible', '={{ $json.query.fetch }}');
  cas('Reserve atomically', '$json.query.update');
  branch('Reservation won', expr('won', `{rows:$input.all().map(x=>x.json),update:$('Draft reservation').item.json.query.update}`));
  add('Read public registry', 'httpRequest', 4.4, {
    method: "={{ $('Draft reservation').item.json.query.method }}", url: "={{ $('Draft reservation').item.json.query.url }}",
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
    sendBody: "={{ $('Draft reservation').item.json.query.country === 'CZ' }}", specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Draft reservation').item.json.query.body) }}",
    options: { timeout: 15000, redirect: { redirect: { followRedirects: false } },
      response: { response: { fullResponse: true, neverError: true, responseFormat: 'text', outputPropertyName: 'body' } } },
  }, { onError: 'continueRegularOutput', retryOnFail: false });
  set('Keep response context', 'context', "={{ {query:$('Draft reservation').item.json.query,response:$json} }}");
  read('Read before commit');
  set('Draft commit', 'result', expr('commit', `{rows:$input.all().map(x=>x.json),query:$('Keep response context').item.json.context.query,response:$('Keep response context').item.json.context.response,${clock}}`));
  cas('Commit atomically', '$json.result.update');
  branch('Commit won', expr('won', `{rows:$input.all().map(x=>x.json),update:$('Draft commit').item.json.result.update}`));
  add('Conflict stop safely', 'stopAndError', 1, { errorMessage: 'Concurrent journal change: response not committed. No cursor advanced by this worker; retry at next schedule. Inspect pilot journal.' });
  add('Gentle spacing', 'wait', 1.1, { amount: 2, unit: 'seconds' }, { webhookId: 'europe-scout-spacing' });
  read('Read final journal');
  set('Pilot summary', 'summary', expr('summary', `{rows:$input.all().map(x=>x.json),${clock}}`));
  link('Manual pilot', 'Source approvals'); link('Oslo night 0315', 'Source approvals');
  const chain = ['Source approvals', 'Read initial journal', 'Rotate sources and sectors', 'Split jobs', 'Each source'];
  for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
  link('Each source', 'Read final journal', 0); link('Read final journal', 'Pilot summary');
  link('Each source', 'Read reservation', 1); link('Read reservation', 'Draft reservation'); link('Draft reservation', 'Source eligible');
  link('Source eligible', 'Reserve atomically', 0); link('Source eligible', 'Gentle spacing', 1);
  link('Reserve atomically', 'Reservation won'); link('Reservation won', 'Read public registry', 0); link('Reservation won', 'Gentle spacing', 1);
  link('Read public registry', 'Keep response context'); link('Keep response context', 'Read before commit');
  link('Read before commit', 'Draft commit'); link('Draft commit', 'Commit atomically'); link('Commit atomically', 'Commit won');
  link('Commit won', 'Gentle spacing', 0); link('Commit won', 'Conflict stop safely', 1); link('Gentle spacing', 'Each source');
  return { name: 'ShadowBridge — European B2B Scout V1 (pilot only)', active: false, nodes, connections,
    settings: { executionOrder: 'v1', timezone: 'Europe/Oslo', executionTimeout: 600,
      saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false },
    pinData: {}, tags: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = new URL('./', import.meta.url);
  await writeFile(new URL('europe-b2b-scout-v1.json', here), JSON.stringify(buildWorkflow(), null, 2) + '\n');
  const seed = scout('seed', {});
  const csv = 'scout_key,revision,state_json\n' + [seed.scout_key, seed.revision, seed.state_json].map(v => `"${String(v).replaceAll('"', '""')}"`).join(',') + '\n';
  await writeFile(new URL('pilot-seed.csv', here), csv);
}
