// Server-rendered pages: blog, legal, sitemap, plus the three app shells (site, studio, admin).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { db, get, all, run, J } = require('../db');
const { esc } = require('../lib/util');
const md = require('../lib/markdown');
const media = require('../media');
const samples = require('../samples');
const { serveStatic } = require('../lib/http');
const staging = require('../staging');

const PUB = path.join(__dirname, '..', '..', 'public');
const LEGAL_DIR = path.join(__dirname, '..', '..', 'content', 'legal');
const LEGAL = {
  terms: 'Terms of Service', privacy: 'Privacy Policy', 'acceptable-use': 'Acceptable Use Policy', refunds: 'Refund Policy',
  cookies: 'Cookie Policy', 'ai-content-policy': 'AI Content Policy', dmca: 'Copyright Takedown Policy',
};
const LOGO = '<span class="mark" aria-hidden="true"><i></i><i></i></span><span class="word">Vooads</span>';

// Blog and legal pages share the website's look (site-v3.css: white and blue, self-hosted Geist, the same header and
// footer) plus pages-v3.css for articles and legal text. No inline scripts (the CSP allows scripts from files only).
function shell({ title, description, body, canonical, image, jsonld }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(description || '')}">
<link rel="canonical" href="${esc(config.appUrl + (canonical || ''))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description || '')}"><meta property="og:type" content="article">
<meta property="og:image" content="${esc(image && /^(https?:\/\/|\/)/.test(image) ? (image.startsWith('http') ? image : config.appUrl + image) : config.appUrl + '/assets/img/og.png')}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/favicon.svg"><link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ffffff">
<link rel="preload" href="/assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site-v3.css?v=3"><link rel="stylesheet" href="/assets/css/pages-v3.css?v=1">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head><body class="pg">
<a class="skip" href="#main">Skip to content</a>
<header class="hd scrolled"><div class="hd-in"><a class="logo" href="/" aria-label="Vooads home">${LOGO}</a>
<nav class="nav" aria-label="Main"><a href="/#styles">Ad styles</a><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a href="/blog">Blog</a></nav>
<div class="hd-r"><a class="lnk" href="/app#login">Log in</a><a class="btn btn-blue sm" href="/app#signup">Start free</a></div></div></header>
<main id="main">${body}</main>
<footer class="ft"><div class="wrap ft-in">
<div class="ft-brand"><a class="logo" href="/" aria-label="Vooads home">${LOGO}</a><p>Video ads from one sentence.</p><a class="voo" href="https://voosquare.com" rel="noopener">Part of VooSquare</a></div>
<nav class="ft-cols" aria-label="Footer"><div><b>Product</b><a href="/#styles">Ad styles</a><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a href="/app">Studio</a><a href="/blog">Blog</a></div>
<div><b>Legal</b>${Object.entries(LEGAL).map(([k, v]) => `<a href="/legal/${k}">${v.replace(/ (of Service|Policy)$/, '')}</a>`).join('')}</div>
<div><b>Help</b><a href="/app#support">Support</a><a href="mailto:${esc(config.brand.supportEmail)}">${esc(config.brand.supportEmail)}</a></div></nav></div>
<div class="wrap ft-base"><span>© ${new Date().getFullYear()} ${esc(config.brand.legalLine)}</span><span>Vooads helps you write within ad platform rules. It does not guarantee ad approval or results.</span></div></footer>
</body></html>`;
}

const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

module.exports = function mount(r) {
  r.get('/', (req, res) => serveStatic(PUB, req, res, { maxAge: 300, path: '/index.html' }));
  // On staging the studio and admin carry a "Staging — test data" banner (server/staging.js).
  const shellPage = (file) => (req, res) => {
    if (!config.isStaging) return serveStatic(PUB, req, res, { maxAge: 0, path: file });
    res.setHeader('Cache-Control', 'no-store');
    res.html(staging.injectBanner(fs.readFileSync(path.join(PUB, file), 'utf8')));
  };
  r.get('/app', shellPage('/app.html'));
  r.get('/admin', shellPage('/admin.html'));

  r.get('/blog', (req, res) => {
    const posts = all("SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC");
    const [first, ...rest] = posts;
    const card = (p, big) => `<a class="pcard${big ? ' big' : ''}" href="/blog/${esc(p.slug)}"><div class="pcover">${p.cover_url ? `<img src="${esc(p.cover_url)}" alt="" loading="lazy">` : ''}</div><div class="pbody"><div class="ptags">${J(p.tags, []).slice(0, 2).map((t) => `<span>${esc(t)}</span>`).join('')}</div><h2>${esc(p.title)}</h2><p>${esc(p.excerpt || '')}</p><small>${fmtDate(p.published_at)} · ${p.read_minutes || 5} min read</small></div></a>`;
    const body = `<section class="blog-hero wrap"><span class="eyebrow">The Vooads blog</span><h1>Video ads that sell, <span class="it">explained simply.</span></h1><p class="lede">Hooks, scripts, testing and ad-policy tips for business owners and media buyers.</p></section>
