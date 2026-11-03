// Customer uploads (private, signed links for AI providers) and brand tracks (SPEC §14).
const path = require('node:path');
const { run } = require('../db');
const { fail, rateLimit, serveStatic } = require('../lib/http');
const auth = require('../auth');
const credits = require('../credits');
const uploads = require('../uploads');
const videotools = require('../videotools');

module.exports = function mount(r) {
  // Raw upload: body = the video, Content-Type video/mp4 | video/quicktime | video/webm, ?for=bg_swap|auto_edit&name=clip.mp4
  r.post('/api/uploads/video', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('vup:' + u.id, 12, 60e3);
    if (!credits.activePlan(u)) { req.resume(); fail(402, 'Video tools need a paid plan. Trial credits cover images and hooks only.'); }
    const up = await uploads.saveVideo(req, u, String(req.query.for || ''), String(req.query.name || ''));
    res.json({ upload: up, used_mb: Math.round(uploads.usedBytes(u.id) / 1e5) / 10, quota_mb: uploads.limits().quota_mb });
  });
  r.get('/api/uploads', (req, res) => {
    const u = auth.requireUser(req);
    const L = uploads.limits();
    res.json({ uploads: uploads.list(u.id), used_mb: Math.round(uploads.usedBytes(u.id) / 1e5) / 10, quota_mb: L.quota_mb, keep_days: L.keep_days, purposes: Object.fromEntries(Object.keys(uploads.PURPOSES).map((k) => [k, uploads.purpose(k)])) });
  });
  r.del('/api/uploads/:id', (req, res) => {
    const u = auth.requireUser(req);
    const up = uploads.owned(req.params.id, u.id);
    if (!up) fail(404, 'Upload not found.');
    uploads.remove(up);
    res.json({ ok: true });
  });
  // Signed, expiring link to a private upload (used by fal and by the customer's own preview). No cookie needed, no listing.
  r.get('/u/:file', (req, res) => {
    const id = String(req.params.file).split('.')[0];
    const up = uploads.verify(id, req.query.e, String(req.query.s || ''));
    const p = up && uploads.filePath(up);
    if (!p) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found or expired'); }
    res.setHeader('X-Robots-Tag', 'noindex');
    serveStatic(path.dirname(p), req, res, { maxAge: 0, path: '/' + path.basename(p) });
  });

  // ---------- Brand tracks (Brand music → My brand tracks) ----------
  r.get('/api/brand-tracks', (req, res) => {
    const u = auth.requireUser(req);
    res.json({ tracks: videotools.tracksOf(u.id) });
  });
  r.put('/api/brand-tracks/:id', async (req, res) => {
    const u = auth.requireUser(req);
    const t = videotools.ownTrack(req.params.id, u.id);
    if (!t) fail(404, 'Track not found.');
    const b = await require('../lib/http').parseJson(req);
    const name = String(b.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the track a name.');
    run('UPDATE brand_tracks SET name = ? WHERE id = ?', name, t.id);
    res.json({ track: videotools.trackView({ ...t, name }) });
  });
  r.del('/api/brand-tracks/:id', (req, res) => {
    const u = auth.requireUser(req);
    const t = videotools.ownTrack(req.params.id, u.id);
    if (!t) fail(404, 'Track not found.');
    run('UPDATE brand_tracks SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', t.id);
    res.json({ ok: true });
  });
};
