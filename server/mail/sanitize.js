// Mail: HTML sanitizer for text blocks (allowlist). No dependencies, so the demo can run the exact same code in the browser.
// Keeps simple formatting (paragraphs, bold, italic, underline, lists, quotes, links) and a few safe inline styles.
// Everything else is dropped: scripts, styles, event handlers, iframes, forms, images inside text, unknown attributes and
// any link that is not http(s), mailto or {{app_url}}. Text is escaped. Output is always well-formed (unclosed tags closed).

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'span']);
const RENAME = { div: 'p', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', del: 's', strike: 's', ins: 'u' };
const VOID = new Set(['br']);
// Content of these is thrown away together with the tag.
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'title', 'head', 'select', 'option', 'xmp', 'noembed', 'noframes', 'plaintext', 'frameset', 'applet', 'form', 'button']);
const STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'font-size', 'text-align', 'text-decoration', 'line-height',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-left', 'border-radius']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
// Text between tags: keep real entities (&amp; &#8217; …), escape everything else.
const escText = (s) => String(s).replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A link is kept only when it is http(s), mailto, or starts with the {{app_url}} placeholder.
function safeUrl(raw) {
  // eslint-disable-next-line no-control-regex
  const v = decode(String(raw || '')).replace(/[\u0000- \u007f-\u009f]+/g, '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^mailto:[^\s"'<>]+$/i.test(v)) return v;
  if (/^\{\{\s*app_url\s*\}\}[^\s"'<>]*$/.test(v)) return v;
  return null;
}

function safeStyle(raw) {
  const out = [];
  for (const part of decode(String(raw || '')).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !val || val.length > 80) continue;
    if (!/^[#a-z0-9 .,%()-]+$/i.test(val) || /url\s*\(|expression|javascript|@import|\\/i.test(val)) continue;
    out.push(prop + ':' + val);
  }
  return out.join(';');
}

function attrs(src) {
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)(>|$)/g;

function sanitize(input, { maxLength = 100000 } = {}) {
  const html = String(input ?? '').slice(0, maxLength);
  const out = [];
  const stack = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (m.index > last) out.push(escText(html.slice(last, m.index)));
    last = TOKEN.lastIndex;
    if (!m[2]) continue; // comment, doctype, processing instruction
    if (m[5] !== '>') continue; // unterminated tag at the very end: drop it
    const closing = m[1] === '/';
    let name = m[2].toLowerCase();
    if (DROP.has(name)) {
      if (closing) continue;
      // Skip everything up to the matching close tag (or the end).
      const end = html.toLowerCase().indexOf('</' + name, last);
      if (end < 0) { last = html.length; break; }
      const gt = html.indexOf('>', end);
      last = TOKEN.lastIndex = gt < 0 ? html.length : gt + 1;
      continue;
    }
    name = RENAME[name] || name;
    if (!ALLOWED.has(name)) continue; // unknown tag: drop the tag, keep its text
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) out.push('</' + stack.pop() + '>');
      continue;
    }
    if (VOID.has(name)) { out.push('<br>'); continue; }
    const a = attrs(m[3] || '');
    let attr = '';
    if (name === 'a') {
      const href = safeUrl(a.href);
      if (href) attr += ` href="${esc(href)}"`;
    }
    if (a.style && name !== 'a') {
      const st = safeStyle(a.style);
      if (st) attr += ` style="${esc(st)}"`;
    }
    if (name === 'p' && stack.includes('p')) { // no paragraphs inside paragraphs
      while (stack.length && stack[stack.length - 1] !== 'p') out.push('</' + stack.pop() + '>');
      out.push('</' + stack.pop() + '>');
    }
    out.push('<' + name + attr + '>');
    stack.push(name);
  }
  if (last < html.length) out.push(escText(html.slice(last)));
  while (stack.length) out.push('</' + stack.pop() + '>');
  return out.join('').replace(/<p>(\s|<br>)*<\/p>$/g, '');
}

// Plain text version of sanitized HTML (for the text part of an email).
function toText(html) {
  return decode(String(html || '')
    .replace(/<br>/g, '\n').replace(/<li>/g, '\n- ').replace(/<\/(p|h2|h3|blockquote|ul|ol)>/g, '\n\n')
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (m0, u, t) => (t.replace(/<[^>]+>/g, '') === decode(u) ? t : `${t} (${u})`))
    .replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { sanitize, safeUrl, safeStyle, toText, esc, decode };
