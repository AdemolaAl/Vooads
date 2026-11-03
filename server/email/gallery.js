// Offline preview gallery of every Vooads email, rendered with sample data through the real templates and layout.
//   node server/email/gallery.js [outDir]        (default: ../../../vooads-emails-demo next to the repo)
// The folder is self-contained: index.html, one HTML file per email, and img/ with the GIFs, the logo and the font.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', '..', '..', 'vooads-emails-demo'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-gallery-'));
process.env.APP_URL = process.env.APP_URL || 'https://vooads.com';
process.env.NODE_ENV = 'development';

const EMAILS = [
  ['welcome', 'Welcome', 'Film strip', 'Sign-up. Four creators on loops, then “Make your first ad”.'],
  ['verify_email', 'Confirm email', 'Phone frame', 'First code for a new address.'],
  ['login_code', 'Sign-in code', 'Phone frame', 'Every later sign-in.'],
  ['password_reset', 'Password reset', 'Phone frame', 'Account recovery link (template ready; Vooads signs in with codes today).'],
  ['video_ready', 'Video ready', 'Hero loop', 'Made from the customer’s own video: loop, play mark, “Edit by chat”.'],
  ['long_video_ready', 'Long video ready', 'Hero loop', 'Built-in hero, used when a preview cannot be made.'],
  ['video_attention', 'Needs attention', 'Hero loop', 'One part failed: the three choices.'],
  ['job_failed', 'Job failed, refunded', 'Split card', 'Credits back, with the reason and a Try again.'],
  ['payment_receipt', 'Receipt: plan', 'Split card', 'Total charged, once. No fee line.'],
  ['topup_receipt', 'Receipt: credits', 'Split card', 'Total charged, once. No fee line.'],
  ['credits_added', 'Credits added', 'Split card', 'Staff or support grants.'],
  ['paid_credits_low', 'Low credits', 'Split card', 'Below 15% of plan credits, with “Buy credits”.'],
  ['trial_credits_low', 'Low trial credits', 'Split card', 'Below 20% of the free trial.'],
  ['plan_renews_soon', 'Plan renews soon', 'Phone frame', '3 days before an auto-renewal.'],
  ['card_renews_soon', 'Card renews soon', 'Phone frame', '3 days before a card auto-renewal (7 days too for yearly), with the exact amount.'],
  ['payment_failed', 'Card payment failed', 'Phone frame', 'A card renewal failed: calm notice, plan kept while it is retried.'],
  ['renewal_reminder', 'Plan ends soon', 'Phone frame', '3 days before a plan without auto-renew ends.'],
  ['plan_renewed', 'Plan renewed', 'Phone frame', 'Renewal payment went through.'],
  ['plan_upgraded', 'Plan upgraded', 'Phone frame', 'Moved to a bigger plan.'],
  ['plan_expired', 'Plan expired', 'Phone frame', 'Plan ended; videos and top-ups kept.'],
  ['referral_earned', 'Referral reward', 'Split card', 'Commission on a referred payment.'],
  ['actor_approved', 'Face actor approved', 'Avatar + bubble', 'Own-face consent approved.'],
  ['actor_declined', 'Face actor declined', 'Avatar + bubble', 'Own-face consent declined, with the reason.'],
  ['ticket_reply', 'Support reply', 'Avatar + bubble', 'A reply on a support ticket.'],
  ['weekly_digest', 'Weekly digest', 'Film strip', 'Videos made and credits left (opt-out).'],
];

