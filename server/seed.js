// First-run setup: roles, AI provider slots, payment method slots, email templates, blog posts.
// Safe to run on every boot; it only adds what is missing.
const fs = require('node:fs');
const path = require('node:path');
const { db, get, all, run, J } = require('./db');
const email = require('./email');
const md = require('./lib/markdown');
const support = require('./support');

const VIEW_ALL = ['dashboard.view', 'users.view', 'payments.view', 'providers.view', 'pricing.view', 'blog.view', 'emails.view', 'staff.view', 'settings.view', 'audit.view', 'tickets.view'];
const TICKET_PERMS = ['tickets.view', 'tickets.reply', 'tickets.assign', 'tickets.manage', 'calls.handle'];

const ROLES = [
  { name: 'Owner', description: 'Full access to everything.', permissions: ['*'], limits: {} },
  { name: 'Viewer', description: 'Can see everything. Cannot change anything.', permissions: VIEW_ALL, limits: {} },
  { name: 'Support', description: 'Helps customers: answers tickets and callbacks, sees accounts, gives small credit refunds.', permissions: ['dashboard.view', 'users.view', 'users.credits', 'payments.view', 'support.reply', 'tickets.view', 'tickets.reply', 'tickets.assign', 'calls.handle'], limits: { max_credit_grant: 500, ticket_scope: 'all' } },
  { name: 'Support (assigned only)', description: 'Answers only the tickets assigned to them. Can give small credit refunds on those tickets.', permissions: ['users.credits', 'tickets.view', 'tickets.reply', 'calls.handle'], limits: { max_credit_grant: 100, ticket_scope: 'assigned' } },
  { name: 'Blog editor', description: 'Writes and publishes blog posts only.', permissions: ['blog.view', 'blog.edit'], limits: {} },
  { name: 'Manager', description: 'Runs the business day to day. Cannot manage staff or API keys.', permissions: [...VIEW_ALL, 'users.edit', 'users.credits', 'users.ban', 'payments.refund', 'pricing.manage', 'blog.edit', 'emails.edit', 'support.reply', ...TICKET_PERMS], limits: { max_credit_grant: 5000, ticket_scope: 'all' } },
];

// Provider slots. They start without keys, so the app runs in demo mode until you add keys in Admin → AI providers.
const PROVIDERS = [
  { name: 'Claude Sonnet (scripts and hooks)', kind: 'text', adapter: 'anthropic', model: 'claude-sonnet-5-5', cost_usd: 0.062, cost_unit: 'per script', is_default: 1, notes: 'Key: console.anthropic.com → API Keys' },
  { name: 'Claude Haiku (backup, cheaper)', kind: 'text', adapter: 'anthropic', model: 'claude-haiku-4-5-20251001', cost_usd: 0.02, cost_unit: 'per script', priority: 200, notes: 'Same key as Sonnet' },
  { name: 'Seedream V4 on fal (images)', kind: 'image', adapter: 'fal', model: 'fal-ai/bytedance/seedream/v4/text-to-image', cost_usd: 0.03, cost_unit: 'per image', is_default: 1, notes: 'Key: fal.ai/dashboard/keys' },
  { name: 'Kling 2.5 Turbo Pro on fal (videos)', kind: 'video', adapter: 'fal', model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', config: { image_model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video' }, cost_usd: 0.07, cost_unit: 'per second', is_default: 1, notes: 'Check the model page on fal.ai for exact input fields.' },
  { name: 'Wan 2.5 on fal (videos, backup)', kind: 'video', adapter: 'fal', model: 'fal-ai/wan-25-preview/text-to-video', config: { image_model: 'fal-ai/wan-25-preview/image-to-video' }, cost_usd: 0.05, cost_unit: 'per second', priority: 200 },
  { name: 'Kling AI Avatar v2 Pro on fal (UGC presenters)', kind: 'ugc', adapter: 'fal', model: 'fal-ai/kling-video/ai-avatar/v2/pro', cost_usd: 0.115, cost_unit: 'per second', is_default: 1, notes: 'Needs a public APP_URL so fal can fetch the voice file. If you switch to Aurora 720p, Fabric 720p or OmniHuman, raise the UGC credit cost (see pricing.md).' },
  { name: 'Sync Lipsync v2 on fal (dubbing)', kind: 'dub', adapter: 'fal', model: 'fal-ai/sync-lipsync/v2', cost_usd: 0.05, cost_unit: 'per second', is_default: 1, notes: 'Lip-syncs an existing video to a new voice track. Key: fal.ai/dashboard/keys' },
  { name: 'Kling AI Avatar v2 Standard on fal (UGC, cheaper backup)', kind: 'ugc', adapter: 'fal', model: 'fal-ai/kling-video/ai-avatar/v2/standard', cost_usd: 0.0562, cost_unit: 'per second', priority: 200 },
  { name: 'ElevenLabs Flash (voices)', kind: 'voice', adapter: 'elevenlabs', model: 'eleven_flash_v2_5', cost_usd: 0.05, cost_unit: 'per 1k characters', is_default: 1, notes: 'Key: elevenlabs.io → Settings → API keys. Switch model to eleven_multilingual_v2 for best quality.' },
];

