// How each Vooads email looks: the animated header (one of five styles) and the structured blocks under the text.
//
//   phone   a phone mock-up with a creator talking inside, chips floating around it     (sign-in, plans)
//   film    a strip of four small creators, each on its own loop                       (welcome, weekly digest)
//   hero    one big loop of the customer's own video (or ours), title on a navy fade   (video ready, needs attention)
//   split   a creator card beside a clean stat card                                    (receipts, credits, refunds, referral)
//   avatar  a small round moving face beside a message bubble                          (support reply, face approval)
//   plain   the logo bar only                                                          (policy, account and staff emails)
//
// Every GIF is cut from our own Vooads videos (AI presenters), loops seamlessly, starts on a clean frame for Outlook and
// sits on the studio-navy panel, so it looks the same in light and dark mode. The GIFs are built by
// server/email/art/build-gifs.py into public/assets/img/email/ and each is under about 350 KB.
const { esc } = require('../lib/util');

const C = {
  navy: '#0A0F1F', navy2: '#121A33', glass: '#151C33', line: '#E5E9F1', ink: '#0A0F1F', body: '#2C3448', mut: '#5D667C',
  soft: '#F5F7FB', blue: '#1E4DFF', blueText: '#1638D8', blueSoft: '#8FA6FF', onNavy: '#E8ECF7', onNavyMut: '#A3ADC6', amber: '#FFD60A',
};
const FONT = "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The GIF set. alt text describes what the picture shows, for screen readers and blocked images.
const ART = {
  'phone-ready': { w: 560, h: 300, alt: 'A creator talking in a phone frame, with chips: Ready, captions, 1080p, Made with Vooads' },
  'phone-code': { w: 560, h: 300, alt: 'A creator waving in a phone frame, with chips: Sign-in code, valid 10 minutes, only for you' },
  'phone-plan': { w: 560, h: 300, alt: 'A founder talking in a phone frame, with chips: Plan active, monthly credits, 1080p, captions' },
  'phone-pause': { w: 560, h: 300, alt: 'A creator smiling in a phone frame, with chips: Plan ended, videos kept, restart anytime' },
  'film-welcome': { w: 560, h: 222, alt: 'Four Vooads creators talking to camera: podcast, cafe, skincare and founder' },
  'film-digest': { w: 560, h: 222, alt: 'Four Vooads creators talking to camera: cafe, SaaS, street interview and podcast' },
  'hero-ready': { w: 560, h: 280, alt: 'A creator smiling to camera with a Ready chip and a play button' },
  'hero-attention': { w: 560, h: 280, alt: 'A creator counting three options on her fingers' },
  'split-receipt': { w: 220, h: 264, alt: 'A barista smiling, with a Paid chip' },
  'split-credits': { w: 220, h: 264, alt: 'A creator taking a sip of a shake, with a Credits added chip' },
  'split-low': { w: 220, h: 264, alt: 'A founder talking to camera, with a Running low chip' },
  'split-refund': { w: 220, h: 264, alt: 'A podcast host talking, with a Credits back chip' },
  'split-referral': { w: 220, h: 264, alt: 'A creator holding a serum bottle, with a Referral reward chip' },
  'avatar-support': { w: 128, h: 128, show: 64, alt: 'Vooads support' },
  'avatar-review': { w: 128, h: 128, show: 64, alt: 'Vooads review team' },
};

const t = (s, style) => `<p style="margin:0;font-family:${FONT};${style}">${s}</p>`;
function img(src, name, { href, alt, radius = 14, w, h } = {}) {
  const a = ART[name] || {};
  const W = w || a.show || a.w, H = h || (a.show ? a.show : a.h);
  const tag = `<img src="${esc(src)}" width="${W}" height="${H}" alt="${esc(alt || a.alt || '')}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius}px;background-color:${C.navy};color:${C.onNavyMut};font-family:${FONT};font-size:13px;">`;
  return href ? `<a href="${esc(href)}" target="_blank" style="text-decoration:none;display:block;">${tag}</a>` : tag;
}
const full = (inner) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-top:16px;font-size:0;line-height:0;">${inner}</td></tr></table>`;

