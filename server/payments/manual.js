// Bank transfer / manual payment: the customer sees your bank details and a reference, pays from their bank, then uploads
// a screenshot or receipt in the studio. Staff check it in Admin → Payments → "Waiting for review" and approve it (credits
// are added) or reject it. No API keys. Several manual methods are allowed (e.g. one per country or currency).
const config = require('../config');

async function checkout(m, { payment }) {
  const c = m.config || {};
  if (!c.account_number && !c.instructions) throw new Error(`Add the bank details for "${m.name}" in Admin → Payment methods.`);
  return { url: `${config.appUrl}/app?manual=${payment.id}#wallet`, ref: `mn${m.id}_${payment.id}` };
}
const webhook = () => ({ type: 'ignore' });

// What the customer sees (no secrets here: bank details are meant to be shown).
function instructions(m, payment) {
  const c = m.config || {};
  const currency = String(c.currency || 'USD').toUpperCase();
  const rate = currency === 'USD' ? 1 : Number(c.usd_rate) || 0;
  return {
    method: m.name, bank_name: c.bank_name || '', account_name: c.account_name || '', account_number: c.account_number || '', extra: c.instructions || '',
    reference: 'VA-' + payment.id, currency, amount_usd: Math.round(Number(payment.charged_usd || payment.amount_usd) * 100) / 100,
    amount_local: rate ? Math.round(Number(payment.charged_usd || payment.amount_usd) * rate * 100) / 100 : null, review_hours: Number(c.review_hours) || 12, logo_url: c.logo_url || '',
  };
}

module.exports = {
  label: 'Bank transfer (manual, customer uploads proof)', checkout, webhook, instructions, recurring: false, multiple: true, fields: [],
  help: 'Customers pay into your bank account, then upload proof in the studio. You approve it in Admin → Payments.',
  config_fields: [
    { key: 'bank_name', label: 'Bank name', help: 'e.g. GTBank, Access Bank, Equity Bank.', type: 'text' },
    { key: 'account_name', label: 'Account name', help: 'Exactly as the bank shows it, e.g. Zedapex Limited.', type: 'text' },
    { key: 'account_number', label: 'Account number (or IBAN)', help: 'Shown to the customer with a copy button.', type: 'text' },
    { key: 'instructions', label: 'Extra instructions (optional)', help: 'Sort code, SWIFT, mobile money number, or anything else the customer needs.', type: 'textarea' },
    { key: 'currency', label: 'Currency', help: 'Currency the customer sends, e.g. NGN, GHS, KES, USD.', type: 'text' },
    { key: 'usd_rate', label: 'Local units per 1 USD', help: 'Used to show the amount in local money. 1 for USD.', type: 'number' },
    { key: 'review_hours', label: 'We confirm within (hours)', help: 'Shown to the customer after they upload proof.', type: 'number' },
  ],
};
