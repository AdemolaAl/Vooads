// Test payments: development and staging only (config.testPayments). Never on the live site.
const config = require('../config');

async function checkout(m, { payment }) {
  if (!config.testPayments) throw new Error('Test payments are off in production.');
  return { url: `${config.appUrl}/api/pay/test/${payment.id}`, ref: 'test_' + payment.id };
}
const webhook = () => ({ type: 'ignore' });

module.exports = { label: 'Test payment (development and staging only)', checkout, webhook, recurring: false, fields: [] };
