// English baseline. Stable taxonomy keys and ISO country/currency codes remain
// language-independent; future locales can replace this presentation dictionary.
export const locale = 'en';
export const messages = {
  searchLabel: 'Search products, categories or demo suppliers', search: 'Search offers',
  browse: 'Browse offers', allCategories: 'All categories', allSubcategories: 'All subcategories',
  allCountries: 'All countries', allTypes: 'All offer types', allCurrencies: 'All currencies',
  noResults: 'No demo offers match your filters.', reset: 'Clear filters',
  priceNotProvided: 'Price not provided', demoEnquiry: 'Enquire · demo only',
  newest: 'Newest first', titleAscending: 'Name: A–Z', titleDescending: 'Name: Z–A', country: 'Supplier country',
  previous: 'Previous', next: 'Next', viewSupplier: 'View demo supplier',
};
export function t(key) {
  if (!Object.hasOwn(messages,key)) throw new Error(`Missing English message: ${key}`);
  return messages[key];
}
export const number = value => new Intl.NumberFormat(locale).format(value);
export const money = (value,currency) => new Intl.NumberFormat(locale, { style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:2 }).format(value);
export const date = value => new Intl.DateTimeFormat(locale, { dateStyle:'medium', timeZone:'UTC' }).format(new Date(value));