// ---------- header styles ----------
const art = {
  plain: () => '',
  phone: (o, A) => full(img(A(o.gif), o.gif)),
  film: (o, A) => full(img(A(o.gif), o.gif)),
  hero(o, A, v) {
    // The customer's own video: a short preview loop made from it (first frame = its thumbnail), else the thumbnail,
    // else our hero loop. The title and length sit under it on the navy panel.
    const src = v.preview_gif || v.thumb_url || A(o.gif);
    const alt = v.preview_gif || v.thumb_url ? `Preview of your video: ${v.video_title || 'your new video'}` : ART[o.gif].alt;
    const title = o.title ? o.title(v) : '';
    const meta = o.meta ? o.meta(v) : '';
    return full(img(src, o.gif, { href: o.href ? o.href(v) : null, alt }))
      + (title ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:14px 2px 0;">${t(esc(title), `font-size:19px;line-height:25px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;`)}${meta ? t(esc(meta), `padding-top:4px;font-size:13px;line-height:18px;color:${C.onNavyMut};`) : ''}</td></tr></table>` : '');
  },
  split(o, A, v) {
    const s = o.stat(v);
    const meter = s.meter !== undefined ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td bgcolor="#26304F" style="background-color:#26304F;border-radius:6px;height:6px;font-size:0;line-height:0;"><table role="presentation" width="${Math.max(4, Math.min(100, Math.round(s.meter)))}%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.amber}" style="background-color:${C.amber};border-radius:6px;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>` : '';
    const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.navy2}" style="background-color:${C.navy2};border:1px solid #233056;border-radius:18px;padding:22px 22px 22px 22px;">
${t(esc(s.label), `font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.blueSoft};`)}
${t(esc(s.big), `padding-top:8px;font-size:36px;line-height:42px;font-weight:800;letter-spacing:-1px;color:#FFFFFF;`)}
${s.sub ? t(esc(s.sub), `padding-top:6px;font-size:14px;line-height:20px;color:${C.onNavyMut};`) : ''}${meter}
${s.foot ? t(esc(s.foot), `padding-top:14px;font-size:12px;line-height:17px;color:${C.onNavyMut};`) : ''}
</td></tr></table>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>
<td class="va-stack" width="220" valign="middle" style="width:220px;font-size:0;line-height:0;">${img(A(o.gif), o.gif, { radius: 18 })}</td>
<td class="va-stack va-stack-gap" valign="middle" style="padding-left:16px;">${card}</td></tr></table>`;
  },
  avatar(o, A, v) {
    const b = o.bubble(v);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
<td width="64" valign="top" style="width:64px;font-size:0;line-height:0;padding-top:2px;">${img(A(o.gif), o.gif, { radius: 32 })}</td>
<td valign="top" style="padding-left:14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.glass}" style="background-color:${C.glass};border:1px solid #26304F;border-radius:4px 18px 18px 18px;padding:14px 18px 16px;">
${t(esc(b.who), `font-size:13px;line-height:18px;font-weight:700;color:${C.blueSoft};`)}
${t(b.html, `padding-top:6px;font-size:15px;line-height:23px;color:${C.onNavy};`)}
${b.chip ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr><td bgcolor="${b.chipColor || C.blue}" style="background-color:${b.chipColor || C.blue};border-radius:999px;padding:5px 12px;">${t(esc(b.chip), `font-size:12px;line-height:16px;font-weight:700;color:${b.chipInk || '#FFFFFF'};`)}</td></tr></table>` : ''}
</td></tr></table></td></tr></table>`;
  },
};

// ---------- blocks under the text ----------
const P = `font-family:${FONT};`;
function button(label, url, { secondary = false } = {}) {
  if (!url) return '';
  const bg = secondary ? '#FFFFFF' : C.blue, ink = secondary ? C.ink : '#FFFFFF';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="va-btn-wrap" style="display:inline-table;margin:0 8px 10px 0;"><tr><td class="${secondary ? 'va-btn2' : 'va-btn'}" bgcolor="${bg}" style="background-color:${bg};border-radius:12px;${secondary ? `border:1.5px solid #D6DCE8;` : ''}mso-padding-alt:14px 24px;">
<a href="${esc(url)}" target="_blank" class="${secondary ? 'va-btn2-a' : 'va-btn-a'}" style="display:inline-block;padding:14px 24px;${P}font-size:15px;line-height:20px;font-weight:700;color:${ink};text-decoration:none;border-radius:12px;">${esc(label)}${secondary ? '' : ' &rarr;'}</a></td></tr></table>`;
}
const rows = (list, total) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="va-line" style="margin:6px 0 22px;border-top:1px solid ${C.line};">
${list.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => `<tr><td class="va-m va-line" style="padding:12px 0;border-bottom:1px solid ${C.line};${P}font-size:14px;line-height:20px;color:${C.mut};">${esc(k)}</td><td class="va-t va-line" align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${C.line};${P}font-size:14px;line-height:20px;font-weight:600;color:${C.ink};">${esc(v)}</td></tr>`).join('')}
${total ? `<tr><td class="va-t" style="padding:16px 0 4px;${P}font-size:15px;line-height:20px;font-weight:700;color:${C.ink};">${esc(total[0])}</td><td class="va-t" align="right" style="padding:16px 0 4px 16px;${P}font-size:22px;line-height:26px;font-weight:800;letter-spacing:-0.4px;color:${C.ink};">${esc(total[1])}</td></tr>` : ''}
</table>`;

const blocks = {
  code: (v) => v.code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;"><tr><td class="va-soft" align="center" bgcolor="${C.soft}" style="background-color:${C.soft};border:1px solid ${C.line};border-radius:16px;padding:22px 12px;">
${t(esc(String(v.code).split('').join(' ')), `font-size:34px;line-height:40px;font-weight:800;letter-spacing:6px;color:${C.ink};font-variant-numeric:tabular-nums;" class="va-t`)}
${t('Expires in 10 minutes · works once', `padding-top:8px;font-size:13px;line-height:18px;color:${C.mut};" class="va-m`)}</td></tr></table>` : '',
  // Receipts show what the customer paid, once, as the total. There is never a separate fee line.
  receipt: (v) => rows([
    ['Item', v.plan ? `${v.plan} plan${v.period ? ` (${v.period})` : ''}` : `${v.credits || ''} credits`],
    ['Credits added', v.credits], ['Reference', v.code], ['Date', v.date],
  ], ['Total charged', v.amount]),
  video: (v, ctx) => `<div style="margin:6px 0 16px;">${button(ctx.ctaLabel || 'Watch your video', ctx.ctaUrl)}${button('Edit by chat', v.edit_url || ctx.ctaUrl, { secondary: true })}</div>`,
  choices: (v) => {
    const base = v.job_url || `${v.app_url}/app#library`;
    const opt = (title, sub, act) => `<tr><td style="padding:0 0 10px;"><a href="${esc(base + (base.includes('?') ? '&' : '?') + 'choice=' + act)}" target="_blank" style="text-decoration:none;display:block;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="va-soft" bgcolor="${C.soft}" style="background-color:${C.soft};border:1px solid ${C.line};border-right:0;border-radius:14px 0 0 14px;padding:14px 18px;">
${t(esc(title), `font-size:15px;line-height:21px;font-weight:700;color:${C.ink};" class="va-t`)}${t(esc(sub), `padding-top:2px;font-size:13.5px;line-height:19px;color:${C.mut};" class="va-m`)}</td><td class="va-soft" bgcolor="${C.soft}" width="44" align="center" style="background-color:${C.soft};border:1px solid ${C.line};border-left:0;border-radius:0 14px 14px 0;${P}font-size:18px;color:${C.blueText};">&rarr;</td></tr></table></a></td></tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
${opt('Try that part again', 'Uses the same script and voice. Finished parts are reused.', 'retry')}
${opt('Use a still shot for it', 'Free. A slow zoom on a frame, over that part’s voice.', 'still')}
${opt('Cancel and refund', 'Every credit for this video goes back to your balance.', 'cancel')}</table>`;
  },
  digest: (v) => {
    const cell = (big, label) => `<td class="va-soft" width="33%" align="center" bgcolor="${C.soft}" style="background-color:${C.soft};border:1px solid ${C.line};border-radius:14px;padding:16px 6px;">${t(esc(big), `font-size:26px;line-height:30px;font-weight:800;letter-spacing:-0.6px;color:${C.ink};" class="va-t`)}${t(esc(label), `padding-top:4px;font-size:12.5px;line-height:17px;color:${C.mut};" class="va-m`)}</td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;"><tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:10px 0;margin:0 -10px;width:calc(100% + 20px);"><tr>${cell(v.videos ?? '0', 'videos made')}${cell(v.credits_used ?? '0', 'credits used')}${cell(v.credits ?? '0', 'credits left')}</tr></table></td></tr></table>`;
  },
};

