// Free stock footage for animated ads (provider kind 'stock').
//   pexels:  free key at https://www.pexels.com/api/  (header Authorization: <key>)
//   pixabay: free key at https://pixabay.com/api/docs/ (query param key=)
// submit(p, 'stock', {query, aspect, min_seconds}) → {url, width, height, duration, source, credit, page_url}
// The job then downloads the mp4 into media (media.mirror). Show the credit line if you publish the clip elsewhere.
const { req } = require('./net');

const orientationFor = (aspect) => (aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait');
const wantRatio = (aspect) => ({ '16:9': 16 / 9, '1:1': 1, '4:5': 0.8 }[aspect] || 9 / 16);
// Best file: closest shape to the ad, at least ~720p on the short side, not bigger than needed.
function pickFile(files, aspect) {
  const r = wantRatio(aspect);
  const scored = files.filter((f) => f && f.url && f.width && f.height).map((f) => {
    const short = Math.min(f.width, f.height);
    const shape = Math.abs(Math.log((f.width / f.height) / r));
    const size = short < 700 ? 2 : short > 1300 ? 0.6 : 0;
    return { f, score: shape * 3 + size };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.f || null;
}

async function pexels(p, input) {
  const q = new URLSearchParams({ query: String(input.query || '').slice(0, 100), orientation: orientationFor(input.aspect), per_page: '15', size: 'medium' });
  const headers = { Authorization: p.apiKey };
  let data;
  try { data = await req('https://api.pexels.com/videos/search?' + q, { headers, timeout: 20000 }); }
  catch (e) { if (e.status === 404) data = await req('https://api.pexels.com/v1/videos/search?' + q, { headers, timeout: 20000 }); else throw e; }
  const min = Number(input.min_seconds) || 0;
  const vids = (data.videos || []).filter((v) => !min || (v.duration || 0) >= Math.min(min, 4));
  for (const v of vids) {
    const f = pickFile((v.video_files || []).filter((x) => /mp4/.test(x.file_type || 'mp4')).map((x) => ({ url: x.link, width: x.width, height: x.height })), input.aspect);
    if (f) return { url: f.url, width: f.width, height: f.height, duration: v.duration, source: 'pexels', credit: v.user?.name ? `${v.user.name} on Pexels` : 'Pexels', page_url: v.url };
  }
  return null;
}

async function pixabay(p, input) {
  const q = new URLSearchParams({ key: p.apiKey, q: String(input.query || '').slice(0, 100), per_page: '20', safesearch: 'true', video_type: 'film' });
  const data = await req('https://pixabay.com/api/videos/?' + q, { timeout: 20000 });
  // Pixabay has no orientation filter for videos, so the shape is checked here.
  const r = wantRatio(input.aspect);
  const hits = (data.hits || []).map((h) => {
    const f = pickFile(Object.values(h.videos || {}).map((x) => ({ url: x.url, width: x.width, height: x.height })), input.aspect);
    return f && { h, f, shape: Math.abs(Math.log((f.width / f.height) / r)) };
  }).filter(Boolean).sort((a, b) => a.shape - b.shape);
  const best = hits[0];
  return best ? { url: best.f.url, width: best.f.width, height: best.f.height, duration: best.h.duration, source: 'pixabay', credit: best.h.user ? `${best.h.user} on Pixabay` : 'Pixabay', page_url: best.h.pageURL } : null;
}

function make(fn, name) {
  return {
    async submit(p, kind, input) {
      if (!p.apiKey) throw new Error(`Add the ${name} API key first.`);
      const r = await fn(p, input);
      if (!r) throw new Error(`${name} found no clip for "${String(input.query).slice(0, 60)}".`);
      return { done: true, result: r };
    },
    async test(p) {
      try { const r = await fn(p, { query: 'coffee', aspect: '9:16' }); return { ok: true, note: r ? 'Key accepted. Found a clip.' : 'Key accepted.' }; }
      catch (e) { return { ok: false, note: e.message.slice(0, 120) }; }
    },
  };
}

module.exports = { pexels: make(pexels, 'Pexels'), pixabay: make(pixabay, 'Pixabay'), pickFile };