<section class="wrap posts">${first ? card(first, true) : '<p class="muted">No posts yet.</p>'}<div class="pgrid">${rest.map((p) => card(p)).join('')}</div></section>
<section class="wrap cta-band"><div><h2>Type what you sell. Get an ad that sells.</h2><p>UGC videos, street interviews, product shots and hooks in 24 languages. Start with free credits.</p></div><a class="btn btn-blue" href="/app#signup">Start free</a></section>`;
    res.html(shell({ title: 'Blog · Vooads', description: 'Hooks, scripts, testing and ad-policy tips for business owners and media buyers.', body, canonical: '/blog' }));
  });

  r.get('/blog/:slug', (req, res) => {
    const p = get("SELECT * FROM posts WHERE slug = ? AND status = 'published'", req.params.slug);
    if (!p) return res.html(shell({ title: 'Not found · Vooads', body: '<section class="wrap narrow" style="padding-block:120px"><h1>That post is not here.</h1><p><a href="/blog">See all posts</a></p></section>' }), 404);
    const { html, toc } = md.render(p.body_md || '');
    const more = all("SELECT slug, title, cover_url, read_minutes FROM posts WHERE status = 'published' AND id != ? ORDER BY published_at DESC LIMIT 3", p.id);
    const body = `<article class="post wrap">
