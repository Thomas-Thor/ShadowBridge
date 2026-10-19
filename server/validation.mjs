import { currencyCodes } from '../assets/business-config.js';
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function object(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_INPUT', 'Expected an object.');
  if (Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new ApiError(400, 'INVALID_FIELDS', 'Unexpected or missing fields.');
  return value;
}
export function text(value, name, { min = 0, max = 4000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ApiError(400, 'INVALID_INPUT', `Invalid ${name}.`);
  return value.trim();
}
export function oneOf(value, values, name = 'value') { if (!values.includes(value)) throw new ApiError(400, 'INVALID_INPUT', `Invalid ${name}.`); return value; }
export function number(value, name, optional = false) {
  if (optional && (value === '' || value === undefined || value === null)) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e15) throw new ApiError(400, 'INVALID_INPUT', `Invalid ${name}.`);
  return Number(value);
}
export function list(value, name) {
  if (!Array.isArray(value) || value.length > 30) throw new ApiError(400, 'INVALID_INPUT', `Invalid ${name}.`);
  return value.map(item => text(item, name, { min: 2, max: 100 }));
}
export function identifier(value) { if (!/^[a-zA-Z0-9-]{4,100}$/.test(value || '')) throw new ApiError(400, 'INVALID_ID', 'Invalid record identifier.'); return value; }
export function assertNonIdentifyingText(content) {
  // A public classification UUID is excluded by its caller. Other identifiers,
  // even inside otherwise commercial text, require an internal review.
  const identifiers = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]{1,62}\.[a-z]{2,63}\b|(?:\+|00)\d[\d ()-]{6,}\d|\b\d{8,15}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  if (identifiers.test(content)) throw new ApiError(400, 'IDENTIFYING_CONTENT', 'Remove contact details and identifying information before approval.');
}
export function profile(value = {}) {
  object(value, ['countries', 'sectors', 'summary']);
  return { countries: list(value.countries || [], 'countries'), sectors: list(value.sectors || [], 'sectors'), summary: text(value.summary || '', 'summary') };
}
const definitions = {
  offers: ['categoryId','subcategoryId','category','subcategory','productName','description','specification','countryOfOrigin','quantity','unit','price','currency','minimumOrderQuantity','incoterms','loadingLocation','deliveryTerms','availability','validUntil','certificationsStatus','notes','dimensions','weight','packaging','transport'],
  rfqs: ['categoryId','subcategoryId','category','subcategory','product','specifications','quantity','unit','budget','currency','deliveryCountry','deadline','certificates','requirements'],
  proposals: ['title','description','countries','sectors','scope'],
  commercial: ['title','categoryId','subcategoryId','category','subcategory','specification','quantity','unit','price','currency','incoterms','availability','validUntil'],
};
export function businessData(kind, input, { submit = false } = {}) {
  const keys = definitions[kind]; object(input, keys);
  const output = {};
  for (const key of keys) {
    if (!Object.hasOwn(input, key)) continue;
    if (['categoryId','subcategoryId'].includes(key)) {
      if (key==='subcategoryId' && (input[key]===null || input[key]==='')) output[key]=null;
      else {
        if (typeof input[key]!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input[key])) throw new ApiError(400,'INVALID_CATEGORY',`Choose a valid ${key}.`);
        output[key]=input[key].toLowerCase();
      }
    }
    else if (['quantity','price','budget','minimumOrderQuantity'].includes(key)) output[key] = number(input[key], key, true);
    else if (['countries','sectors'].includes(key) && Array.isArray(input[key])) output[key] = list(input[key], key);
    else output[key] = text(input[key], key, { max: ['description','specification','specifications','requirements','notes','scope'].includes(key) ? 8000 : 250 });
  }
  if (output.currency && !currencyCodes.includes(output.currency)) throw new ApiError(400, 'INVALID_CURRENCY', 'Choose a supported ISO 4217 currency.');
  if (['offers','rfqs','commercial'].includes(kind) && !output.categoryId) throw new ApiError(400,'CATEGORY_REQUIRED','Choose a category before saving.');
  for (const key of ['deadline','validUntil']) if (output[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(output[key]) || (Number.isNaN(Date.parse(output[key])) || new Date(output[key]).toISOString().slice(0,10)!==output[key]))) throw new ApiError(400, 'INVALID_INPUT', `Invalid ${key}.`);
  if (output.incoterms && !/^(EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF)(?:\s.*)?$/.test(output.incoterms)) throw new ApiError(400, 'INVALID_INPUT', 'Use a recognised Incoterm.');
  if (submit || kind === 'commercial') {
    const required = kind === 'offers' ? ['categoryId','productName','specification','countryOfOrigin','quantity','unit','currency'] : kind === 'rfqs' ? ['categoryId','product','specifications','quantity','unit','deliveryCountry','deadline'] : kind === 'proposals' ? ['title','description'] : ['title','specification'];
    for (const key of required) if (output[key] === undefined || output[key] === null || output[key] === '' || (key === 'quantity' && output[key] <= 0)) throw new ApiError(400, 'INCOMPLETE_RECORD', `Complete ${key} before submitting.`);
  }
  if (kind === 'commercial') {
    for(const key of Object.keys(output))if(output[key]===null)delete output[key];
    const content = Object.entries(output).filter(([key,value])=>typeof value==='string' && !['categoryId','subcategoryId'].includes(key)).map(([,value])=>value).join(' ');
    assertNonIdentifyingText(content);
  }
  return output;
}