// ---------- which email gets which look ----------
const heroVideo = { gif: 'hero-ready', title: (v) => v.video_title || 'Your new video', meta: (v) => v.video_meta || '', href: (v) => v.video_page || v.url || `${v.app_url}/app#library` };
const DESIGNS = {
  welcome: { label: 'Welcome', style: 'film', gif: 'film-welcome' },
  weekly_digest: { label: 'Your week', style: 'film', gif: 'film-digest', blocks: ['digest'] },
  login_code: { label: 'Sign-in', style: 'phone', gif: 'phone-code', blocks: ['code'] },
  verify_email: { label: 'Confirm email', style: 'phone', gif: 'phone-code', blocks: ['code'] },
  password_reset: { label: 'Security', style: 'phone', gif: 'phone-code' },
  video_ready: { label: 'Video ready', style: 'hero', ...heroVideo, blocks: ['video'], ownCta: true },
  long_video_ready: { label: 'Video ready', style: 'hero', ...heroVideo, blocks: ['video'], ownCta: true },
  video_attention: { label: 'Needs a choice', style: 'hero', gif: 'hero-attention', title: (v) => v.video_title || 'Your video', meta: (v) => v.part ? `Part ${v.part} of ${v.segments || v.part} needs your choice` : '', href: (v) => v.job_url, blocks: ['choices'] },
  job_failed: { label: 'Refunded', style: 'split', gif: 'split-refund', stat: (v) => ({ label: 'Credits back', big: '+' + (v.credits || '0'), sub: v.video_title ? `From “${v.video_title}”` : 'Back in your balance', foot: v.balance ? `Balance now: ${v.balance} credits` : '' }) },
  payment_receipt: { label: 'Receipt', style: 'split', gif: 'split-receipt', blocks: ['receipt'], stat: (v) => ({ label: 'Total charged', big: v.amount || '', sub: v.plan ? `${v.plan} plan` : '', foot: v.code ? `Ref ${v.code}` : '' }) },
  topup_receipt: { label: 'Receipt', style: 'split', gif: 'split-receipt', blocks: ['receipt'], stat: (v) => ({ label: 'Total charged', big: v.amount || '', sub: v.credits ? `${v.credits} credits` : '', foot: v.code ? `Ref ${v.code}` : '' }) },
  credits_added: { label: 'Credits', style: 'split', gif: 'split-credits', stat: (v) => ({ label: 'Credits added', big: '+' + (v.credits || '0'), sub: v.balance ? `Balance: ${v.balance}` : 'Top-up credits never expire' }) },
  paid_credits_low: { label: 'Credits', style: 'split', gif: 'split-low', stat: (v) => ({ label: 'Credits left', big: v.credits || '0', sub: v.plan ? `on your ${v.plan} plan` : '', meter: v.pct_left !== undefined ? Number(v.pct_left) : 12 }) },
  trial_credits_low: { label: 'Credits', style: 'split', gif: 'split-low', stat: (v) => ({ label: 'Trial credits left', big: v.credits || '0', sub: 'Pick a plan to keep going', meter: v.pct_left !== undefined ? Number(v.pct_left) : 15 }) },
  referral_earned: { label: 'Referral', style: 'split', gif: 'split-referral', stat: (v) => ({ label: 'You earned', big: v.amount || '', sub: v.pct ? `${v.pct}% of a referred payment` : 'from a referred payment', foot: 'Settles after 30 days' }) },
  plan_upgraded: { label: 'Plan', style: 'phone', gif: 'phone-plan' },
  plan_renewed: { label: 'Plan', style: 'phone', gif: 'phone-plan' },
  plan_renews_soon: { label: 'Plan', style: 'phone', gif: 'phone-plan' },
  card_renews_soon: { label: 'Plan', style: 'phone', gif: 'phone-plan' },
  renewal_reminder: { label: 'Plan', style: 'phone', gif: 'phone-plan' },
  plan_expired: { label: 'Plan', style: 'phone', gif: 'phone-pause' },
  payment_failed: { label: 'Billing', style: 'phone', gif: 'phone-pause' },
  ticket_reply: { label: 'Support', style: 'avatar', gif: 'avatar-support', bubble: (v) => ({ who: v.agent_name ? String(v.agent_name).replace(/&amp;/g, '&') : 'Vooads support', html: v.ticket_subject ? `Replied to your ticket <b>${esc(v.ticket_subject)}</b>.` : 'Replied to your ticket.', chip: v.ticket_id ? `Ticket #${v.ticket_id}` : '' }) },
  actor_approved: { label: 'Your face actor', style: 'avatar', gif: 'avatar-review', bubble: (v) => ({ who: 'Vooads review team', html: `Your consent clip checks out. <b>${esc(v.actor_name || 'Your actor')}</b> is approved and ready in Actors.`, chip: 'Approved' }) },
  actor_declined: { label: 'Your face actor', style: 'avatar', gif: 'avatar-review', bubble: (v) => ({ who: 'Vooads review team', html: `We could not approve <b>${esc(v.actor_name || 'this actor')}</b> yet. ${v.note ? esc(v.note) : 'The consent clip did not match the photo or the consent line.'}`, chip: 'Not approved', chipColor: C.amber, chipInk: C.ink }) },
  upgrade_after_first_hooks: { label: 'Next step', style: 'phone', gif: 'phone-ready' },
  // Account, policy and staff emails stay quiet.
  account_warning: { label: 'Account', style: 'plain' }, account_banned: { label: 'Account', style: 'plain' }, policy_update: { label: 'Policy update', style: 'plain' },
  staff_invite: { label: 'Team', style: 'plain' }, ticket_new: { label: 'New ticket', style: 'plain' },
};
// Onboarding and other lifecycle emails alternate between the two product looks.
function designFor(id) {
  if (DESIGNS[id]) return { id, ...DESIGNS[id] };
  const alt = /day(1|3|6|12)|winback|trial_ended/.test(String(id)) ? 'film-welcome' : 'phone-ready';
  return { id, label: 'Vooads', style: alt.startsWith('film') ? 'film' : 'phone', gif: alt };
}

function renderArt(d, v, assetUrl) {
  const fn = art[d.style] || art.plain;
  return fn(d, (name) => assetUrl(name + '.gif'), v);
}
function renderBlocks(d, v, ctx) {
  return (d.blocks || []).map((b) => blocks[b](v, ctx)).join('');
}

module.exports = { DESIGNS, ART, designFor, renderArt, renderBlocks, button, FONT, C };
