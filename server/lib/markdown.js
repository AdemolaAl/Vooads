// Small, safe Markdown renderer for blog posts and legal pages (headings, lists, links, bold, italics, code, quotes, tables, images).
const { esc } = require('./util');

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => /^(https?:\/\/|\/)/.test(u) ? `<img src="${u}" alt="${a}" loading="lazy">` : '');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => {
    if (!/^(https?:\/\/|\/|mailto:|#)/.test(u)) return a;
    const ext = /^https?:\/\//.test(u);
    return `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ''}>${a}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  return t;
}

function frontMatter(src) {
  const m = String(src).match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: String(src) };
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const i = line.indexOf(':');
    if (i < 0) return;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    meta[k] = v;
  });
  return { meta, body: String(src).slice(m[0].length) };
}

function render(src) {
  const lines = String(src).replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let i = 0;
  const heads = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length; const text = h[2].trim();
      const idv = text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
      if (lvl === 2) heads.push({ id: idv, text });
      out.push(`<h${lvl} id="${idv}">${inline(text)}</h${lvl}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line); i += 2;
      const body = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        const box = item.match(/^\[( |x)\]\s+(.*)$/i);
        items.push(box ? `<li class="chk${box[1].trim() ? ' done' : ''}">${inline(box[2])}</li>` : `<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s+|\|)/.test(lines[i])) buf.push(lines[i++].trim());
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
    else i++;
  }
  return { html: out.join('\n'), toc: heads };
}

module.exports = { render, frontMatter, inline };
