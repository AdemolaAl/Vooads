// OpenAI-compatible chat API (OpenAI, OpenRouter, Together, Groq and others). Set config.base_url for non-OpenAI hosts.
const { req } = require('./net');

async function submit(p, kind, input) {
  const base = (p.config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
  const messages = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  messages.push({ role: 'user', content: input.prompt });
  const data = await req(base + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + p.apiKey },
    body: { model: p.model || 'gpt-4o-mini', messages, max_tokens: input.max_tokens || 2000 },
    timeout: 90000,
  });
  return { done: true, result: { text: data.choices?.[0]?.message?.content || '', usage: data.usage } };
}

async function test(p) {
  const r = await submit(p, 'text', { prompt: 'Reply with the word OK.', max_tokens: 10 });
  return { ok: /ok/i.test(r.result.text), note: r.result.text };
}

module.exports = { submit, test };
