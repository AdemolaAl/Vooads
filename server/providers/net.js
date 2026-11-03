// fetch with a timeout and readable errors.
async function req(url, { method = 'GET', headers = {}, body, timeout = 120000, raw = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method,
      headers: body && !(body instanceof Buffer) && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : body instanceof Buffer || typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (raw) {
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
      return Buffer.from(await r.arrayBuffer());
    }
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { text }; }
    if (!r.ok) {
      const msg = data?.error?.message || data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : '') || data?.message || text.slice(0, 300);
      const e = new Error(`${r.status} ${msg}`);
      e.status = r.status;
      throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The provider took too long to answer.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Read a value from an object with a path like "video.url" or "images.0.url".
const pick = (obj, p) => String(p || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);

module.exports = { req, pick };
