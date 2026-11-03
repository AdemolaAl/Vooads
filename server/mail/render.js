// Mail: turns composer blocks into an email that looks right in Gmail, Apple Mail and Outlook (tables + inline styles).
// Pure functions with no server dependencies, so the demo runs this exact file in the browser.
//
// A document is { subject, preheader, from_name, blocks: [...] }. Block types:
//   heading {text, size, align}         text {html, align}                image {src, alt, href, width, align}
//   button {label, href, align, style}  divider {}                         spacer {h}
//   columns {src, alt, href, html, side} video {src, alt, href, caption}    footer {html}
// Personalization tags: {{first_name}}, {{credits}}, {{plan}}, {{email}} with an optional fallback: {{first_name|there}}.
const { sanitize, safeUrl, toText, esc, decode } = require('./sanitize');

const C = { bg: '#F4F3EF', card: '#FFFFFF', line: '#EAE7DE', ink: '#121110', body: '#3A3630', mut: '#8A8578', brand: '#FF4A1C' };
const WIDTH = 600, INNER = 536;
const TYPES = ['heading', 'text', 'image', 'button', 'divider', 'spacer', 'columns', 'video', 'footer'];
const TAGS = ['first_name', 'credits', 'plan', 'email'];
const IMG_SRC = /^\/(media\/u\/[\w-]{6,40}\.(png|jpe?g|gif|webp)|assets\/email\/[\w.-]{1,60})$/i;

const str = (v, n) => String(v ?? '').slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const okSrc = (s) => (IMG_SRC.test(String(s || '')) ? String(s) : '');
const okHref = (h) => (h ? safeUrl(h) || '' : '');

