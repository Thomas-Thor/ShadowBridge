// Pure pilot logic. Embedded in native n8n Set expressions by build-workflow.mjs.
// No network, credentials, Code node, task runner, CRM or database connection.
export function scout(action, arg) {
  const KEY = 'europe-scout-v1';
  const sources = {
    NO: { name: 'Brønnøysundregistrene / Enhetsregisteret', url: 'https://data.brreg.no/enhetsregisteret/api/enheter', forms: ['AS', 'ASA'] },
    CZ: { name: 'ARES / Ministry of Finance Czech Republic', url: 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat', forms: ['112', '121'] },
  };
  const sectors = ['28', '25', '22', '10', '46'];
  const empty = () => ({ version: 1, companies: {}, days: {}, sources: {}, cursors: {}, events: [], commit: 'initial' });
  const fail = (message) => { throw new Error(`SCOUT: ${message}`); };
  const parse = (row) => {
    if (!row || row.scout_key !== KEY || !Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isSafeInteger(row.id)) fail('Missing/invalid journal row. Import exactly one seed row.');
    if (typeof row.state_json !== 'string' || row.state_json.length > 1500000) fail('Invalid journal size.');
    const s = JSON.parse(row.state_json);
    const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (s?.version !== 1 || !map(s.companies) || !map(s.days) || !map(s.sources) || !map(s.cursors) || !Array.isArray(s.events)) fail('Invalid journal schema.');
    if (Object.keys(s.companies).length > 500 || s.events.length > 100 || Object.keys(s.days).length > 32) fail('Journal bounds exceeded.');
    return s;
  };
  const clock = () => {
    const time = Date.parse(arg.now);
    if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}$/.test(arg.day)) fail('Invalid Oslo clock.');
    return time;
  };
  const pack = (row, state, nonce) => {
    state.commit = nonce;
    const keys = Object.keys(state.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 32))) delete state.days[k];
    state.events = state.events.slice(-100);
    const state_json = JSON.stringify(state);
    if (state_json.length > 1500000) fail('Journal full: manual review/export required.');
    return { id: row.id, previous: row.revision, revision: row.revision + 1, state_json, nonce };
  };
  const text = (value, limit = 240) => typeof value === 'string' ? value.trim().slice(0, limit) : null;
  const site = (value) => {
    const v = text(value, 500);
    // Preserve only source-provided explicit HTTP(S) URLs. Never follow them.
    return v && /^https?:\/\/[^\s/@]+(?:[/:?#][^\s]*)?$/i.test(v) ? v : null;
  };
  const records = (country, body, sector, now) => {
    const list = country === 'NO' ? body?._embedded?.enheter : body?.ekonomickeSubjekty;
    if (!Array.isArray(list) || list.length > 25) fail('Unexpected source response schema/page size.');
    return list.flatMap((r) => {
      const id = String(country === 'NO' ? r.organisasjonsnummer ?? '' : r.ico ?? '');
      const name = text(country === 'NO' ? r.navn : r.obchodniJmeno);
      const form = String(country === 'NO' ? r.organisasjonsform?.kode ?? '' : r.pravniForma ?? '');
      if (!new RegExp(country === 'NO' ? '^\\d{9}$' : '^\\d{8}$').test(id) || !name || !sources[country].forms.includes(form)) return [];
      if (r.slettedato || r.datumZaniku || r.konkurs || r.underAvvikling) return [];
      const codes = country === 'NO'
        ? [r.naeringskode1, r.naeringskode2, r.naeringskode3].filter(x => typeof x?.kode === 'string').map(x => ({ code: x.kode, description: text(x.beskrivelse) }))
        : (Array.isArray(r.czNace) ? r.czNace : []).filter(x => typeof x === 'string').map(x => ({ code: x, description: null }));
      if (!codes.some(x => x.code.replace(/\./g, '').startsWith(sector))) return [];
      const city = text(country === 'NO' ? r.forretningsadresse?.poststed : r.sidlo?.nazevObce, 120);
      const website = country === 'NO' ? site(r.hjemmeside) : null;
      const key = `${country}:${id}`;
      return [{ key, legalName: name, country, city, registrationNumber: id, legalForm: form,
        activityCodes: codes.slice(0, 10), activityClassification: country === 'NO' ? 'Source SN classification (version not asserted)' : 'Source CZ-NACE classification (version not asserted)',
        website, potentialCooperation: sector === '46' ? 'wholesale_distribution_review' : 'manufacturing_review',
        surplusEvidence: 'not_provided_by_registry', status: city ? 'unconfirmed' : 'review_required',
        source: { system: country === 'NO' ? 'brreg-enhetsregisteret' : 'ares', recordId: id, name: sources[country].name,
          url: country === 'NO' ? `${sources.NO.url}/${id}` : `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${id}` }, acquiredAt: now }];
    });
  };
  if (action === 'seed') return { scout_key: KEY, revision: 0, state_json: JSON.stringify(empty()) };
  if (action === 'jobs') {
    clock();
    if (arg.rows.length !== 1) fail('Expected exactly one pilot journal row; no writes performed.');
    parse(arg.rows[0]);
    const dayNumber = Math.floor(Date.parse(`${arg.day}T12:00:00Z`) / 86400000);
    const order = dayNumber % 2 ? ['CZ', 'NO'] : ['NO', 'CZ'];
    return { jobs: order.map((country, index) => ({ country, index, sector: sectors[(dayNumber + index) % sectors.length] })) };
  }
  if (action === 'reserve') {
    const now = clock(), row = arg.rows[0];
    if (arg.rows.length !== 1) fail('Journal row missing or duplicated.');
    const state = parse(row), { country, sector } = arg.job;
    if (!sources[country] || !sectors.includes(sector)) fail('Unknown source/sector.');
    const skip = reason => ({ fetch: false, reason, country });
    if (!arg.approvals || arg.approvals[country] !== true) return skip('Source terms/live access require operator approval.');
    const src = state.sources[country] ?? {};
    if (src.blocked || (src.nextAllowedAt ?? 0) > now || (src.inFlight?.until ?? 0) > now) return skip('Source blocked, cooling down or reserved.');
    const day = state.days[arg.day] ?? { added: 0, requests: 0, bySource: {} };
    const dailySource = day.bySource[country] ?? { added: 0, requests: 0 };
    if (day.added >= 50 || dailySource.added >= 25 || day.requests >= 8 || dailySource.requests >= 4 || Object.keys(state.companies).length >= 500) return skip('Pilot budget/full journal limit.');
    const page = state.cursors[`${country}:${sector}`] ?? 0;
    const requestId = `${arg.execution}:${arg.job.index}:${row.revision}`;
    day.requests++; dailySource.requests++; day.bySource[country] = dailySource; state.days[arg.day] = day;
    state.sources[country] = { ...src, inFlight: { requestId, until: now + 120000 }, nextAllowedAt: now + 2000 };
    const params = `naeringskode=${sector}&organisasjonsform=AS,ASA&konkurs=false&underAvvikling=false&size=25&page=${page}&sort=organisasjonsnummer,asc`;
    const query = { fetch: true, country, sector, page, requestId, reservationDay: arg.day,
      method: country === 'NO' ? 'GET' : 'POST', url: country === 'NO' ? `${sources.NO.url}?${params}` : sources.CZ.url,
      body: { czNace: [sector], pravniForma: ['112', '121'], start: page * 25, pocet: 25 } };
    return { ...query, update: pack(row, state, requestId) };
  }
  if (action === 'won') {
    const row = arg.rows[0], update = arg.update;
    return arg.rows.length === 1 && row?.revision === update.revision && row?.state_json === update.state_json;
  }
  if (action === 'commit') {
    const now = clock(), row = arg.rows[0];
    if (arg.rows.length !== 1) fail('Journal missing/duplicated at commit.');
    const state = parse(row), q = arg.query, src = state.sources[q.country];
    if (src?.inFlight?.requestId !== q.requestId) fail('Reservation expired/replaced; response not committed.');
    const status = Number(arg.response?.statusCode ?? 0);
    let added = 0, outcome = 'deferred', candidates = [];
    if (status === 200) {
      try {
        const body = typeof arg.response.body === 'string' ? JSON.parse(arg.response.body) : arg.response.body;
        candidates = records(q.country, body, q.sector, arg.now);
        outcome = 'ok';
      } catch (error) { outcome = 'schema_error'; src.blocked = true; }
    } else if (status && status !== 429 && status < 500) { outcome = `http_${status}`; src.blocked = true; }
    if (outcome === 'ok') {
      const day = state.days[arg.day] ?? { added: 0, requests: 0, bySource: {} };
      const dailySource = day.bySource[q.country] ?? { added: 0, requests: 0 };
      for (const c of candidates) {
        if (Object.hasOwn(state.companies, c.key)) continue;
        if (day.added >= 50 || dailySource.added >= 25 || Object.keys(state.companies).length >= 500) break;
        state.companies[c.key] = c;
        day.added++; dailySource.added++; added++;
      }
      day.bySource[q.country] = dailySource; state.days[arg.day] = day;
      // Re-fetch this page after a partial/budget-full commit, to avoid losing candidates.
      const remaining = candidates.some(c => !Object.hasOwn(state.companies, c.key));
      if (!remaining) {
        const count = q.country === 'NO'
          ? (typeof arg.response.body === 'string' ? JSON.parse(arg.response.body) : arg.response.body)._embedded.enheter.length
          : (typeof arg.response.body === 'string' ? JSON.parse(arg.response.body) : arg.response.body).ekonomickeSubjekty.length;
        state.cursors[`${q.country}:${q.sector}`] = count === 25 && q.page < 399 ? q.page + 1 : 0;
      }
      src.nextAllowedAt = now + 2000;
    } else {
      const headers = arg.response?.headers ?? {};
      const raw = Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
      const retry = typeof raw === 'string' && /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(String(raw ?? ''));
      if (typeof raw === 'string' && /^\d+$/.test(raw) && (!Number.isSafeInteger(retry) || retry > 8640000000000000)) src.blocked = true;
      src.nextAllowedAt = Math.max(now + 15 * 60000, Number.isFinite(retry) ? retry : 0);
    }
    delete src.inFlight;
    state.events.push({ at: arg.now, country: q.country, sector: q.sector, page: q.page, status, outcome, added });
    return { update: pack(row, state, `${q.requestId}:commit`), outcome, added };
  }
  if (action === 'summary') {
    if (arg.rows.length !== 1) fail('Invalid summary journal.');
    const state = parse(arg.rows[0]);
    return { pilotOnly: true, ownerVaultIntegration: 'disabled', day: arg.day, totals: state.days[arg.day] ?? { added: 0, requests: 0 },
      storedCompanies: Object.keys(state.companies).length, capacity: 500, sourceState: state.sources, recentEvents: state.events.slice(-10) };
  }
  fail('Unknown action.');
}