// v2.1 (SPEC §12): voice tiers, stock footage, music. Added once to existing databases (matched by name).
// Rows that need a key start switched off; adding the key in Admin → AI providers switches them on.
const PROVIDERS_V21 = [
  { name: 'ElevenLabs Multilingual v2 (ultra-realistic voice)', kind: 'voice', adapter: 'elevenlabs', model: 'eleven_multilingual_v2', config: { tier: 'ultra' }, cost_usd: 0.1, cost_unit: 'per 1k characters', enabled: 1, priority: 50, notes: 'Ultra-realistic tier (customers pick "Ultra-realistic voice"). Same ElevenLabs key as Flash. Switch the model to eleven_v3 after a listening test.' },
  { name: 'Pexels (free stock footage)', kind: 'stock', adapter: 'pexels', cost_usd: 0, cost_unit: 'per clip', enabled: 0, is_default: 1, notes: 'Free key: pexels.com/api. Used by Animated ads (Standard).' },
  { name: 'Pixabay (free stock footage, backup)', kind: 'stock', adapter: 'pixabay', cost_usd: 0, cost_unit: 'per clip', enabled: 0, priority: 200, notes: 'Free key: pixabay.com/api/docs' },
  { name: 'ElevenLabs Music', kind: 'music', adapter: 'elevenlabs_music', model: 'music_v1', cost_usd: 0.15, cost_unit: 'per minute', enabled: 0, priority: 150, notes: 'Background music made to fit each ad. Key: elevenlabs.io → Settings → API keys (same as voices). Billed per minute of music.' },
  { name: 'Music library', kind: 'music', adapter: 'library', cost_usd: 0, cost_unit: 'per track', enabled: 1, is_default: 1, notes: 'Plays a random track of the chosen mood from Admin → Music library. Upload MP3s there.' },
];

