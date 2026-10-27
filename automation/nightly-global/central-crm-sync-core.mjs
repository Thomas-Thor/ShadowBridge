// Serialized into n8n Code nodes. No imports, credentials, provider calls or timers.
// Existing CRM tabs/columns stay intact. Only new rows are appended.
export function centralCrmSync(action, a) {
  const must = (ok, code) => { if (!ok) throw Error(code); };
  const text = v => v == null ? '' : String(v).trim();
  const normal = v => text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, 'l').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const linkedin = v => {
    const m = /^https?:\/\/(?:(?:www|[a-z]{2})\.)?linkedin\.com\/in\/([^/?#\s]+)(?:[/?#].*)?$/i.exec(text(v));
    return m ? 'https://www.linkedin.com/in/' + m[1].toLowerCase() : '';
  };
  const domain = v => {
    const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)(?::\d+)?(?:[/?#].*)?$/i.exec(text(v));
    return m && m[1].includes('.') && !m[1].includes('..') ? m[1].toLowerCase() : '';
  };
  const unique = list => [...new Set(list)];
  const unwrap = r => {
    must(r && r.statusCode === 200, 'GOOGLE_SHEETS_READ_NOT_CONFIRMED');
    must(r.body && typeof r.body === 'object' && !r.body.error, 'GOOGLE_SHEETS_RESPONSE_INVALID');
    return r.body;
  };
  const required = {
    KONTRAHENCI: ['ID_FIRMY', 'Firma', 'Typ', 'Kraj', 'Branza', 'Strona WWW', 'Zrodlo', 'Agent', 'Data aktualizacji', 'Uwagi', 'Klucz firmy', 'Weryfikacja'],
    KONTAKTY: ['ID_KONTAKTU', 'ID_FIRMY', 'Firma', 'Osoba', 'Stanowisko', 'LinkedIn', 'Zrodlo', 'Status weryfikacji', 'Uwagi'],
    AGENT_RUNS: ['RUN_ID', 'DATA_OSLO', 'AGENT', 'START_OSLO', 'KONIEC_OSLO', 'STATUS', 'NOWE_REKORDY', 'ZAKTUALIZOWANE_REKORDY', 'ID_REKORDOW_CRM', 'ARKUSZE_CRM', 'ZRODLA_URL', 'NARZEDZIA', 'BLAD_LUB_BRAKI', 'UWAGI'],
  };
  const summary = plan => ({
    status: plan.mode === 'inspect' ? 'CRM_READ_CONFIRMED' : plan.mode === 'backup' ? 'PRIVATE_CRM_BACKUP' : 'PREVIEW_ONLY',
    batchId: plan.batchId, schema: 'CENTRAL_CRM_V2', sourceRows: plan.sourceRows,
    existingCompanies: plan.existingCompanies, existingContacts: plan.existingContacts,
    existingDuplicateProfiles: plan.existingDuplicateProfiles,
    newCompanies: plan.newCompanies, newContacts: plan.newContacts,
    duplicateContacts: plan.duplicateContacts, reviewRequired: plan.reviewRequired,
    reviewReasons: plan.reviewReasons, reviewItems: plan.reviewItems, crmWrites: 0, clayApiCalls: 0,
    emailAddressesCollected: 0, phoneNumbersCollected: 0, sourcingScheduled: false,
  });
  if (action === 'validate') {
    const body = a.body;
    must(body && ['inspect', 'backup', 'preview', 'append', 'verify'].includes(body.mode), 'CRM_SYNC_MODE_INVALID');
    must(body.mode !== 'append' || body.protocol === 'CENTRAL_CRM_V2', 'CRM_SYNC_LOCKED_OPERATOR_PROTOCOL_REQUIRED');
    must(/^[A-Za-z0-9_-]{16,80}$/.test(body.batchId || ''), 'CRM_SYNC_BATCH_ID_REQUIRED');
    must(Array.isArray(body.rows) && body.rows.length <= 5, 'CRM_SYNC_MAXIMUM_FIVE_ROWS');
    must(['inspect', 'backup'].includes(body.mode) ? body.rows.length === 0 : body.rows.length > 0, 'CRM_SYNC_ROWS_INVALID');
    const now = new Date(a.now);
    must(Number.isFinite(now.getTime()), 'CRM_SYNC_TIME_INVALID');
    const rows = body.rows.map(v => {
      must(v && typeof v === 'object' && !Array.isArray(v), 'CRM_SYNC_ROW_INVALID');
      must(!v.email && !v.phone && !v.workEmail && !v['Work email'], 'CRM_SYNC_EMAIL_PHONE_NOT_SUPPORTED');
      const row = {};
      for (const field of ['sourceId', 'fullName', 'company', 'title', 'domain', 'website', 'personLinkedIn', 'location']) {
        must(v[field] == null || typeof v[field] === 'string', 'CRM_SYNC_FIELD_INVALID');
        row[field] = text(v[field]);
        must(row[field].length <= (['website', 'personLinkedIn'].includes(field) ? 1500 : 500) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(row[field]), 'CRM_SYNC_FIELD_INVALID');
      }
      must(/^[A-Za-z0-9_:-]{1,200}$/.test(row.sourceId), 'CRM_SYNC_STABLE_SOURCE_ID_REQUIRED');
      must(row.company && row.fullName, 'CRM_SYNC_COMPANY_AND_PERSON_REQUIRED');
      row.personLinkedIn = linkedin(row.personLinkedIn);
      must(row.personLinkedIn, 'CRM_SYNC_PERSON_PROFILE_REQUIRED');
      const d1 = domain(row.domain), d2 = domain(row.website);
      must(!d1 || !d2 || d1 === d2, 'CRM_SYNC_DOMAIN_CONFLICT');
      row.domain = d1 || d2;
      row.contactId = 'SB-CLAY-P-' + row.sourceId;
      return row;
    });
    return {mode: body.mode, batchId: body.batchId, rows, observedAt: now.toISOString()};
  }
  if (action === 'sheets') {
    const sheets = unwrap(a.response).sheets;
    must(Array.isArray(sheets), 'CRM_SYNC_METADATA_REQUIRED');
    const result = {};
    for (const title of Object.keys(required)) {
      const matches = sheets.map(s => s.properties).filter(p => p && p.title === title);
      must(matches.length === 1, 'CRM_SYNC_REQUIRED_TAB_MISSING_OR_AMBIGUOUS');
      const p = matches[0];
      must(!p.hidden && (!p.sheetType || p.sheetType === 'GRID'), 'CRM_SYNC_TARGET_TAB_UNAVAILABLE');
      must(Number.isSafeInteger(p.sheetId) && p.sheetId >= 0 && Number.isInteger(p.gridProperties?.rowCount) && p.gridProperties.rowCount > 0 && p.gridProperties.rowCount <= 20000 && Number.isInteger(p.gridProperties?.columnCount) && p.gridProperties.columnCount > 0 && p.gridProperties.columnCount <= 100, 'CRM_SYNC_GRID_LIMIT');
      let column = '', index = p.gridProperties.columnCount;
      while (index > 0) { index--; column = String.fromCharCode(65 + index % 26) + column; index = Math.floor(index / 26); }
      // Whole columns stay inside the actual grid and include rows added by appendCells.
      result[title] = {sheetId: p.sheetId, range: "'" + title + "'!A:" + column};
    }
    return result;
  }
  const snapshot = (response, sheets) => {
    const ranges = unwrap(response).valueRanges;
    must(Array.isArray(ranges) && ranges.length === 3, 'CRM_SYNC_BATCH_READ_INCOMPLETE');
    const result = {};
    Object.keys(required).forEach((title, i) => {
      const r = ranges[i];
      must(typeof r?.range === 'string' && (r.range.replace(/^'/, '').startsWith(title + "'!") || r.range.startsWith(title + '!')), 'CRM_SYNC_RANGE_MISMATCH');
      const values = r.values || [];
      must(values.length <= 20000 && Array.isArray(values[0]) && values[0].length <= 100, 'CRM_SYNC_HEADERS_REQUIRED');
      const headers = values[0].map(normal), map = {};
      for (const field of required[title]) {
        const indices = headers.flatMap((h, j) => h === normal(field) ? [j] : []);
        must(indices.length === 1, 'CRM_SYNC_COLUMN_MISSING_OR_AMBIGUOUS');
        map[field] = indices[0];
      }
      must(values.every(row => Array.isArray(row) && row.length <= 100), 'CRM_SYNC_ROWS_INVALID');
      const rows = values.slice(1).filter(row => row.some(v => text(v)));
      const idField = required[title][0], seen = new Set();
      for (const cells of rows) {
        const id = text(cells[map[idField]]);
        must(id, 'CRM_SYNC_EXISTING_ROW_WITHOUT_ID');
        must(!seen.has(id), 'CRM_SYNC_EXISTING_DUPLICATE_ID');
        seen.add(id);
      }
      result[title] = {sheetId: sheets[title].sheetId, values, rows, map};
    });
    return result;
  };
  if (action === 'plan') {
    const request = a.request, data = snapshot(a.response, a.sheets);
    const companies = data.KONTRAHENCI, contacts = data.KONTAKTY, runs = data.AGENT_RUNS;
    const companyMap = new Map(), companyNames = new Map(), people = new Map(), personNames = new Set(), contactIds = new Map();
    const field = (table, row, name) => text(row[table.map[name]]);
    const addIndex = (map, k, v) => { if (k) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); } };
    for (const c of companies.rows) {
      const company = {id: field(companies, c, 'ID_FIRMY'), name: field(companies, c, 'Firma')};
      addIndex(companyMap, domain(field(companies, c, 'Strona WWW')), company);
      addIndex(companyNames, normal(company.name), company);
    }
    let duplicateProfiles = 0;
    for (const c of contacts.rows) {
      const id = field(contacts, c, 'ID_KONTAKTU'), profile = linkedin(field(contacts, c, 'LinkedIn'));
      if (profile && people.has(profile)) duplicateProfiles++;
      addIndex(people, profile, id); contactIds.set(id, {profile, cells: c});
      personNames.add(normal(field(contacts, c, 'Osoba')) + '|' + normal(field(contacts, c, 'Firma')));
    }
    const auditRows = ['inspect', 'backup'].includes(request.mode) ? [] : runs.rows.filter(r => field(runs, r, 'RUN_ID') === request.batchId);
    must(auditRows.length <= 1, 'CRM_SYNC_DUPLICATE_BATCH_RECEIPT');
    const plan = {mode: request.mode, batchId: request.batchId, sourceRows: request.rows.length,
      existingCompanies: companies.rows.length, existingContacts: contacts.rows.length,
      existingDuplicateProfiles: duplicateProfiles, newCompanies: 0, newContacts: 0,
      duplicateContacts: 0, reviewRequired: 0, reviewReasons: {}, reviewItems: [], expected: [],
      baseline: data, appendRows: {KONTRAHENCI: [], KONTAKTY: []}, observedAt: request.observedAt};
    let currentSourceId;
    const review = reason => { plan.reviewRequired++; plan.reviewReasons[reason] = (plan.reviewReasons[reason] || 0) + 1; plan.reviewItems.push({sourceId: currentSourceId, reason}); };
    const buildRow = (table, fields) => {
      const cells = Array(table.values[0].length).fill('');
      for (const [key, value] of Object.entries(fields)) { must(Object.hasOwn(table.map, key), 'CRM_SYNC_FIELD_MAP_INVALID'); cells[table.map[key]] = value; }
      return cells;
    };
    const batchProfiles = new Map(), batchIds = new Map();
    for (const row of request.rows) {
      currentSourceId = row.sourceId;
      if (batchProfiles.has(row.personLinkedIn) || batchIds.has(row.sourceId)) {
        const old = batchProfiles.get(row.personLinkedIn) || batchIds.get(row.sourceId);
        must(old.fullName === row.fullName && old.company === row.company && old.personLinkedIn === row.personLinkedIn && old.sourceId === row.sourceId, 'CRM_SYNC_BATCH_IDENTITY_CONFLICT');
        plan.duplicateContacts++; continue;
      }
      batchProfiles.set(row.personLinkedIn, row); batchIds.set(row.sourceId, row);
      const knownId = contactIds.get(row.contactId);
      if (knownId && knownId.profile !== row.personLinkedIn) { review('SOURCE_ID_PROFILE_CONFLICT'); continue; }
      if (people.has(row.personLinkedIn) || knownId) {
        plan.duplicateContacts++;
        if (knownId) plan.expected.push({contactId: row.contactId, profile: row.personLinkedIn, companyId: field(contacts, knownId.cells, 'ID_FIRMY')});
        continue;
      }
      if (personNames.has(normal(row.fullName) + '|' + normal(row.company))) { review('POSSIBLE_PERSON_DUPLICATE'); continue; }
      if (!row.domain) { review('COMPANY_DOMAIN_MISSING'); continue; }
      const matches = companyMap.get(row.domain) || [];
      if (matches.length > 1) { review('AMBIGUOUS_COMPANY_DOMAIN'); continue; }
      let company = matches[0];
      if (company && normal(company.name) !== normal(row.company)) { review('COMPANY_DOMAIN_NAME_CONFLICT'); continue; }
      if (!company && companyNames.has(normal(row.company))) { review('POSSIBLE_COMPANY_DUPLICATE'); continue; }
      if (!company) {
        company = {id: 'SB-CLAY-C-' + row.domain, name: row.company};
        must(!companies.rows.some(c => field(companies, c, 'ID_FIRMY') === company.id), 'CRM_SYNC_COMPANY_ID_CONFLICT');
        const cells = buildRow(companies, {'ID_FIRMY': company.id, Firma: company.name, Typ: 'LEAD', Kraj: '', Branza: '', 'Strona WWW': 'https://' + row.domain,
          Zrodlo: 'Clay backup', Agent: 'n8n CRM sync', 'Data aktualizacji': request.observedAt.slice(0, 10), Uwagi: 'Imported from existing Clay backup; unconfirmed lead.', 'Klucz firmy': row.domain, Weryfikacja: 'unconfirmed'});
        plan.appendRows.KONTRAHENCI.push(cells); plan.newCompanies++;
        companyMap.set(row.domain, [company]); addIndex(companyNames, normal(company.name), company);
      }
      const cells = buildRow(contacts, {'ID_KONTAKTU': row.contactId, 'ID_FIRMY': company.id, Firma: company.name, Osoba: row.fullName, Stanowisko: row.title,
        LinkedIn: row.personLinkedIn, Zrodlo: 'Clay backup', 'Status weryfikacji': 'unconfirmed', Uwagi: 'Clay ID: ' + row.sourceId + '; batch: ' + request.batchId + (row.location ? '; source location: ' + row.location : '')});
      plan.appendRows.KONTAKTY.push(cells); plan.newContacts++;
      plan.expected.push({contactId: row.contactId, profile: row.personLinkedIn, companyId: company.id, cells});
      people.set(row.personLinkedIn, [row.contactId]); personNames.add(normal(row.fullName) + '|' + normal(row.company));
    }
    for (const title of ['KONTRAHENCI', 'KONTAKTY']) must(data[title].values.length + plan.appendRows[title].length < 20000, 'CRM_SYNC_RANGE_LIMIT');
    if (auditRows.length) {
      const r = auditRows[0], savedIds = unique(field(runs, r, 'ID_REKORDOW_CRM').split(',').map(text).filter(Boolean));
      const expectedIds = unique(plan.expected.map(p => p.contactId));
      must(plan.newContacts === 0 && savedIds.length === expectedIds.length && savedIds.every(id => expectedIds.includes(id)), 'CRM_SYNC_BATCH_RECEIPT_CONFLICT');
      let saved;
      try { saved = JSON.parse(field(runs, r, 'UWAGI')); } catch { throw Error('CRM_SYNC_AUDIT_RECEIPT_INVALID'); }
      must(saved?.schema === 'CENTRAL_CRM_V2' && saved.batchId === request.batchId && saved.sourceRows === request.rows.length, 'CRM_SYNC_AUDIT_RECEIPT_INVALID');
      for (const name of ['newCompanies', 'newContacts', 'duplicateContacts', 'reviewRequired']) must(Number.isInteger(saved[name]) && saved[name] >= 0 && saved[name] <= request.rows.length, 'CRM_SYNC_AUDIT_RECEIPT_INVALID');
      must(saved.newContacts > 0 && saved.newCompanies <= saved.newContacts && saved.newContacts + saved.duplicateContacts + saved.reviewRequired === saved.sourceRows, 'CRM_SYNC_AUDIT_RECEIPT_INVALID');
      plan.originalCounts = saved;
      plan.priorReceipt = true;
    }
    plan.canWrite = request.mode === 'append' && plan.newContacts > 0 && !plan.priorReceipt;
    if (plan.canWrite) {
      const oslo = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).format(new Date(request.observedAt));
      const originalCounts = {schema: 'CENTRAL_CRM_V2', batchId: request.batchId, sourceRows: plan.sourceRows, newCompanies: plan.newCompanies, newContacts: plan.newContacts, duplicateContacts: plan.duplicateContacts, reviewRequired: plan.reviewRequired, reviewReasons: plan.reviewReasons, reviewItems: plan.reviewItems, observedAtUtc: request.observedAt};
      const audit = buildRow(runs, {RUN_ID: request.batchId, DATA_OSLO: oslo.slice(0, 10), AGENT: 'ShadowBridge Clay backup sync', START_OSLO: oslo + ' Europe/Oslo', KONIEC_OSLO: oslo + ' Europe/Oslo',
        STATUS: 'STORED_ATOMICALLY', NOWE_REKORDY: String(plan.newCompanies + plan.newContacts), ZAKTUALIZOWANE_REKORDY: '0', ID_REKORDOW_CRM: plan.expected.map(p => p.contactId).join(','),
        ARKUSZE_CRM: 'KONTRAHENCI,KONTAKTY', ZRODLA_URL: 'Private Clay recovery backup', NARZEDZIA: 'n8n; Google Sheets API', BLAD_LUB_BRAKI: JSON.stringify(plan.reviewReasons), UWAGI: JSON.stringify(originalCounts)});
      must(runs.values.length + 1 < 20000, 'CRM_SYNC_RANGE_LIMIT');
      const entries = [...Object.entries(plan.appendRows), ['AGENT_RUNS', [audit]]].filter(([, rows]) => rows.length);
      plan.writeBody = {requests: entries.map(([title, rows]) => ({appendCells: {sheetId: data[title].sheetId, rows: rows.map(row => ({values: row.map(v => ({userEnteredValue: {stringValue: text(v)}}))})), fields: 'userEnteredValue'}})), includeSpreadsheetInResponse: false};
    }
    if (request.mode === 'verify') must(plan.newContacts === 0 && plan.expected.length > 0 && plan.priorReceipt, 'CRM_SYNC_UNCERTAIN_WRITE_NOT_RECONCILED');
    return plan;
  }
  if (action === 'preview') return summary(a.plan);
  if (action === 'backup') return {...summary(a.plan), privateSnapshot: a.plan.baseline};
  if (action === 'recheck') {
    const current = snapshot(a.response, a.sheets);
    must(JSON.stringify(current) === JSON.stringify(a.plan.baseline), 'CRM_SYNC_CHANGED_BEFORE_WRITE');
    return a.plan;
  }
  if (action === 'ack') {
    const body = unwrap(a.response);
    must(Array.isArray(body.replies) && body.replies.length === a.plan.writeBody.requests.length, 'CRM_SYNC_WRITE_ACK_UNCERTAIN');
    return {acknowledged: true};
  }
  if (action === 'verify') {
    const data = snapshot(a.response, a.sheets), plan = a.plan;
    const contactMap = data.KONTAKTY.map, companyMap = data.KONTRAHENCI.map;
    for (const expected of plan.expected) {
      const rows = data.KONTAKTY.rows.filter(r => text(r[contactMap.ID_KONTAKTU]) === expected.contactId);
      must(rows.length === 1 && linkedin(rows[0][contactMap.LinkedIn]) === expected.profile && text(rows[0][contactMap.ID_FIRMY]) === expected.companyId, 'CRM_SYNC_READBACK_NOT_CONFIRMED');
      must(data.KONTAKTY.rows.filter(r => linkedin(r[contactMap.LinkedIn]) === expected.profile).length === 1, 'CRM_SYNC_DUPLICATE_PROFILE_AFTER_WRITE');
      must(data.KONTRAHENCI.rows.filter(r => text(r[companyMap.ID_FIRMY]) === expected.companyId).length === 1, 'CRM_SYNC_COMPANY_READBACK_NOT_CONFIRMED');
      if (expected.cells) must(expected.cells.every((v, i) => text(rows[0][i]) === text(v)), 'CRM_SYNC_READBACK_FIELDS_DIFFER');
    }
    if (plan.newContacts > 0 || plan.priorReceipt) must(data.AGENT_RUNS.rows.filter(r => text(r[data.AGENT_RUNS.map.RUN_ID]) === plan.batchId).length === 1, 'CRM_SYNC_AUDIT_READBACK_NOT_CONFIRMED');
    return {...summary(plan), status: plan.mode === 'verify' ? 'READBACK_CONFIRMED' : 'CRM_SYNC_READBACK_CONFIRMED',
      crmWrites: plan.canWrite ? plan.newCompanies + plan.newContacts + 1 : 0,
      confirmedContacts: plan.expected.length, atomicSheetsRequests: plan.canWrite ? 1 : 0, ...(plan.originalCounts ? {originalCounts: plan.originalCounts} : {})};
  }
  throw Error('CRM_SYNC_STAGE_INVALID');
}