(async () => {
  const log = console.log; console.log = () => {};
  require('../seed').seed();
  require('../support'); // registers the ticket email templates
  const email = require('./index');
  const { sampleVars } = require('./samples');
  const preview = require('./preview');
  console.log = log;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const IMG = path.join(ROOT, 'public', 'assets', 'img', 'email');
  for (const f of fs.readdirSync(IMG)) if (/\.(gif|png)$/.test(f)) fs.copyFileSync(path.join(IMG, f), path.join(OUT, 'img', f));
  fs.copyFileSync(path.join(ROOT, 'public', 'assets', 'fonts', 'geist-latin.woff2'), path.join(OUT, 'img', 'geist-latin.woff2'));

  // "Video ready" uses a preview made from a real Vooads video, exactly as a finished job would.
  let jobPreview = {};
  const clip = [path.join(ROOT, '..', '..', 'new-samples', 'sample-skincare.mp4'), path.join(ROOT, 'public', 'samples', 'sample-skincare.mp4')].find((p) => fs.existsSync(p));
  if (clip) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-gallery-pv-'));
    try {
      const f = await preview.makeFiles(clip, dir, 12);
      if (f.gif) { fs.copyFileSync(f.gif, path.join(OUT, 'img', 'job-preview.gif')); jobPreview.preview_gif = 'img/job-preview.gif'; }
      if (f.jpg) { fs.copyFileSync(f.jpg, path.join(OUT, 'img', 'job-thumb.jpg')); jobPreview.thumb_url = 'img/job-thumb.jpg'; }
    } catch (e) { log('preview skipped:', e.message); }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const offline = (html) => html
    .replace(/<!--\[if !mso\]><!--><link href="https:\/\/fonts\.googleapis\.com[^>]*><!--<!\[endif\]-->/, "<style>@font-face{font-family:'Geist';src:url(img/geist-latin.woff2) format('woff2');font-weight:100 900;font-display:swap}</style>");
  const cards = [];
  let total = 0;
  for (const [id, title, style, note] of EMAILS) {
    const vars = { ...sampleVars(process.env.APP_URL, id), ...(id === 'video_ready' ? { ...jobPreview, video_title: 'Lumen Serum: morning routine hook', video_meta: '0:15 · 9:16 · 1080p · captions on' } : {}) };
    const msg = email.build(id, vars, { id: 1, name: 'Alex' }, { assetBase: 'img' });
    const html = offline(msg.html);
    if (!/^<!doctype html>/i.test(html)) throw new Error(id + ' has no doctype');
    fs.writeFileSync(path.join(OUT, id + '.html'), html);
    const imgs = [...new Set([...html.matchAll(/src="(img\/[^"]+)"/g)].map((m) => m[1]))];
    const bytes = Buffer.byteLength(html) + imgs.reduce((t, f) => t + fs.statSync(path.join(OUT, f)).size, 0);
    if (bytes > 1024 * 1024) throw new Error(`${id} weighs ${Math.round(bytes / 1024)} KB (over 1 MB)`);
    total += bytes;
    cards.push({ id, title, style, note, subject: msg.subject, kb: Math.round(bytes / 1024) });
    log(`${id.padEnd(18)} ${style.padEnd(16)} ${String(Math.round(bytes / 1024)).padStart(4)} KB  ${msg.subject}`);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const styles = [...new Set(cards.map((c) => c.style))];
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vooads emails</title>
<style>
@font-face{font-family:'Geist';src:url(img/geist-latin.woff2) format('woff2');font-weight:100 900;font-display:swap}
:root{--ink:#0A0F1F;--mut:#5D667C;--line:#E5E9F1;--soft:#F5F7FB;--blue:#1E4DFF;--bg:#FFFFFF}
@media (prefers-color-scheme:dark){:root{--ink:#F3F5FA;--mut:#8A93A8;--line:#1E2742;--soft:#0F1424;--bg:#060914}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Geist,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif}
header{background:#0A0F1F;color:#fff;padding:44px 16px 40px}header .in,main{max-width:1180px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.6px}.brand img{width:30px;height:30px;border-radius:9px}
h1{font-size:clamp(28px,4vw,40px);line-height:1.1;letter-spacing:-1.2px;margin:26px 0 10px}header p{color:#A3ADC6;margin:0;max-width:640px}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.pills span{border:1px solid #2A3555;color:#C9D0E0;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600}
main{padding:28px 16px 60px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
a.card{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:var(--bg);transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s,border-color .25s}
a.card:hover{transform:translateY(-3px);border-color:#C9D6FF;box-shadow:0 22px 40px -28px rgba(10,15,31,.45)}
.frame{height:380px;overflow:hidden;background:#EEF1F7;position:relative}.frame iframe{width:640px;height:1040px;border:0;transform:scale(.5);transform-origin:0 0;pointer-events:none;position:absolute;left:0;top:0}
@media (min-width:700px){.frame iframe{left:calc(50% - 160px)}}
.meta{padding:14px 16px 16px}.row{display:flex;justify-content:space-between;gap:10px;align-items:center}
.meta b{font-size:15.5px;letter-spacing:-.2px}.tag{font-size:12px;font-weight:700;color:var(--blue);background:rgba(30,77,255,.08);border-radius:999px;padding:3px 10px;white-space:nowrap}
.sub{color:var(--mut);font-size:13px;margin-top:6px}.note{color:var(--mut);font-size:13px;margin-top:2px}.kb{color:var(--mut);font-size:12px;margin-top:8px}
footer{color:var(--mut);font-size:12.5px;text-align:center;padding:0 16px 40px}
</style></head><body>
<header><div class="in"><div class="brand"><img src="img/mark.png" alt="">Vooads</div>
<h1>Transactional emails</h1><p>${cards.length} emails, rendered with sample data through the live templates. The headers are short loops cut from Vooads videos (AI presenters). Open one to see it full size; dark mode follows your system setting.</p>
<div class="pills">${styles.map((s) => `<span>${esc(s)}</span>`).join('')}</div></div></header>
<main><div class="grid">
${cards.map((c) => `<a class="card" href="${c.id}.html"><div class="frame"><iframe src="${c.id}.html" loading="lazy" title="${esc(c.title)}" tabindex="-1"></iframe></div>
<div class="meta"><div class="row"><b>${esc(c.title)}</b><span class="tag">${esc(c.style)}</span></div><div class="sub">${esc(c.subject)}</div><div class="note">${esc(c.note)}</div><div class="kb">${c.kb} KB with images</div></div></a>`).join('\n')}
</div></main>
<footer>Every email stays under 1 MB. Outlook for Windows shows the first frame of each loop, which is always a clean frame.</footer>
</body></html>
`);
  log(`\n${cards.length} emails, ${Math.round(total / 1024)} KB in total → ${OUT}`);
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