// v2.2 (SPEC §13): quality levels. One fal.ai key runs all of them (rows without a key use the key of another fal row).
// Prices are fal.ai list prices checked 4 Oct 2026 on each model's page at fal.ai/models. Added once to existing databases
// (matched by name); the two alternatives start switched off.
const FAL_SRC = 'Price: fal.ai list price, checked 4 Oct 2026 (fal.ai/models).';
const PROVIDERS_V22 = [
  { name: 'OmniHuman v1.5 on fal (UGC, Pro realistic)', kind: 'ugc', adapter: 'fal', model: 'fal-ai/bytedance/omnihuman/v1.5', config: { level: 'pro', tag: 'omnihuman-1.5' }, cost_usd: 0.16, cost_unit: 'per second', enabled: 1, priority: 120, notes: 'ByteDance OmniHuman 1.5: lifelike gestures and expressions from a photo and a voice track. $0.16 per second. ' + FAL_SRC },
  { name: 'Google Veo 3.1 on fal (UGC, Ultra cinematic)', kind: 'ugc', adapter: 'fal', model: 'fal-ai/veo3.1/image-to-video', config: { level: 'ultra', tag: 'veo-3.1', input: 'dialogue', clip_durations: [4, 6, 8], duration_suffix: 's', extra: { generate_audio: true, resolution: '1080p' } }, cost_usd: 0.4, cost_unit: 'per second', enabled: 1, priority: 130, notes: 'Veo 3.1 1080p with native dialogue audio: the presenter photo is the reference (first) frame and Veo speaks the script line itself. 8s max per clip, so longer videos are rendered in 8s parts and stitched; presenter consistency comes from the reference image. $0.40 per second (1080p with audio). 4K ($0.60/s) is not offered. ' + FAL_SRC },
  { name: 'Kling 3.0 Pro on fal (video with audio, Pro realistic)', kind: 'video', adapter: 'fal', model: 'fal-ai/kling-video/v3/pro/text-to-video', config: { level: 'pro', tag: 'kling-3.0-pro', image_model: 'fal-ai/kling-video/v3/pro/image-to-video', extra: { generate_audio: true } }, cost_usd: 0.168, cost_unit: 'per second', enabled: 1, priority: 120, notes: 'Kling 3.0 Pro with native audio: $0.168 per second with audio on ($0.112 with it off; priced with audio on). ' + FAL_SRC },
  { name: 'Google Veo 3.1 on fal (video, Ultra cinematic)', kind: 'video', adapter: 'fal', model: 'fal-ai/veo3.1', config: { level: 'ultra', tag: 'veo-3.1', image_model: 'fal-ai/veo3.1/image-to-video', clip_durations: [4, 6, 8], duration_suffix: 's', extra: { generate_audio: true, resolution: '1080p' } }, cost_usd: 0.4, cost_unit: 'per second', enabled: 1, priority: 130, notes: 'Veo 3.1 1080p with audio: $0.40 per second. Clips are 4, 6 or 8 seconds (billed at that length); longer videos are stitched. 4K ($0.60/s) is not offered. ' + FAL_SRC },
  { name: 'Google Veo 3.1 Fast on fal (video, Pro alternative)', kind: 'video', adapter: 'fal', model: 'fal-ai/veo3.1/fast', config: { level: 'pro', tag: 'veo-3.1-fast', image_model: 'fal-ai/veo3.1/fast/image-to-video', clip_durations: [4, 6, 8], duration_suffix: 's', extra: { generate_audio: true, resolution: '1080p' } }, cost_usd: 0.15, cost_unit: 'per second', enabled: 0, priority: 140, notes: 'Optional Pro-level alternative: Veo 3.1 Fast 1080p with audio, $0.15 per second. Switch it on to use it as a Pro fallback, or pick it as the Pro model on Pricing → Video types. ' + FAL_SRC },
  { name: 'Seedance 2.0 1080p on fal (video, Ultra alternative)', kind: 'video', adapter: 'fal', model: 'bytedance/seedance-2.0/text-to-video', config: { level: 'ultra', tag: 'seedance-2.0', image_model: 'bytedance/seedance-2.0/image-to-video' }, cost_usd: 0.682, cost_unit: 'per second', enabled: 0, priority: 150, notes: 'Optional Ultra-level alternative: ByteDance Seedance 2.0 1080p, $0.682 per second. Off by default: switched on, the Ultra level would need about 65 credits per second (the profit guard raises it by itself). ' + FAL_SRC },
];
// v2.3 (SPEC §14): editing tools. Matting and speech-to-text rows start on (they use the shared fal / ElevenLabs keys); the
// fal music alternative and the outside auto-edit preset start off. Added once to existing databases (matched by name).
const PROVIDERS_V23 = [
  { name: 'VEED background removal (fast) on fal', kind: 'matting', adapter: 'fal', model: 'veed/video-background-removal/fast', config: { codec: 'vp9', refine: true, max_fps: 60 }, cost_usd: 0.012, cost_unit: 'per 30 frames', enabled: 1, is_default: 1, notes: 'Cuts the person out of the customer\'s video for "Change background". $0.008 per 30 frames without edge refinement, $0.012 with it (refinement is on). Priced at 60 fps worst case = $0.024 per second; faster footage is re-timed to 60 fps first. Source: fal.ai/models/VEED/video-background-removal/fast, checked 4 Oct 2026. Output: VP9 WebM with alpha (set config codec "h264" for two files: colour + matte).' },
  { name: 'ElevenLabs Scribe (speech-to-text)', kind: 'stt', adapter: 'elevenlabs', model: 'scribe_v1', cost_usd: 0.4, cost_unit: 'per hour', enabled: 1, is_default: 1, notes: 'Word timings for "Auto-edit my video" (cuts and captions). Same ElevenLabs key as voices. Priced at $0.40 per hour of audio to stay on the safe side (third-party pricing guides list Scribe at $0.22/hour in June 2026). Check your ElevenLabs plan and edit the cost if it differs.' },
  { name: 'Whisper on fal (speech-to-text, backup)', kind: 'stt', adapter: 'fal', model: 'fal-ai/whisper', cost_usd: 0.02, cost_unit: 'per minute', enabled: 1, priority: 200, notes: 'Backup for Auto-edit when ElevenLabs is down: word-level chunks (chunk_level "word"). fal bills Whisper per compute second and shows no fixed audio price on the model page, so $0.02 per audio minute is a deliberately high placeholder. fal-ai/wizper is faster but returns sentence timings only. Edit the cost after checking your fal usage.' },
  { name: 'ElevenLabs Music on fal (brand music, alternative)', kind: 'music', adapter: 'fal', model: 'fal-ai/elevenlabs/music', config: { input: 'elevenlabs', round_up_minutes: true }, cost_usd: 0.6, cost_unit: 'per minute (rounded up)', enabled: 0, priority: 160, notes: 'Alternative to the direct ElevenLabs Music API for Brand music and AI background music. $0.60 per output minute, rounded up to the next minute (a 15s track bills a full minute). Off by default: the direct API is cheaper. Uses the shared fal key.' },
  { name: 'Submagic API (outside auto-edit, optional)', kind: 'autoedit', adapter: 'http', model: '', config: { method: 'POST', url: 'https://api.submagic.co/v1/projects', headers: { 'x-api-key': '{{key}}' }, body: '{ "title": "Vooads auto-edit", "language": "en", "videoUrl": "{{video_url}}" }', id_path: 'id', poll_url: 'https://api.submagic.co/v1/projects/{{id}}', done_path: 'status', done_value: 'completed', fail_value: 'failed', result_path: 'downloadUrl', output_path: 'downloadUrl' }, cost_usd: 0.69, cost_unit: 'per video', enabled: 0, priority: 100, notes: 'Optional. When switched on (with a key), "Auto-edit my video" hands the whole edit to Submagic instead of the built-in pipeline. Pricing: Business + API plan $69/month for 100 videos (submagic.co/pricing, June 2026 data) = $0.69 per video. This is a generic Custom API preset, not a tested integration: check Submagic\'s API docs for the current endpoint and fields, then run a test before switching it on.' },
];
// Level and model tag for the rows that existed before quality levels (all standard).
const V22_TAGS = [
  [/ai-avatar\/v2\/pro/, 'kling-avatar-v2-pro'], [/ai-avatar\/v2\/standard/, 'kling-avatar-v2-standard'], [/v2\.5-turbo/, 'kling-2.5-turbo-pro', [5, 10]], [/wan-25/, 'wan-2.5', [5, 10]],
];

