// Owner-confirmed facts approved for public display. Each trade brand references
// one shared operator instead of duplicating or inventing a separate company.
// A registered address is absent until separately approved for publication.
export const legalOperators = Object.freeze({
  'norway-934957296': Object.freeze({
    id: 'norway-934957296',
    legalName: 'THØR NORDIC COMMERCE V/ TROJANOWSKI',
    organizationNumber: '934957296',
    legalForm: 'Enkeltpersonforetak (ENK)',
    registrationCountry: 'Norway',
    registeredAddress: null,
  }),
});

export const tradeBrands = Object.freeze({
  shadowbridge: Object.freeze({
    id: 'shadowbridge',
    operatorId: 'norway-934957296',
    brand: 'SHADOWBRIDGE',
    activity: 'Selective international B2B brokerage and commercial introductions',
    formalEmail: 'shadowbridge.trade@gmail.com',
    website: 'https://shadow-bridge.eu/',
  }),
});

export const legalInformation = tradeBrands.shadowbridge;

const fields = [
  ['brand', 'Trade brand'],
  ['legalName', 'Legal operator'],
  ['organizationNumber', 'Organization number'],
  ['legalForm', 'Legal form'],
  ['registrationCountry', 'Country of registration'],
  ['registeredAddress', 'Registered business address'],
  ['activity', 'Activity'],
  ['formalEmail', 'Formal correspondence'],
  ['website', 'Website'],
];

export function renderLegalInformation(container, brand = legalInformation, operators = legalOperators) {
  const operator = operators[brand.operatorId];
  if (!operator) throw new Error('The trade brand must reference a configured legal operator.');
  const information = { ...brand, ...operator };
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  for (const [key, label] of fields) {
    let value = typeof information[key] === 'string' ? information[key].trim() : '';
    if (!value) continue;
    if (key === 'organizationNumber') value = value.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
    const item = document.createElement('div');
    item.className = 'entry-field entry-wide';
    const caption = document.createElement('strong');
    caption.textContent = label;
    const content = document.createElement('p');
    if (key === 'formalEmail' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      const link = document.createElement('a');
      link.href = `mailto:${value}`;
      link.textContent = value;
      content.append(link);
    } else if (key === 'website') {
      let url;
      try { url = new URL(value); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = value;
      content.append(link);
    } else {
      content.textContent = value;
    }
    item.append(caption, content);
    fragment.append(item);
  }
  container.replaceChildren(fragment);
}

if (typeof document !== 'undefined') {
  const container = document.querySelector('#legal-information');
  if (container) renderLegalInformation(container);
}