<a class="back" href="/blog">← All posts</a>
<header class="phead"><div class="ptags">${J(p.tags, []).map((t) => `<span>${esc(t)}</span>`).join('')}</div><h1>${esc(p.title)}</h1><p class="lede">${esc(p.excerpt || '')}</p>
<div class="byline"><span class="mark sm" aria-hidden="true"><i></i><i></i></span><div><b>${esc(p.author || 'Vooads Team')}</b><small>${fmtDate(p.published_at)} · ${p.read_minutes || 5} min read</small></div></div></header>
${p.cover_url ? `<figure class="pfig"><img src="${esc(p.cover_url)}" alt=""></figure>` : ''}
<div class="pwrap">${toc.length > 2 ? `<aside class="toc"><b>In this post</b>${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : '<aside></aside>'}<div class="prose">${html}
<div class="inline-cta"><div><b>Try it on your next campaign</b><p>Turn one product into UGC videos, images and hooks in minutes. Free credits to start.</p></div><a class="btn btn-blue" href="/app#signup">Start free</a></div></div></div>
</article>
${more.length ? `<section class="wrap more"><h3>Keep reading</h3><div class="pgrid">${more.map((m) => `<a class="pcard" href="/blog/${esc(m.slug)}"><div class="pcover">${m.cover_url ? `<img src="${esc(m.cover_url)}" alt="" loading="lazy">` : ''}</div><div class="pbody"><h2>${esc(m.title)}</h2><small>${m.read_minutes || 5} min read</small></div></a>`).join('')}</div></section>` : ''}`;
    res.html(shell({ title: `${p.title} · Vooads`, description: p.excerpt, body, canonical: '/blog/' + p.slug, image: p.cover_url, jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.excerpt, datePublished: p.published_at, author: { '@type': 'Organization', name: 'Vooads' }, publisher: { '@type': 'Organization', name: 'Vooads' } } }));
  });

  // Health check. Railway waits for a 200 here before it swaps a new deploy in, so a build that cannot write its
  // database (or has no ffmpeg on Railway) never replaces the running site. Returns the environment and git version.
  r.get('/healthz', (req, res) => {
    let dbOk = false, dbError = null;
    try {
      db.exec('CREATE TABLE IF NOT EXISTS healthcheck (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL)');
      run("INSERT INTO healthcheck(id, at) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at", new Date().toISOString());
      dbOk = get('SELECT 1 AS ok FROM healthcheck WHERE id = 1')?.ok === 1;
    } catch (e) { dbError = e.message; }
    const stitch = require('../stitch');
    const ffmpeg = stitch.available();
    let ffprobe = false; try { ffprobe = require('../uploads').hasFfprobe(); } catch {}
    const needFfmpeg = (config.onRailway || process.env.REQUIRE_FFMPEG === '1') && process.env.STITCH !== '0';
    const ok = dbOk && (ffmpeg || !needFfmpeg);
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok, env: config.appEnv, version: config.version, db: dbOk ? 'writable' : 'error' + (dbError && !config.isProd ? ': ' + dbError : ''), ffmpeg, ffprobe, uptime_s: Math.round(process.uptime()) }));
  });

  r.get('/legal', (req, res) => res.redirect('/legal/terms'));
  r.get('/legal/:slug', (req, res) => {
    const slug = req.params.slug;
    if (!LEGAL[slug]) return res.html(shell({ title: 'Not found', body: '<section class="wrap narrow" style="padding-block:120px"><h1>Page not found</h1></section>' }), 404);
    const raw = fs.readFileSync(path.join(LEGAL_DIR, slug + '.md'), 'utf8');
    const { meta, body } = md.frontMatter(raw);
    const { html, toc } = md.render(body.replace(/^#\s+.*\n/, ''));
    const page = `<section class="legal wrap"><div class="lside"><b>Legal</b>${Object.entries(LEGAL).map(([k, v]) => `<a href="/legal/${k}"${k === slug ? ' aria-current="page"' : ''}>${v}</a>`).join('')}</div>
<div><span class="eyebrow">Legal</span><h1>${esc(meta.title || LEGAL[slug])}</h1><p class="muted">Last updated ${esc(meta.updated || meta.last_updated || '')}</p>
${toc.length > 3 ? `<nav class="ltoc">${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join('')}</nav>` : ''}<div class="prose">${html}</div></div></section>`;
    res.html(shell({ title: `${meta.title || LEGAL[slug]} · Vooads`, description: `Vooads ${LEGAL[slug]}`, body: page, canonical: '/legal/' + slug }));
  });

  r.get('/sitemap.xml', (req, res) => {
    const urls = ['/', '/blog', ...Object.keys(LEGAL).map((k) => '/legal/' + k), ...all("SELECT slug FROM posts WHERE status = 'published'").map((p) => '/blog/' + p.slug)];
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${config.appUrl}${u}</loc></url>`).join('')}</urlset>`);
  });
  r.get('/robots.txt', (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(config.isStaging ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${config.appUrl}/sitemap.xml\n`); });

  r.get('/media/:file', (req, res) => {
    const p = media.filePath(req.params.file);
    if (!p) { res.writeHead(404); return res.end('Not found'); }
    serveStatic(path.dirname(p), req, res, { maxAge: 86400 * 30, path: '/' + path.basename(p) });
  });
  r.get('/samples/:file', (req, res) => {
    const name = req.params.file;
    if (!samples.known(name)) { res.writeHead(404); return res.end('Not found'); }
    const p = samples.localPath(name);
    if (p) return serveStatic(path.dirname(p), req, res, { maxAge: 86400 * 7, path: '/' + path.basename(p) });
    if (!samples.SAMPLES[name]) { res.writeHead(404); return res.end('Not found'); }
    res.redirect(samples.srcUrl(samples.SAMPLES[name]));
  });
};
