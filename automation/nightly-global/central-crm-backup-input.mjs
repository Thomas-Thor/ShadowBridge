import {createHash} from 'node:crypto';
const must = (v, code) => {if (!v) throw Error(code);};
export function decodeSourceManifest(bytes, expectedBlob) {
  must(Buffer.isBuffer(bytes) && bytes.length <= 65536, 'CRM_SYNC_MANIFEST_SIZE_INVALID');
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  must(blob === expectedBlob, 'CRM_SYNC_PINNED_MANIFEST_HASH_MISMATCH');
  let source; try {source = JSON.parse(bytes.toString('utf8'));} catch {throw Error('CRM_SYNC_MANIFEST_JSON_INVALID');}
  must(source.version === 1 && /^[a-f0-9]{40}$/.test(source.commit || '') && Number.isSafeInteger(source.totalRows) && source.totalRows > 0 && source.totalRows <= 20000 && Array.isArray(source.files) && source.files.length > 0 && source.files.length <= 100, 'CRM_SYNC_MANIFEST_INVALID');
  let count = 0; const seen = new Set();
  for (const file of source.files) {
    must(/^[A-Za-z0-9_-]{1,150}\.csv$/.test(file.name || '') && /^[a-f0-9]{40}$/.test(file.blob || '') && Number.isSafeInteger(file.rows) && file.rows > 0 && !seen.has(file.name), 'CRM_SYNC_MANIFEST_FILE_INVALID');
    seen.add(file.name); count += file.rows;
  }
  must(count === source.totalRows, 'CRM_SYNC_MANIFEST_COUNTS_INVALID');
  return source;
}
export function parseCsv(source) {
  must(typeof source === 'string' && Buffer.byteLength(source) <= 1048576, 'CRM_SYNC_CSV_SIZE_INVALID');
  const rows = []; let row = [], value = '', quoted = false, afterQuote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {value += '"'; i++;}
      else if (c === '"') {quoted = false; afterQuote = true;} else value += c;
    } else if (c === '"') {must(!value && !afterQuote, 'CRM_SYNC_CSV_INVALID'); quoted = true;}
    else if (c === ',') {row.push(value); value = ''; afterQuote = false;}
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; afterQuote = false;
    } else {must(!afterQuote, 'CRM_SYNC_CSV_INVALID'); value += c;}
  }
  must(!quoted, 'CRM_SYNC_CSV_UNCLOSED_QUOTE');
  if (value || row.length || afterQuote) {row.push(value); rows.push(row);}
  return rows.filter(r => r.some(v => v !== ''));
}
export function decodeBackup(bytes, file) {
  must(Buffer.isBuffer(bytes) && bytes.length <= 1048576, 'CRM_SYNC_BACKUP_SIZE_INVALID');
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  must(blob === file.blob, 'CRM_SYNC_PINNED_BACKUP_HASH_MISMATCH');
  const rows = parseCsv(bytes.toString('utf8'));
  must(JSON.stringify(rows.shift()) === JSON.stringify(['ID','Name','Company','Job title','Domain','Website','LinkedIn','Location','Work email','Clay task']), 'CRM_SYNC_BACKUP_HEADERS_CHANGED');
  must(rows.length === file.rows && rows.every(r => r.length === 10 && !r[8].trim()), 'CRM_SYNC_BACKUP_SCOPE_OR_COUNT_CHANGED');
  return rows.map(r => ({sourceId: r[0], fullName: r[1], company: r[2], title: r[3], domain: r[4], website: r[5], personLinkedIn: r[6], location: r[7]}));
}
export function validateBackupSet(rows, expectedCount) {
  must(Number.isSafeInteger(expectedCount) && expectedCount > 0 && rows.length === expectedCount, 'CRM_SYNC_BACKUP_SET_INCOMPLETE');
  const ids = new Set(), profiles = new Set();
  for (const row of rows) {
    const match = /^https?:\/\/(?:(?:www|[a-z]{2})\.)?linkedin\.com\/in\/([^/?#\s]+)/i.exec(row.personLinkedIn);
    must(match && row.sourceId && !ids.has(row.sourceId) && !profiles.has(match[1].toLowerCase()), 'CRM_SYNC_BACKUP_DUPLICATE_OR_MISSING_IDENTITY');
    ids.add(row.sourceId); profiles.add(match[1].toLowerCase());
  }
  return rows;
}
