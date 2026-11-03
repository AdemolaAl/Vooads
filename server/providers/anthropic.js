// Anthropic Claude. Get a key at https://console.anthropic.com → API Keys.
// Default model: claude-sonnet-5-5 (scripts). For cheaper hooks/checks you can add a second provider with claude-haiku-4-5-20251001.
const { req } = require('./net');

async function submit(p, kind, input) {
  const data = await req('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
    body: {
      model: p.model || 'claude-sonnet-5-5',
      max_tokens: input.max_tokens || 2000,
      system: input.system || undefined,
      messages: [{ role: 'user', content: input.prompt }],
    },
    timeout: 90000,
  });
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { done: true, result: { text, usage: data.usage } };
}

async function test(p) {
  const r = await submit(p, 'text', { prompt: 'Reply with the word OK.', max_tokens: 10 });
  return { ok: /ok/i.test(r.result.text), note: r.result.text };
}

module.exports = { submit, test };