// Clean one block from the browser: unknown fields dropped, sizes clamped, HTML sanitized, URLs checked.
function normalizeBlock(b) {
  if (!b || typeof b !== 'object' || !TYPES.includes(b.t)) return null;
  const id = /^[\w-]{1,24}$/.test(String(b.id || '')) ? String(b.id) : Math.random().toString(36).slice(2, 10);
  const align = pick(b.align, ['left', 'center', 'right'], 'left');
  switch (b.t) {
    case 'heading': return { id, t: 'heading', text: str(b.text, 300), size: pick(b.size, ['lg', 'md'], 'lg'), align };
    case 'text': return { id, t: 'text', html: sanitize(str(b.html, 20000)), align };
    case 'image': return { id, t: 'image', src: okSrc(b.src), alt: str(b.alt, 200), href: okHref(b.href), width: pick(Number(b.width), [100, 75, 50], 100), align: pick(b.align, ['left', 'center', 'right'], 'center'), w: num(b.w, 0, 10000, 0), h: num(b.h, 0, 10000, 0) };
    case 'button': return { id, t: 'button', label: str(b.label, 80), href: okHref(b.href), align, style: pick(b.style, ['brand', 'ink', 'outline'], 'brand') };
    case 'divider': return { id, t: 'divider' };
    case 'spacer': return { id, t: 'spacer', h: num(b.h, 4, 120, 24) };
    case 'columns': return { id, t: 'columns', src: okSrc(b.src), alt: str(b.alt, 200), href: okHref(b.href), html: sanitize(str(b.html, 10000)), side: pick(b.side, ['left', 'right'], 'left') };
    case 'video': return { id, t: 'video', src: okSrc(b.src), alt: str(b.alt, 200), href: okHref(b.href), caption: str(b.caption, 140), w: num(b.w, 0, 10000, 0), h: num(b.h, 0, 10000, 0) };
    case 'footer': return { id, t: 'footer', html: sanitize(str(b.html, 4000)) };
    default: return null;
  }
}
function normalizeDoc(d = {}) {
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).slice(0, 60).map(normalizeBlock).filter(Boolean);
  return {
    subject: str(d.subject, 200).replace(/[\r\n]+/g, ' '),
    preheader: str(d.preheader, 250).replace(/[\r\n]+/g, ' '),
    from_name: str(d.from_name, 60).replace(/[<>"\r\n@,;:]/g, '').trim(),
    blocks,
  };
}

// ---------- Personalization ----------
const TAG = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/gi;
// html=true: the text is already escaped HTML, so values are escaped and fallbacks are used as they are.
function fill(text, vars = {}, html = false) {
  return String(text ?? '').replace(TAG, (m, k, fb) => {
    k = k.toLowerCase();
    if (k === 'app_url') return m; // replaced later, as a link
    const v = vars[k] === undefined || vars[k] === null ? '' : String(vars[k]).trim();
    if (v) return html ? esc(v) : v;
    if (fb !== undefined) return html ? fb : decode(fb);
    return TAGS.includes(k) || k === 'name' ? '' : m;
  });
}
// Lifecycle templates go through the older email builder ({{name}} style, no fallbacks).
const LEGACY = { first_name: 'name', name: 'name', credits: 'credits', plan: 'plan', email: 'customer_email' };
const toLegacyTags = (text) => String(text ?? '').replace(TAG, (m, k) => (LEGACY[k.toLowerCase()] ? `{{${LEGACY[k.toLowerCase()]}}}` : `{{${k}}}`));

// ---------- HTML pieces ----------
const P_STYLE = 'margin:0 0 14px';
function styleHtml(html) {
  return String(html)
    .replace(/<p>/g, `<p style="${P_STYLE}">`).replace(/<p style="/g, (m) => m) // keep sanitized inline styles
    .replace(/<a href=/g, `<a style="color:${C.brand};text-decoration:underline" href=`)
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:22px">').replace(/<ol>/g, '<ol style="margin:0 0 14px;padding-left:22px">')
    .replace(/<li>/g, '<li style="margin:0 0 6px">')
    .replace(/<blockquote>/g, `<blockquote style="margin:0 0 14px;padding:10px 16px;border-left:3px solid ${C.brand};color:${C.ink}">`)
    .replace(/<h2>/g, `<h2 style="margin:0 0 10px;font-size:20px;line-height:1.25;color:${C.ink}">`).replace(/<h3>/g, `<h3 style="margin:0 0 8px;font-size:17px;line-height:1.3;color:${C.ink}">`);
}
// Rewrites every href in sanitized HTML through ctx.href (tracking, {{app_url}}).
function mapLinks(html, ctx) {
  return String(html).replace(/href="([^"]*)"/g, (m, u) => `href="${esc(ctx.href(decode(u)))}"`);
}

function img(ctx, src, alt, maxW, radius = 14) {
  return `<img src="${esc(ctx.abs(src))}" alt="${esc(alt)}" width="${maxW}" style="display:block;width:100%;max-width:${maxW}px;height:auto;border:0;outline:none;border-radius:${radius}px">`;
}
const wrapLink = (ctx, href, inner) => (href ? `<a href="${esc(ctx.href(href))}" style="text-decoration:none;display:block">${inner}</a>` : inner);

function blockHtml(b, ctx) {
  const F = (s) => (ctx.keepTags ? toLegacyTags(s) : fill(s, ctx.vars, true));
  const Ft = (s) => (ctx.keepTags ? toLegacyTags(s) : fill(s, ctx.vars, false));
  switch (b.t) {
    case 'heading': {
      const fs = b.size === 'md' ? 21 : 28;
      return `<h1 style="margin:0;font-size:${fs}px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:${C.ink};text-align:${b.align}">${esc(Ft(b.text))}</h1>`;
    }
    case 'text':
      return `<div style="font-size:16px;line-height:1.6;color:${C.body};text-align:${b.align}">${mapLinks(styleHtml(F(b.html)), ctx)}</div>`;
    case 'image': {
      if (!b.src) return ctx.preview ? placeholder('Pick an image') : '';
      const w = Math.round(INNER * b.width / 100);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="${b.align}">${wrapLink(ctx, b.href, img(ctx, b.src, b.alt, w))}</td></tr></table>`;
    }
    case 'button': {
      if (!b.label) return ctx.preview ? placeholder('Add a button label') : '';
      const s = { brand: [C.brand, '#FFFFFF', C.brand], ink: [C.ink, '#FFFFFF', C.ink], outline: ['#FFFFFF', C.ink, C.ink] }[b.style];
      const href = b.href ? esc(ctx.href(b.href)) : '#';
      return `<table role="presentation" cellpadding="0" cellspacing="0" ${b.align === 'center' ? 'align="center" ' : b.align === 'right' ? 'align="right" ' : ''}style="margin:4px 0"><tr><td style="border-radius:999px;background:${s[0]};border:2px solid ${s[2]}"><a href="${href}" style="display:inline-block;padding:13px 28px;font-weight:700;font-size:16px;line-height:1.2;color:${s[1]};text-decoration:none;border-radius:999px">${esc(Ft(b.label))} &rarr;</a></td></tr></table>`;
    }
    case 'divider':
      return `<div style="border-top:1px solid ${C.line};font-size:1px;line-height:1px;margin:6px 0">&nbsp;</div>`;
    case 'spacer':
      return `<div style="height:${b.h}px;line-height:${b.h}px;font-size:1px">&nbsp;</div>`;
    case 'columns': {
      const half = Math.floor((INNER - 20) / 2);
      const pic = `<div class="vx-col" style="display:inline-block;width:100%;max-width:${half}px;vertical-align:middle;font-size:16px">${b.src ? wrapLink(ctx, b.href, img(ctx, b.src, b.alt, half)) : ctx.preview ? placeholder('Pick an image') : ''}</div>`;
      const txt = `<div class="vx-col" style="display:inline-block;width:100%;max-width:${half}px;vertical-align:middle;font-size:16px"><div class="vx-colt" style="padding:4px 0;font-size:16px;line-height:1.6;color:${C.body}">${mapLinks(styleHtml(F(b.html)), ctx)}</div></div>`;
      const gap = '<div class="vx-gap" style="display:inline-block;width:20px;font-size:1px">&nbsp;</div>';
      const parts = b.side === 'right' ? [txt, pic] : [pic, txt];
      return `<div style="font-size:0;text-align:left"><!--[if mso]><table role="presentation" width="100%"><tr><td width="50%" valign="middle"><![endif]-->${parts[0]}<!--[if mso]></td><td width="20"></td><td width="50%" valign="middle"><![endif]-->${gap}${parts[1]}<!--[if mso]></td></tr></table><![endif]--></div>`;
    }
    case 'video': {
      if (!b.src) return ctx.preview ? placeholder('Pick a thumbnail for the video') : '';
      const h = b.w && b.h ? Math.max(120, Math.min(640, Math.round(INNER * b.h / b.w))) : 300;
      const u = esc(ctx.abs(b.src));
      const play = `<span style="display:inline-block;width:68px;height:68px;line-height:68px;border-radius:50%;background:${C.brand};color:#FFFFFF;font-size:24px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35)">&#9654;</span>`;
      const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td background="${u}" height="${h}" align="center" valign="middle" style="height:${h}px;background-color:${C.ink};background-image:url('${u}');background-size:cover;background-position:center;border-radius:14px" role="img" aria-label="${esc(b.alt || 'Play video')}">${play}</td></tr></table>`;
      const cap = b.caption ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.4;color:${C.mut};text-align:center">&#9654; ${esc(Ft(b.caption))}</p>` : '';
      return wrapLink(ctx, b.href, box) + cap;
    }
    default: return '';
  }
}
const placeholder = (t) => `<div style="border:2px dashed ${C.line};border-radius:14px;padding:28px 16px;text-align:center;color:${C.mut};font-size:14px">${esc(t)}</div>`;

function blockText(b, ctx) {
  const Ft = (s) => fill(s, ctx.vars, false);
  const href = (h) => (h ? ctx.href(h) : '');
  switch (b.t) {
    case 'heading': return Ft(b.text).toUpperCase();
    case 'text': case 'footer': return toText(mapLinks(fill(b.html, ctx.vars, true), ctx));
    case 'image': return b.href ? `${b.alt || 'Image'}: ${href(b.href)}` : '';
    case 'button': return b.label ? `${Ft(b.label)}: ${href(b.href)}` : '';
    case 'columns': return [toText(mapLinks(fill(b.html, ctx.vars, true), ctx)), b.href ? href(b.href) : ''].filter(Boolean).join('\n');
    case 'video': return b.href ? `Watch${b.caption ? ' "' + Ft(b.caption) + '"' : ' the video'}: ${href(b.href)}` : '';
    case 'divider': return '----';
    default: return '';
  }
}

function context(opts = {}) {
  const appUrl = String(opts.appUrl || '').replace(/\/$/, '');
  const link = opts.link || ((u) => u);
  return {
    ...opts, appUrl, vars: opts.vars || {},
    abs: (src) => (/^https?:\/\//.test(src) || opts.relative ? src : appUrl + src),
    href: (u) => {
      let url = String(u || '');
      if (opts.keepTags) return url;
      url = url.replace(/^\{\{\s*app_url\s*\}\}/, appUrl);
      if (!/^https?:\/\//i.test(url)) return url; // mailto: is never tracked
      return link(url);
    },
  };
}

// Inner HTML only: what goes inside the older lifecycle layout (body_html). Keeps {{name}} style tags.
function legacyBody(blocks) {
  const ctx = context({ keepTags: true, appUrl: '{{app_url}}', relative: false });
  ctx.abs = (src) => '{{app_url}}' + src;
  return blocks.map((b) => {
    if (b.t === 'footer') return `<div style="font-size:13px;line-height:1.6;color:${C.mut}">${styleHtml(toLegacyTags(b.html))}</div>`;
    return `<div style="margin:0 0 14px">${blockHtml(b, ctx)}</div>`;
  }).join('\n');
}

// Full campaign email. opts: { appUrl, company, support, vars, link(url), pixel, unsubUrl, prefsUrl, preview, relative }
function renderEmail(doc, opts = {}) {
  const d = doc && doc.__normalized ? doc : normalizeDoc(doc);
  const ctx = context(opts);
  const main = d.blocks.filter((b) => b.t !== 'footer');
  const foot = d.blocks.filter((b) => b.t === 'footer');
  const rows = main.map((b, i) => {
    const inner = blockHtml(b, ctx);
    if (!inner) return '';
    const pt = i === 0 ? 34 : b.t === 'spacer' || b.t === 'divider' ? 0 : 8;
    const pb = i === main.length - 1 ? 34 : b.t === 'heading' ? 6 : 10;
    return `<tr${ctx.preview ? ` data-b="${esc(b.id)}"` : ''}><td class="vx-pad" style="padding:${pt}px 32px ${pb}px">${inner}</td></tr>`;
  }).join('');
  const subject = fill(d.subject, ctx.vars, false);
  const preheader = fill(d.preheader, ctx.vars, false);
  const footHtml = foot.map((b) => `<div${ctx.preview ? ` data-b="${esc(b.id)}"` : ''} style="font-size:13px;line-height:1.6;color:${C.mut};margin:0 0 12px">${mapLinks(styleHtml(fill(b.html, ctx.vars, true)), ctx)}</div>`).join('');
  const legal = [opts.unsubUrl ? `<a href="${esc(opts.unsubUrl)}" style="color:${C.mut};text-decoration:underline">Unsubscribe</a>` : '',
    opts.prefsUrl ? `<a href="${esc(opts.prefsUrl)}" style="color:${C.mut};text-decoration:underline">Email preferences</a>` : '',
    `<a href="${esc(ctx.appUrl)}/legal/privacy" style="color:${C.mut};text-decoration:underline">Privacy</a>`].filter(Boolean).join(' &middot; ');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title>${ctx.preview ? '<base target="_blank">' : ''}
<style>body{margin:0;padding:0}img{-ms-interpolation-mode:bicubic}@media (max-width:520px){.vx-pad{padding-left:20px!important;padding-right:20px!important}.vx-col{max-width:100%!important;display:block!important}.vx-gap{display:none!important}.vx-colt{padding:14px 0 0!important}.vx-outer{padding:12px 8px!important}}${ctx.preview ? '[data-b]{cursor:pointer;transition:box-shadow .2s}[data-b]:hover{box-shadow:inset 0 0 0 2px rgba(255,74,28,.35)}[data-b].vx-on{box-shadow:inset 0 0 0 2px #FF4A1C}' : ''}</style></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" class="vx-outer" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${WIDTH}px">
<tr><td style="padding:0 6px 16px"><a href="${esc(ctx.href(ctx.appUrl || 'https://vooads.com'))}" style="text-decoration:none;color:${C.ink};font-weight:800;font-size:22px;letter-spacing:-0.5px"><img src="${esc(ctx.abs('/assets/email/mark.png'))}" width="36" height="36" alt="" style="vertical-align:middle;border-radius:10px;margin-right:8px;border:0">Vooads</a></td></tr>
<tr><td style="background:${C.card};border-radius:24px;border:1px solid ${C.line};overflow:hidden"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows || `<tr><td style="padding:40px 32px">${ctx.preview ? placeholder('Add blocks on the left to build your email') : ''}</td></tr>`}</table></td></tr>
<tr><td style="padding:22px 14px 8px;text-align:center">${footHtml}<div style="font-size:12.5px;line-height:1.6;color:${C.mut}">Vooads · AI video ads, made fast.${opts.legal ? ' ' + esc(opts.legal) + '.' : ''} ${opts.support ? `Questions? Reply or write to <a href="mailto:${esc(opts.support)}" style="color:${C.mut}">${esc(opts.support)}</a>.` : ''}<br>${legal}</div></td></tr>
</table></td></tr></table>${opts.pixel ? `<img src="${esc(opts.pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}
</body></html>`;
  const text = [...main.map((b) => blockText(b, ctx)), ...foot.map((b) => blockText(b, ctx))].filter(Boolean).join('\n\n')
    + `\n\n--\nVooads · AI video ads, made fast.${opts.legal ? ' ' + opts.legal + '.' : ''}` + (opts.unsubUrl ? `\nUnsubscribe: ${opts.unsubUrl}` : '') + (opts.prefsUrl ? `\nEmail preferences: ${opts.prefsUrl}` : '');
  return { subject, preheader, html, text };
}

// Lifecycle template (heading/body_html/cta fields) ⇄ blocks.
function fromLegacy(t) {
  const blocks = [];
  if (t.heading) blocks.push({ id: 'h1', t: 'heading', text: t.heading, size: 'lg', align: 'left' });
  if (t.body_html) blocks.push({ id: 'b1', t: 'text', html: t.body_html, align: 'left' });
  if (t.cta_label && t.cta_url) blocks.push({ id: 'c1', t: 'button', label: t.cta_label, href: t.cta_url, align: 'left', style: 'brand' });
  return normalizeDoc({ subject: t.subject, preheader: t.preheader, blocks });
}
function toLegacy(doc) {
  const d = normalizeDoc(doc);
  const blocks = [...d.blocks];
  let heading = '', ctaLabel = '', ctaUrl = '';
  if (blocks[0] && blocks[0].t === 'heading') heading = toLegacyTags(blocks.shift().text);
  const lastIdx = blocks.map((b) => b.t).lastIndexOf('button');
  if (lastIdx >= 0 && blocks.slice(lastIdx + 1).every((b) => ['footer', 'spacer', 'divider'].includes(b.t)) && blocks[lastIdx].href) {
    const b = blocks.splice(lastIdx, 1)[0];
    ctaLabel = toLegacyTags(b.label); ctaUrl = b.href;
  }
  return { subject: toLegacyTags(d.subject), preheader: toLegacyTags(d.preheader), heading, body_html: legacyBody(blocks), cta_label: ctaLabel, cta_url: ctaUrl };
}

module.exports = { renderEmail, normalizeDoc, normalizeBlock, fill, fromLegacy, toLegacy, toLegacyTags, TYPES, TAGS, IMG_SRC, COLORS: C };
