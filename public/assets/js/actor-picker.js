/* Vooads studio: the house-actor picker.
   - A short "Recommended" row (6-8): the customer's last-used actor, the pinned originals, then picks for their market.
   - "Browse all N" opens a clean sheet (full screen on phones): search + chips (Market, Women/Men, Age, Style), a 2-column grid
     on phones and 4-5 on desktop, same card size throughout, cards show name, style and "Speaks". Pages of 12 load as you
     scroll.
   - Motion previews load and play only while in view, at most two at a time, on hover on desktop; never under reduced motion.
   Server: GET /api/actors/recommended, /api/public/config (presenters with tags). */
(function () {
'use strict';
var PAGE = 12, MAX_PLAYING = 2;
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var reduced = function () { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
var S = function () { return window.VA_STUDIO || {}; };

/* ---------- Motion previews: play in view, two at a time ---------- */
var playing = [];
function stop(v) { try { v.pause(); } catch (e) {} playing = playing.filter(function (x) { return x !== v; }); v.closest('.ac') && v.closest('.ac').classList.remove('live'); }
function start(v) {
  if (reduced() || !v.dataset.src) return;
  if (playing.indexOf(v) >= 0) return;
  while (playing.length >= MAX_PLAYING) stop(playing[0]);
  if (!v.src) { v.src = v.dataset.src; }
  var p = v.play(); if (p && p.catch) p.catch(function () {});
  playing.push(v); v.closest('.ac') && v.closest('.ac').classList.add('live');
}
var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
  es.forEach(function (e) { var v = e.target; if (e.isIntersecting && e.intersectionRatio >= 0.6) { if (!matchMedia('(hover: hover)').matches) start(v); } else stop(v); });
}, { threshold: [0, 0.6] }) : null;
function watch(root) {
  Array.prototype.forEach.call(root.querySelectorAll('video[data-src]'), function (v) {
    if (v._w) return; v._w = 1;
    if (io) io.observe(v);
    var card = v.closest('.ac');
    if (card) { card.addEventListener('mouseenter', function () { start(v); }); card.addEventListener('mouseleave', function () { stop(v); }); }
  });
}

/* ---------- Cards ---------- */
function card(a, on) {
  var id = String(a.presenter || a.id).replace(/^h:/, '');
  return '<button type="button" class="ac' + (on ? ' on' : '') + '" data-actor="' + esc(a.own ? a.id : id) + '"' + (a.own ? ' data-own="1"' : '') + ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
    '<span class="ph"><img src="' + esc(a.image_url || a.img || '') + '" alt="" loading="lazy" decoding="async">' +
    (a.motion_url ? '<video muted loop playsinline preload="none" data-src="' + esc(a.motion_url) + '" aria-hidden="true"></video>' : '') + '</span>' +
    '<span class="tx"><b>' + esc(a.name) + '</b><em>' + esc(a.own ? 'Your actor' : (a.style_label || '')) + '</em><small>' + esc(a.speaks_line || '') + '</small></span></button>';
}

var RECO = {};
function reco(pipe) {
  var k = pipe || 'any';
  if (RECO[k]) return Promise.resolve(RECO[k]);
  return S().api('GET', '/api/actors/recommended?pipe=' + encodeURIComponent(pipe || '')).then(function (r) { RECO[k] = r; return r; });
}
function all() { return (S().CFG || {}).presenters || []; }
function filtersCfg() { return (S().CFG || {}).actor_filters || { markets: {}, styles: {}, ages: [] }; }

/* The Recommended row: recommended cards + "Browse all" + an optional extra tile (html). */
function row(cur, extra) {
  cur = String(cur || '').replace(/^h:/, '');
  var list = all();
  var r = RECO.last;
  var rec = r ? r.recommended : list.filter(function (a) { return a.featured; }).concat(list.filter(function (a) { return !a.featured; })).slice(0, 8);
  if (cur && !rec.some(function (a) { return String(a.presenter || a.id).replace(/^h:/, '') === cur; })) {
    var pick = list.find(function (a) { return a.id === cur; }); if (pick) rec = [pick].concat(rec).slice(0, 8);
  }
  return '<div class="arow" id="prGrid">' + rec.map(function (a) { return card(a, String(a.presenter || a.id).replace(/^h:/, '') === cur); }).join('') +
    '<button type="button" class="ac more" data-browse>' + '<span class="ph">' + (S().I ? S().I('search', 22) : '') + '</span><span class="tx"><b>Browse all ' + list.length + '</b><em>Filter by market, age, style</em></span></button>' + (extra || '') + '</div>';
}
/* Fetch the row for this format, then repaint it in place. */
function load(el, pipe, cur, extra, onPick) {
  reco(pipe).then(function (r) { RECO.last = r; var g = el.querySelector('#prGrid'); if (g) { g.outerHTML = row(cur, extra); wire(el, onPick); } }).catch(function () {});
}
function wire(el, onPick) {
  Array.prototype.forEach.call(el.querySelectorAll('#prGrid [data-actor]'), function (b) { b.onclick = function () { onPick(b.dataset.actor, !!b.dataset.own); }; });
  var br = el.querySelector('#prGrid [data-browse]'); if (br) br.onclick = function () { sheet(onPick); };
  var g = el.querySelector('#prGrid'); if (g) watch(g);
}

/* ---------- Browse-all sheet ---------- */
function sheet(onPick) {
  var list = all(), F = filtersCfg();
  var st = { q: '', market: '', gender: '', age: '', style: '' };
  var chips = function (key, opts) { return '<div class="ach" role="group" aria-label="' + esc(key) + '"><button type="button" class="chip on" data-k="' + key + '" data-v="">All</button>' + opts.map(function (o) { return '<button type="button" class="chip" data-k="' + key + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; };
  var m = S().modal('<div class="asheet"><div class="asf"><input class="inp" id="asQ" type="search" placeholder="Search name, look or language" autocomplete="off">' +
    chips('gender', [['f', 'Women'], ['m', 'Men']]) +
    chips('market', Object.keys(F.markets || {}).map(function (k) { return [k, F.markets[k]]; })) +
    chips('age', (F.ages || []).map(function (a) { return [a, a]; })) +
    chips('style', Object.keys(F.styles || {}).map(function (k) { return [k, F.styles[k]]; })) +
    '</div><p class="muted asn" id="asN"></p><div class="agrid" id="asG"></div><div id="asMore" class="asmore" aria-hidden="true"></div></div>', 'All ' + list.length + ' actors');
  m.classList.add('sheet');
  var shown = 0, rows = [];
  var match = function (a) {
    var q = st.q.toLowerCase();
    return (!st.market || a.market === st.market) && (!st.gender || a.gender === st.gender) && (!st.age || a.age === st.age) && (!st.style || a.style === st.style) &&
      (!q || (a.name + ' ' + (a.style_label || '') + ' ' + (a.market_label || '') + ' ' + (a.speaks_line || '') + ' ' + (a.voice_label || '')).toLowerCase().indexOf(q) >= 0);
  };
  var g = m.querySelector('#asG');
  var more = function () { var next = rows.slice(shown, shown + PAGE); g.insertAdjacentHTML('beforeend', next.map(function (a) { return card(a, false); }).join('')); shown += next.length; bind(); watch(g); };
  var paint = function () { rows = list.filter(match); shown = 0; g.innerHTML = ''; m.querySelector('#asN').textContent = rows.length === list.length ? 'Pinned favourites first.' : rows.length + ' match' + (rows.length === 1 ? '' : 'es'); if (!rows.length) g.innerHTML = '<p class="muted">No actor matches. Clear a filter, or describe your own on the Create page.</p>'; else more(); };
  var bind = function () { Array.prototype.forEach.call(g.querySelectorAll('[data-actor]'), function (b) { if (b._b) return; b._b = 1; b.onclick = function () { m._close(); onPick(b.dataset.actor, false); }; }); };
  Array.prototype.forEach.call(m.querySelectorAll('.ach .chip'), function (c) { c.onclick = function () { st[c.dataset.k] = c.dataset.v; Array.prototype.forEach.call(c.parentNode.children, function (x) { x.classList.toggle('on', x === c); }); paint(); }; });
  var t; m.querySelector('#asQ').oninput = function (e) { clearTimeout(t); t = setTimeout(function () { st.q = e.target.value.trim(); paint(); }, 120); };
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { if (es[0].isIntersecting && shown < rows.length) more(); }, { root: m.querySelector('.mbox'), rootMargin: '300px' }).observe(m.querySelector('#asMore'));
  var oc = m._onclose; m._onclose = function () { playing.slice().forEach(stop); if (oc) oc(); };
  paint();
  return m;
}

window.VooActors = { row: row, load: load, wire: wire, sheet: sheet, card: card, watch: watch, _reco: RECO };
})();
