// Payment method registry. Admin turns methods on, adds keys and picks which countries see each one.
// Add a new payment provider by creating a file here that exports { label, checkout, webhook, fields, config_fields } and listing it in ADAPTERS.
// fields: which secrets the admin form shows ('secret', 'webhookSecret').
// config_fields: [{key, label, help, type:'text'|'textarea'|'number'|'select', options?}] stored in payment_methods.config.
// multiple: true means the admin can add many rows of this adapter (each gets its own webhook URL).
const { all, get, J } = require('../db');
const { decrypt } = require('../lib/util');
const config = require('../config');

const ADAPTERS = {
  stripe: require('./stripe'),
  paystack: require('./paystack'),
  flutterwave: require('./flutterwave'),
  nowpayments: require('./nowpayments'),
  gatevoo: require('./gatevoo'),
  bachs: require('./bachs'),
  custom: require('./custom'),
  manual: require('./manual'),
  test: require('./test'),
};

// Config inputs for the built-in adapters that do not declare their own.
const LOCAL_CURRENCY = [
  { key: 'currency', label: 'Currency', help: 'Currency the customer is charged in, e.g. NGN, GHS, KES, ZAR or USD.', type: 'text' },
  { key: 'usd_rate', label: 'Local units per 1 USD', help: 'Exchange rate used to convert plan prices. 1 for USD.', type: 'number' },
];
const DEFAULT_CONFIG_FIELDS = {
  stripe: [],
  paystack: LOCAL_CURRENCY,
  flutterwave: LOCAL_CURRENCY,
  nowpayments: [{ key: 'pay_currency', label: 'Coin (optional)', help: 'Force one coin, e.g. usdttrc20. Leave empty to let the customer choose.', type: 'text' }],
  test: [],
};
for (const [k, a] of Object.entries(ADAPTERS)) if (!a.config_fields) a.config_fields = DEFAULT_CONFIG_FIELDS[k] || [];

function hydrate(m) {
  return m && { ...m, config: J(m.config, {}), countries: J(m.countries, []), secret: decrypt(m.secret_enc), webhookSecret: decrypt(m.webhook_secret_enc) };
}

// Methods a customer from this country can use.
// On staging, methods with live keys are hidden (staging.paymentProblem) and the test method is always offered.
const TEST_METHOD = () => ({ id: 0, name: config.isStaging ? 'Test payment (staging, no real money)' : 'Test payment (dev only)', adapter: 'test', config: {}, countries: [] });
function forCountry(country) {
  const staging = require('../staging');
  const rows = all('SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort ASC, id ASC').map(hydrate)
    .filter((m) => m.adapter !== 'test' || config.testPayments)
    .filter((m) => !staging.paymentProblem(m))
    .filter((m) => !ADAPTERS[m.adapter]?.hidden || !ADAPTERS[m.adapter].hidden(m)) // e.g. a Bachs sandbox key on the live site
    // Methods that serve customers we cannot place yet (Bachs) are also shown when the country is unknown.
    .filter((m) => !m.countries.length || m.countries.includes('*') || (country && m.countries.includes(country)) || (!country && ADAPTERS[m.adapter]?.showUnknownCountry));
  if (config.testPayments && (config.isStaging || !rows.length) && !rows.some((m) => m.adapter === 'test')) rows.push(TEST_METHOD());
  return rows;
}
const byId = (id) => (Number(id) === 0 && config.testPayments ? { ...TEST_METHOD(), name: 'Test payment' } : hydrate(get('SELECT * FROM payment_methods WHERE id = ?', id)));
const byAdapter = (adapter) => hydrate(get('SELECT * FROM payment_methods WHERE adapter = ? AND enabled = 1 ORDER BY id LIMIT 1', adapter));

const byAdapterAny = (adapter) => hydrate(get('SELECT * FROM payment_methods WHERE adapter = ? AND secret_enc IS NOT NULL ORDER BY enabled DESC, id LIMIT 1', adapter));
// One method row by id and adapter, enabled or not (webhooks keep working after a method is switched off).
const byIdAdapter = (id, adapter) => hydrate(get('SELECT * FROM payment_methods WHERE id = ? AND adapter = ?', Number(id), adapter));

module.exports = { ADAPTERS, forCountry, byId, byAdapter, byAdapterAny, byIdAdapter, hydrate };
