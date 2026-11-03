// Phase 2 API: chat editing (plan → price → confirm → versions, compare, undo), the actor library, hook factory export,
// the admin Profit view (revenue vs provider costs vs payment fees, the AI bill and its settings) and actor consent review.
const { get, all, run, J } = require('../db');
const { parseJson, fail, rateLimit } = require('../lib/http');
const auth = require('../auth');
const chatedit = require('../chatedit');
const actors = require('../actors');
const llmbill = require('../llmbill');
const profit = require('../profit');
const { getSetting, setSetting } = require('../settings');

const audit = (staff, action, target, detail) => run('INSERT INTO audit_log(staff_id, action, target, detail) VALUES(?,?,?,?)', staff.id, action, String(target ?? ''), JSON.stringify(detail || {}));

module.exports = function mount(r) {
  llmbill.migrate();
  chatedit.migrate();
  actors.migrate();
  require('../pricefloor').runAll(); // one-time price floor raise + payment fee pre-fill (server/pricefloor.js)

  // ================= Chat editing =================
  r.get('/api/jobs/:id/versions', (req, res) => {
    const u = auth.requireUser(req);
    res.json(chatedit.versions(u, req.params.id));
  });
  r.post('/api/jobs/:id/chat', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('chat:' + u.id, 20, 6e4);
    const b = await parseJson(req);
    res.json(await chatedit.planMessage(u, req.params.id, b.message));
  });
  r.post('/api/jobs/:id/chat/:mid/confirm', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('chatok:' + u.id, 20, 6e4);
    res.json(await chatedit.confirm(u, req.params.id, req.params.mid));
  });
  r.post('/api/jobs/:id/label', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('label:' + u.id, 20, 6e4);
    const b = await parseJson(req);
    res.json(chatedit.labelPlan(u, req.params.id, b.on !== false));
  });
  // Failed job: try again from what was already made (pay only for what is redone).
  r.post('/api/jobs/:id/retry', (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('retry:' + u.id, 10, 6e4);
    res.json(require('../jobs').retryJob(u, req.params.id));
  });
  // Long video with a part that keeps failing: retry | still | cancel.
  r.post('/api/jobs/:id/attention', async (req, res) => {
    const u = auth.requireUser(req);
    const b = await parseJson(req);
    res.json({ job: require('../jobs').resolveAttention(u, req.params.id, String(b.action || '')) });
  });
  r.post('/api/jobs/:id/undo', (req, res) => {
    const u = auth.requireUser(req);
    res.json(chatedit.undo(u, req.params.id));
  });
  r.post('/api/jobs/:id/versions/:vid/use', (req, res) => {
    const u = auth.requireUser(req);
    res.json(chatedit.setCurrent(u, req.params.id, req.params.vid));
  });

  // ================= Hook factory: export all =================
  // Every hook clip and every spliced version of one job in a zip (our own files only; at most 25 files, 400 MB).
  r.get('/api/jobs/:id/export.zip', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('zip:' + u.id, 6, 6e4);
    const j = get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, u.id);
    if (!j || j.status !== 'done') fail(404, 'Finished video not found.');
    const out = J(j.output, {});
    const fs = require('node:fs');
    const media = require('../media');
    const list = [];
    (out.hooks || []).forEach((h, k) => { if (h.remix_url) list.push([`hook-${String(k + 1).padStart(2, '0')}-full-ad.mp4`, h.remix_url]); if (h.url) list.push([`hook-${String(k + 1).padStart(2, '0')}-clip.mp4`, h.url]); });
    if (!list.length && out.url) list.push(['video.mp4', out.url]);
    const entries = [];
    let bytes = 0;
    for (const [name, url] of list.slice(0, 25)) {
      const m = String(url || '').match(/^\/(media|samples)\/([\w.-]+)$/);
      const p = m && (m[1] === 'media' ? media.filePath(m[2]) : require('../samples').localPath(m[2]));
      if (!p) continue;
      const data = fs.readFileSync(p);
      bytes += data.length;
      if (bytes > 400e6) break;
      entries.push({ name, data });
    }
    if (!entries.length) fail(400, 'There are no files to export yet.');
    if (out.hooks) entries.push({ name: 'hooks.txt', data: Buffer.from(out.hooks.map((h, k) => `${k + 1}. ${h.text}`).join('\n') + '\n\nMade with Vooads. Every face is AI-generated: do not present these as real customers or reviews.\n') });
    const buf = require('../lib/zip').zip(entries);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="vooads-${j.id}.zip"`, 'Cache-Control': 'no-store' });
    res.end(buf);
  });

  // ================= Actor library =================
  r.get('/api/actors', (req, res) => {
    const u = auth.requireUser(req);
    res.json(actors.list(u.id));
  });
  // Recommended row (6-8): the customer's last-used actor, the pinned originals, then picks for their market and format.
  r.get('/api/actors/recommended', (req, res) => {
    const u = auth.requireUser(req);
    const ha = require('../houseactors');
    let flags = {}, brand = {};
    try { flags = JSON.parse(u.flags || '{}') || {}; } catch {}
    try { brand = JSON.parse(u.brand || '{}') || {}; } catch {}
    const last = String(flags.last_actor || '');
    const n = Math.max(6, Math.min(8, Number(req.query.n) || 8));
    const rec = ha.recommend({ lastId: last.startsWith('h:') ? last : null, country: u.country, brandCountry: brand.country, language: String(req.query.lang || brand.language || ''), pipe: String(req.query.pipe || ''), n });
    // A customer's own actor picked last goes first too.
    let own = null;
    if (last && !last.startsWith('h:')) { const a = actors.list(u.id).mine.find((x) => String(x.id) === last && x.status === 'active'); if (a) own = { ...a, id: String(a.id), own: true, speaks_line: 'Speaks: EN +' + 23 }; }
    res.json({ recommended: own ? [own, ...rec].slice(0, n) : rec, total: ha.ready().length, last_actor: last || null, filters: { markets: ha.MARKETS, styles: ha.STYLES, ages: ha.AGES } });
  });
  r.post('/api/actors', async (req, res) => {
    const u = auth.requireUser(req);
    const b = await parseJson(req);
    res.json({ actor: actors.saveGenerated(u, b) });
  });
  r.post('/api/actors/upload', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('actorup:' + u.id, 6, 6e4);
    const b = await parseJson(req);
    res.json({ actor: actors.saveUpload(u, b, req.ip) });
  });
  r.post('/api/actors/check', async (req, res) => {
    auth.requireUser(req);
    const b = await parseJson(req);
    const why = actors.realPersonReason(b.text);
    res.json({ ok: !why, error: why || null });
  });
  r.put('/api/actors/:id', async (req, res) => {
    const u = auth.requireUser(req);
    res.json({ actor: actors.rename(u, req.params.id, await parseJson(req)) });
  });
  r.del('/api/actors/:id', (req, res) => {
    const u = auth.requireUser(req);
    actors.remove(u, req.params.id);
    res.json({ ok: true });
  });
  r.get('/api/admin/actors', (req, res) => {
    auth.requireStaff(req, 'users.view');
    res.json({ actors: actors.pending() });
  });
  r.post('/api/admin/actors/:id/review', async (req, res) => {
    const s = auth.requireStaff(req, 'users.edit');
    const b = await parseJson(req);
    const a = actors.review(s, req.params.id, { approve: !!b.approve, note: b.note });
    audit(s, b.approve ? 'actor.approve' : 'actor.reject', req.params.id, { note: b.note || '' });
    res.json({ actor: a });
  });

  // ================= Admin: Profit =================
  r.get('/api/admin/profit', (req, res) => {
    auth.requireStaff(req, 'users.finance');
    res.json(profit.report(req.query));
  });
  r.get('/api/admin/llm-settings', (req, res) => {
    auth.requireStaff(req, 'users.finance');
    res.json({ settings: getSetting('llm'), today_usd: llmbill.spentToday(), cap_reached: llmbill.capReached() });
  });
  r.put('/api/admin/llm-settings', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const cur = getSetting('llm');
    const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
    const next = { ...cur };
    if (b.daily_cap_usd !== undefined) next.daily_cap_usd = n(b.daily_cap_usd, 0, 100000, cur.daily_cap_usd);
    if (b.alert_pct !== undefined) next.alert_pct = n(b.alert_pct, 10, 100, cur.alert_pct);
    if (b.block_free_at_cap !== undefined) next.block_free_at_cap = !!b.block_free_at_cap;
    if (b.chat_edit && typeof b.chat_edit === 'object') {
      const c = { ...cur.chat_edit };
      if (b.chat_edit.credits_per_message !== undefined) c.credits_per_message = Math.round(n(b.chat_edit.credits_per_message, 0, 100, c.credits_per_message));
      if (b.chat_edit.per_minute !== undefined) c.per_minute = Math.round(n(b.chat_edit.per_minute, 0, 120, c.per_minute));
      if (b.chat_edit.per_day !== undefined) c.per_day = Math.round(n(b.chat_edit.per_day, 0, 10000, c.per_day));
      if (b.chat_edit.free_per_day && typeof b.chat_edit.free_per_day === 'object') { c.free_per_day = { ...c.free_per_day }; for (const [k, v] of Object.entries(b.chat_edit.free_per_day)) if (/^[a-z0-9_]{1,20}$/.test(k)) c.free_per_day[k] = Math.round(n(v, 0, 10000, 0)); }
      next.chat_edit = c;
    }
    if (b.prices_usd_per_mtok && typeof b.prices_usd_per_mtok === 'object') {
      const p = { ...cur.prices_usd_per_mtok };
      for (const [k, v] of Object.entries(b.prices_usd_per_mtok)) if (/^[\w.-]{1,60}$/.test(k) && v && typeof v === 'object') p[k] = { in: n(v.in, 0, 1000, 0), out: n(v.out, 0, 1000, 0) };
      next.prices_usd_per_mtok = p;
    }
    setSetting('llm', next);
    audit(s, 'llm.settings', 'llm', b);
    res.json({ settings: getSetting('llm') });
  });
  // Real-cost watchdog: drift report, paused types, owner override.
  r.get('/api/admin/watchdog', (req, res) => {
    auth.requireStaff(req, 'users.finance');
    res.json(require('../watchdog').view());
  });
  r.post('/api/admin/watchdog/run', (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const out = require('../watchdog').run();
    audit(s, 'watchdog.run', 'watchdog', { raised: (out.drift && out.drift.raised.length) || 0, paused: (out.paused || []).length });
    res.json(out);
  });
  r.post('/api/admin/watchdog/resume', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    if (!require('../videotypes').byId(String(b.type || ''))) fail(400, 'Unknown video type.');
    res.json({ type: b.type, state: require('../watchdog').resume(String(b.type), s) });
  });
  // ---------- Naira rate safety (server/fx.js), shown on Admin → Profit ----------
  r.get('/api/admin/fx', (req, res) => {
    auth.requireStaff(req, 'users.finance');
    const fx = require('../fx'), payments = require('../payments');
    const methods = all("SELECT id FROM payment_methods WHERE adapter = 'bachs'").map((x) => payments.byId(x.id)).map((m) => ({ id: m.id, name: m.name, rate: fx.rate(m), buffer_pct: fx.bufferPct(m), effective: fx.explain(m), auto: fx.autoOn(m), source_set: !!fx.source(m).url, paused: m.config.fx_paused || null, pending_lower: m.config.fx_pending_lower || null, feed_rate: m.config.fx_feed_rate || null, checked_at: m.config.fx_checked_at || null, error: m.config.fx_last_error || null }));
    res.json({ report: fx.report({ days: Number(req.query.days) || 30 }), methods });
  });
  r.post('/api/admin/fx/check', async (req, res) => {
    auth.requireStaff(req, 'settings.manage');
    res.json({ results: await require('../fx').check() });
  });
  r.post('/api/admin/fx/approve', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const to = require('../fx').approveLower(Number(b.method_id), s);
    if (!to) fail(409, 'There is no lower rate waiting for approval.');
    res.json({ rate: to });
  });
  // ---------- House actors (Admin → House actors) ----------
  r.get('/api/admin/house-actors', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    const ha = require('../houseactors');
    res.json({ actors: ha.all().map((a) => ({ ...a, ...ha.card(a), id: a.id })), missing: ha.missing(), estimate: ha.estimate(), status: ha.status(), markets: ha.MARKETS, styles: ha.STYLES, ages: ha.AGES });
  });
  r.put('/api/admin/house-actors/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const ha = require('../houseactors');
    const a = ha.byId(req.params.id);
    if (!a) fail(404, 'No such actor.');
    const b = await parseJson(req);
    const patch = {};
    if (b.featured !== undefined) patch.featured = b.featured === null || b.featured === '' || Number(b.featured) <= 0 ? null : Math.min(99, Math.round(Number(b.featured)));
    if (b.order !== undefined) patch.order = Math.max(0, Math.min(9999, Math.round(Number(b.order) || 0)));
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 30); if (!n) fail(400, 'Give the actor a name.'); const why = require('../actors').realPersonReason(n); if (why) fail(400, why); patch.name = n; }
    if (b.voice_id !== undefined) { const v = String(b.voice_id).trim(); if (v && !/^[A-Za-z0-9]{10,40}$/.test(v)) fail(400, 'That does not look like an ElevenLabs voice ID.'); patch.voice_id = v; }
    if (b.voice_label !== undefined) patch.voice_label = String(b.voice_label).slice(0, 40);
    for (const [k, list] of [['market', ha.MARKETS], ['style', ha.STYLES]]) if (b[k] !== undefined) { if (!list[b[k]]) fail(400, 'Unknown ' + k + '.'); patch[k] = b[k]; }
    if (b.age !== undefined) { if (!ha.AGES.includes(b.age)) fail(400, 'Unknown age range.'); patch.age = b.age; }
    if (b.gender !== undefined) patch.gender = b.gender === 'm' ? 'm' : 'f';
    ha.savePresenter(a.id, patch);
    audit(s, 'house_actor.update', 'presenter:' + a.id, patch);
    res.json({ actor: ha.byId(a.id) });
  });
  // Cost first: without confirm:true this only returns the estimate.
  r.post('/api/admin/house-actors/generate', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const ha = require('../houseactors');
    const b = await parseJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    const est = ha.estimate(ids);
    if (!b.confirm) return res.json({ estimate: est, confirm_needed: true });
    let out;
    try { out = ha.generate(ids); } catch (e) { if (e.status === 409) fail(409, e.message, { missing_keys: e.missing_keys, estimate: est }); throw e; }
    audit(s, 'house_actor.generate', 'presenters', { ids: ids.length ? ids : 'all missing', usd: est.usd });
    res.json({ ...out, estimate: est });
  });
  r.post('/api/admin/alerts/:id/seen', (req, res) => {
    auth.requireStaff(req, 'dashboard.view');
    run('UPDATE admin_alerts SET seen_at = ? WHERE id = ? AND seen_at IS NULL', new Date().toISOString(), Number(req.params.id) || 0);
    res.json({ ok: true });
  });
};
