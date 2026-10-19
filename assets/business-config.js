// Supported ISO 4217 source currencies. No conversion or payment processing.
export const currencies = Object.freeze([
  Object.freeze({ code: 'EUR', label: 'EUR — Euro' }),
  Object.freeze({ code: 'USD', label: 'USD — US dollar' }),
  Object.freeze({ code: 'GBP', label: 'GBP — Pound sterling' }),
  Object.freeze({ code: 'NOK', label: 'NOK — Norwegian krone' }),
  Object.freeze({ code: 'PLN', label: 'PLN — Polish złoty' }),
]);
export const currencyCodes = Object.freeze(currencies.map(item => item.code));
