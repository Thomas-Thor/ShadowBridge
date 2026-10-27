import {centralCrmSync} from './central-crm-sync-core.mjs';

export function buildCentralCrmSync({spreadsheetId, googleCredentialId, ingestCredentialId,
  googleCredentialName = 'Google Sheets account', ingestCredentialName = 'ShadowBridge private Clay intake'} = {}) {
  for (const value of [spreadsheetId, googleCredentialId, ingestCredentialId]) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(value || '')) throw Error('CRM_SYNC_EXISTING_BINDINGS_REQUIRED');
  }
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  const readUrl = '={{ ' + JSON.stringify(base + '/values:batchGet?') + ' + Object.values($("Select three existing CRM tabs").first().json).map(p=>"ranges="+encodeURIComponent(p.range)).join("&") + "&valueRenderOption=UNFORMATTED_VALUE" }}';
  const nodes = [], connections = {}, source = centralCrmSync.toString();
  const add = (name, type, version, parameters, extra = {}) => {
    nodes.push({id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, type: 'n8n-nodes-base.' + type, typeVersion: version,
      position: [(nodes.length % 5) * 320, Math.floor(nodes.length / 5) * 260], parameters, ...extra});
  };
  const link = (from, to, port = 0) => {
    connections[from] ||= {main: []}; connections[from].main[port] ||= [];
    connections[from].main[port].push({node: to, type: 'main', index: 0});
  };
  const failures = [];
  const code = (name, stage, action, args) => {
    add(name, 'code', 2, {mode: 'runOnceForAllItems', jsCode: 'return [{json:(' + source + ')(' + JSON.stringify(action) + ',' + args + ')}];'}, {onError: 'continueErrorOutput'});
    failures.push({name, stage});
  };
  const http = (name, stage, url, body) => {
    add(name, 'httpRequest', 4.2, {method: body ? 'POST' : 'GET', url, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
      ...(body ? {sendBody: true, specifyBody: 'json', jsonBody: body} : {}),
      options: {timeout: 15000, redirect: {redirect: {followRedirects: false}}, response: {response: {fullResponse: true, neverError: true, responseFormat: 'json'}}}},
    {credentials: {googleSheetsOAuth2Api: {id: googleCredentialId, name: googleCredentialName}}, retryOnFail: false, onError: 'continueErrorOutput'});
    failures.push({name, stage});
  };
  const branch = (name, expression) => add(name, 'if', 2.2, {conditions: {options: {caseSensitive: true, typeValidation: 'strict', version: 2},
    conditions: [{id: 'yes', leftValue: expression, rightValue: '', operator: {type: 'boolean', operation: 'true', singleValue: true}}], combinator: 'and'}, options: {}});
  add('Private Clay export intake', 'webhook', 2, {httpMethod: 'POST', path: 'shadowbridge-global-b2b-sourcing-v1-canary', authentication: 'headerAuth', responseMode: 'responseNode', options: {}},
    {webhookId: 'shadowbridge-b2b-canary-v1', credentials: {httpHeaderAuth: {id: ingestCredentialId, name: ingestCredentialName}}});
  code('Validate five backup profiles', 'request.validate', 'validate', '{body:$input.first().json.body,now:new Date().toISOString()}');
  http('Read central CRM metadata', 'google.metadata', base + '?fields=sheets.properties');
  code('Select three existing CRM tabs', 'crm.tabs', 'sheets', '{response:$input.first().json}');
  http('Read existing companies contacts and runs', 'google.read', readUrl);
  code('Plan without editing existing rows', 'crm.plan', 'plan', '{response:$input.first().json,sheets:$("Select three existing CRM tabs").first().json,request:$("Validate five backup profiles").first().json}');
  branch('Read only request', '={{ ["inspect","backup","preview"].includes($json.mode) }}');
  code('Return inspection or private backup', 'crm.preview', 'preview', '{plan:$input.first().json}');
  // Backup data is returned only to the authenticated local operator and saved 0600.
  const preview = nodes.find(n => n.name === 'Return inspection or private backup');
  preview.parameters.jsCode = 'const plan=$input.first().json;return [{json:(' + source + ')(plan.mode==="backup"?"backup":"preview",{plan})}];';
  branch('New rows need atomic append', '={{ $json.canWrite === true }}');
  http('Recheck CRM immediately before write', 'google.recheck', readUrl);
  code('Reject concurrent CRM changes', 'crm.recheck', 'recheck', '{response:$input.first().json,sheets:$("Select three existing CRM tabs").first().json,plan:$("Plan without editing existing rows").first().json}');
  http('Atomically append companies contacts and audit', 'google.write', base + ':batchUpdate', '={{ $("Reject concurrent CRM changes").first().json.writeBody }}');
  code('Check atomic write response', 'crm.ack', 'ack', '{response:$input.first().json,plan:$("Plan without editing existing rows").first().json}');
  http('Read back committed CRM rows', 'google.readback', readUrl);
  code('Verify contact company and audit IDs', 'crm.verify', 'verify', '{response:$input.first().json,sheets:$("Select three existing CRM tabs").first().json,plan:$("Plan without editing existing rows").first().json}');
  add('Private response', 'respondToWebhook', 1.4, {respondWith: 'json', responseBody: '={{ $json }}', options: {responseCode: '={{ $json.status === "BLOCKED" ? 409 : 200 }}'}});
  for (const [from, to] of [
    ['Private Clay export intake', 'Validate five backup profiles'], ['Validate five backup profiles', 'Read central CRM metadata'],
    ['Read central CRM metadata', 'Select three existing CRM tabs'], ['Select three existing CRM tabs', 'Read existing companies contacts and runs'],
    ['Read existing companies contacts and runs', 'Plan without editing existing rows'], ['Plan without editing existing rows', 'Read only request'],
    ['Read only request', 'Return inspection or private backup'], ['Return inspection or private backup', 'Private response'],
    ['New rows need atomic append', 'Recheck CRM immediately before write'], ['Recheck CRM immediately before write', 'Reject concurrent CRM changes'],
    ['Reject concurrent CRM changes', 'Atomically append companies contacts and audit'], ['Atomically append companies contacts and audit', 'Check atomic write response'],
    ['Check atomic write response', 'Read back committed CRM rows'], ['Read back committed CRM rows', 'Verify contact company and audit IDs'],
    ['Verify contact company and audit IDs', 'Private response'],
  ]) link(from, to);
  link('Read only request', 'New rows need atomic append', 1);
  link('New rows need atomic append', 'Read back committed CRM rows', 1);
  for (const {name, stage} of failures) {
    const failure = 'Report ' + stage;
    add(failure, 'code', 2, {mode: 'runOnceForAllItems', jsCode: 'const e=$input.first().json;const value=e.error;const message=typeof value==="string"?value:typeof value?.message==="string"?value.message:"";const found=message.match(/\\b((?:CRM_SYNC_|GOOGLE_SHEETS_)[A-Z0-9_]{1,100})\\b/);return [{json:{status:"BLOCKED",stage:' + JSON.stringify(stage) + ',reason:found?found[1]:"CRM_SYNC_NODE_FAILED",automaticRetry:false,sourcingScheduled:false}}];'});
    link(name, failure, 1); link(failure, 'Private response');
  }
  return {name: 'ShadowBridge Global B2B Sourcing V1', nodes, connections,
    settings: {timezone: 'Europe/Oslo', executionOrder: 'v1', executionTimeout: 180, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false}};
}