const METHODS = [
  { name: 'Card (Stripe)', adapter: 'stripe', countries: ['*'], sort: 10 },
  { name: 'Paystack', adapter: 'paystack', countries: ['NG', 'GH', 'KE', 'ZA', 'CI'], sort: 20, config: { currency: 'NGN', usd_rate: 1550 } },
  { name: 'Flutterwave', adapter: 'flutterwave', countries: ['NG', 'GH', 'KE', 'ZA', 'UG', 'TZ', 'RW', 'CM', 'SN', 'CI'], sort: 30, config: { currency: 'USD', usd_rate: 1 } },
  { name: 'Crypto (USDT, BTC)', adapter: 'nowpayments', countries: ['*'], sort: 40 },
];

const COVERS = ['/samples/creator-3.png', '/samples/creator-5.png', '/samples/creator-4.png', '/samples/buyer-2.png', '/samples/creator-6.png', '/samples/support-agent-2.png'];

function seed() {
  support.migrate(db);
  for (const r of ROLES) {
    if (!get('SELECT 1 FROM roles WHERE name = ?', r.name)) run('INSERT INTO roles(name, description, permissions, limits, system) VALUES(?,?,?,?,1)', r.name, r.description, JSON.stringify(r.permissions), JSON.stringify(r.limits));
  }
  if (!get('SELECT 1 FROM providers LIMIT 1')) {
    for (const p of PROVIDERS) run('INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,1,?,?,?)', p.name, p.kind, p.adapter, p.model, JSON.stringify(p.config || {}), p.cost_usd, p.cost_unit, p.is_default || 0, p.priority || 100, p.notes || '');
  }
  if (!get("SELECT 1 FROM providers WHERE kind = 'dub'")) {
    const p = PROVIDERS.find((x) => x.kind === 'dub');
    run('INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,1,?,?,?)', p.name, p.kind, p.adapter, p.model, '{}', p.cost_usd, p.cost_unit, 1, 100, p.notes);
  }
  for (const p of PROVIDERS_V21) {
    if (get('SELECT 1 FROM providers WHERE name = ?', p.name)) continue;
    run('INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)', p.name, p.kind, p.adapter, p.model || '', JSON.stringify(p.config || {}), p.cost_usd, p.cost_unit, p.enabled, p.is_default || 0, p.priority || 100, p.notes || '');
  }
  for (const p of PROVIDERS_V22) {
    if (get('SELECT 1 FROM providers WHERE name = ?', p.name)) continue;
    run('INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)', p.name, p.kind, p.adapter, p.model || '', JSON.stringify(p.config || {}), p.cost_usd, p.cost_unit, p.enabled, p.is_default || 0, p.priority || 100, p.notes || '');
  }
  for (const p of PROVIDERS_V23) {
    if (get('SELECT 1 FROM providers WHERE name = ?', p.name)) continue;
    run('INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)', p.name, p.kind, p.adapter, p.model || '', JSON.stringify(p.config || {}), p.cost_usd, p.cost_unit, p.enabled, p.is_default || 0, p.priority || 100, p.notes || '');
  }
  // Video and UGC rows without a level are the standard level; known models get their tag (and fixed clip lengths) once.
  if (!support.flag('levels_v22')) {
    for (const v of all("SELECT id, model, config FROM providers WHERE kind IN ('ugc', 'video')")) {
      const c = J(v.config, {});
      if (c.level && c.tag) continue;
      const hit = V22_TAGS.find(([re]) => re.test(String(v.model || '')));
      const next = { ...c, level: c.level || 'standard' };
      if (hit && !next.tag) next.tag = hit[1];
      if (hit && hit[2] && !next.clip_durations) next.clip_durations = hit[2];
      run('UPDATE providers SET config = ? WHERE id = ?', JSON.stringify(next), v.id);
    }
    support.setFlag('levels_v22');
  }
  // Voice rows without a tier are the standard tier.
  for (const v of all("SELECT id, config FROM providers WHERE kind = 'voice'")) {
    const c = J(v.config, {});
    if (!c.tier) run('UPDATE providers SET config = ? WHERE id = ?', JSON.stringify({ ...c, tier: 'standard' }), v.id);
  }
  if (!get('SELECT 1 FROM payment_methods LIMIT 1')) {
    for (const m of METHODS) run('INSERT INTO payment_methods(name, adapter, countries, enabled, sort, config) VALUES(?,?,?,0,?,?)', m.name, m.adapter, JSON.stringify(m.countries), m.sort, JSON.stringify(m.config || {}));
  }
  upgradeRolesForTickets();
  if (!support.flag('gatevoo_method_v1')) {
    if (!get("SELECT 1 FROM payment_methods WHERE adapter = 'gatevoo'")) run("INSERT INTO payment_methods(name, adapter, countries, enabled, sort, config) VALUES('Crypto (Gatevoo: USDT, BTC)', 'gatevoo', '[\"*\"]', 0, 35, ?)", JSON.stringify({ base_url: 'https://gatevoo.com/api/v1' }));
    support.setFlag('gatevoo_method_v1');
  }
  // Bachs (naira and African payments), switched off until the owner adds the keys. Countries: the African countries
  // Bachs serves; customers whose country is unknown also see it (payments/bachs.js).
  if (!support.flag('bachs_method_v1')) {
    if (!get("SELECT 1 FROM payment_methods WHERE adapter = 'bachs'")) run("INSERT INTO payment_methods(name, adapter, countries, enabled, sort, config) VALUES('Bachs (naira, cards, bank, mobile money)', 'bachs', ?, 0, 15, ?)", JSON.stringify(require('./payments/bachs').COUNTRIES), JSON.stringify({ ngn_rate: 0 }));
    support.setFlag('bachs_method_v1');
  }
  email.seedTemplates();
  if (!get('SELECT 1 FROM posts LIMIT 1')) {
    const dir = path.join(__dirname, '..', 'content', 'blog');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    files.forEach((f, i) => {
      const { meta, body } = md.frontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const date = new Date(Date.now() - (files.length - i) * 3 * 864e5).toISOString();
      run("INSERT OR IGNORE INTO posts(slug, title, excerpt, body_md, cover_url, tags, author, status, published_at, read_minutes) VALUES(?,?,?,?,?,?,?,'published',?,?)",
        meta.slug || f.replace(/\.md$/, ''), meta.title || f, meta.excerpt || '', body.replace(/^#\s+.*\n/, ''), COVERS[i % COVERS.length], JSON.stringify([].concat(meta.tags || [])), meta.author || 'Vooads Team', date, Number(meta.read_minutes) || Math.round(body.split(/\s+/).length / 220));
    });
  }
}

// Once per database: give existing built-in roles the ticket permissions, and any role that could reply to chats access to tickets.
function upgradeRolesForTickets() {
  if (support.flag('roles_tickets_v1')) return;
  for (const role of all('SELECT * FROM roles')) {
    const perms = J(role.permissions, []), limits = J(role.limits, {});
    if (perms.includes('*')) continue;
    const def = ROLES.find((r) => r.name === role.name);
    const add = def ? def.permissions.filter((p) => TICKET_PERMS.includes(p)) : [];
    if (perms.includes('support.reply')) add.push('tickets.view', 'tickets.reply');
    const next = [...new Set([...perms, ...add])];
    if (def?.limits?.ticket_scope && !limits.ticket_scope) limits.ticket_scope = def.limits.ticket_scope;
    run('UPDATE roles SET permissions = ?, limits = ? WHERE id = ?', JSON.stringify(next), JSON.stringify(limits), role.id);
  }
  support.setFlag('roles_tickets_v1');
}

module.exports = { seed, ROLES, PROVIDERS_V23 };
