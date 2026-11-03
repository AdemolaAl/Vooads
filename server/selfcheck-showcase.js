// Self-check group "showcase": the owner-only "Make showcase pack" (Vooads' own pipeline on the house account, cost shown
// first, explicit confirmation, no customer credits) and the website picks served at /api/public/showcase.
const assert = require('node:assert');

module.exports = async function showcaseChecks({ call, step, wait }) {
  const { get, run } = require('./db');
  const { sha256, id } = require('./lib/util');
  const providers = require('./providers');
  const sessionFor = (email, roleName) => {
    const role = get('SELECT id FROM roles WHERE name = ?', roleName).id;
    run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES(?, ?, ?, 'active')", email, email.split('@')[0], role);
    const sid = id(32);
    run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get('SELECT id FROM staff WHERE email = ?', email).id, new Date(Date.now() + 864e5).toISOString());
    return 'va_a=' + sid;
  };
  const OWN = sessionFor('showowner@example.com', 'Owner');
  const MGR = sessionFor('showmanager@example.com', 'Manager');
  const O = (m, u, b) => call('showown', m, u, b, { Cookie: OWN });

  await step('Showcase: owner-only; the estimate lists every preset with credits and real provider cost', async () => {
    assert.equal((await call('showmgr', 'GET', '/api/admin/showcase', null, { Cookie: MGR })).status, 403);
    const r = await O('GET', '/api/admin/showcase');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ids = r.data.estimate.presets.map((p) => p.id);
    for (const k of ['ugc_skincare', 'cafe_promo', 'street_interview', 'fast_cut_product', 'app_ad', 'podcast_clip', 'real_estate']) assert.ok(ids.includes(k), k);
    assert.ok(r.data.estimate.presets.every((p) => p.error || (p.credits > 0 && p.provider_cost_usd > 0)), JSON.stringify(r.data.estimate.presets));
    assert.ok(r.data.estimate.total_usd > 0);
    assert.equal((await call('x', 'GET', '/api/public/showcase')).data.items.length, 0, 'empty until picked');
  });

  await step('Showcase: needs a confirmation and real AI keys (demo samples never become "Made with Vooads")', async () => {
    assert.equal((await O('POST', '/api/admin/showcase/pack', {})).status, 400);
    const r = await O('POST', '/api/admin/showcase/pack', { confirm: true });
    assert.equal(r.status, 400); assert.match(r.data.error, /keys/);
  });

  await step('Showcase: the pack runs through the real job pipeline on the house account; picks go on the site', async () => {
    const was = providers.isDemo;
    providers.isDemo = () => false; // stands in for "keys are set": the jobs still run on the demo adapter here
    let out;
    try { out = await O('POST', '/api/admin/showcase/pack', { confirm: true, only: ['cafe_promo', 'real_estate'] }); }
    finally { providers.isDemo = was; }
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(out.data.made.length, 2, JSON.stringify(out.data.errors));
    const house = get('SELECT * FROM users WHERE email = ?', require('./showcase').HOUSE_EMAIL);
    assert.equal(house.topup_credits, 0, 'house account keeps no spare credits');
    for (const m of out.data.made) {
      for (let i = 0; i < 120; i++) { const j = get('SELECT status FROM jobs WHERE id = ?', m.job_id); if (['done', 'failed'].includes(j.status)) break; await wait(250); }
      assert.equal(get('SELECT status FROM jobs WHERE id = ?', m.job_id).status, 'done');
    }
    const ids = out.data.made.map((m) => m.job_id);
    // Demo outputs are refused for the website; with real keys the jobs are not demo. Stand in for that here.
    assert.equal((await O('PUT', '/api/admin/showcase/selected', { ids })).status, 400, 'demo refused');
    for (const i of ids) run('UPDATE jobs SET demo = 0 WHERE id = ?', i);
    assert.equal((await O('PUT', '/api/admin/showcase/selected', { ids: [999999] })).data.selected.length, 0, 'unknown ids are dropped');
    const sel = await O('PUT', '/api/admin/showcase/selected', { ids });
    assert.equal(sel.status, 200, JSON.stringify(sel.data));
    const pub = (await call('x', 'GET', '/api/public/showcase')).data.items;
    assert.equal(pub.length, 2); assert.ok(pub.every((x) => x.made_with_vooads === true && x.url));
    // The house account cannot be logged in to.
    assert.equal((await call('x', 'POST', '/api/auth/code', { email: house.email })).status, 400);
    await O('PUT', '/api/admin/showcase/selected', { ids: [] });
  });
};
