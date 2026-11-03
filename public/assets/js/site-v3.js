/* Vooads website v3: media loading, the hero moment, marquees, the scroll story, tabs, Ban Shield, pricing.
   Every animation moves transform/opacity only. Videos play only while on screen (capped), and nothing moves or
   autoplays when the visitor asked for reduced motion. Works on the live site (/samples/) and in the offline demo
   (window.VA_VIDEO / window.VA_IMG point at its folders). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var VIDEO = window.VA_VIDEO || '/samples/';
  var IMG = window.VA_IMG || '/samples/';
  var APP = window.VA_APP || '/app';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small = window.matchMedia && matchMedia('(max-width: 900px)').matches;
  var CAP = small ? 4 : 10; // most videos decoding at once
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Invites: ?invite=CODE (and old ?ref=CODE links) are kept for the sign-up in the studio (same origin, same key).
  try { var q = new URLSearchParams(location.search), inv = q.get('invite') || q.get('ref'); if (inv && /^[a-z0-9]{4,16}$/i.test(inv)) localStorage.setItem('va_ref', inv); } catch (e) {}
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  /* ---------- "Made with Vooads" tag on every gallery card ---------- */
  $$('.gc').forEach(function (c) { if (!c.querySelector('.made')) { var t = document.createElement('span'); t.className = 'made'; t.textContent = 'Made with Vooads'; c.appendChild(t); } });

  /* ---------- seamless marquees: repeat the items once so a -50% move loops ---------- */
  $$('.track, .gal-track, .strip-track').forEach(function (t) {
    Array.prototype.slice.call(t.children).forEach(function (c) { var k = c.cloneNode(true); k.setAttribute('aria-hidden', 'true'); t.appendChild(k); });
  });

  /* ---------- media ---------- */
  function prepVideo(v) {
    var n = v.getAttribute('data-v');
    if (!n || v._prep) return;
    v._prep = true;
    v.muted = true; v.setAttribute('muted', ''); v.playsInline = true;
    v.poster = IMG + n + '.webp';
  }
  $$('video[data-v]').forEach(prepVideo);
  $$('img[data-i]').forEach(function (i) { i.loading = 'lazy'; i.decoding = 'async'; i.src = IMG + i.getAttribute('data-i') + '.webp'; });
  $$('.frames i, .hs-mini.m3 i').forEach(function (i, k) { i.style.backgroundImage = 'url(' + IMG + 'frame-serum-' + ((k % 6) + 1) + '.webp)'; });

  var visible = new Set();
  function wanted(v) { return visible.has(v) && !v.closest('[hidden]') && !(v.classList.contains('fv') && !v.classList.contains('on')) && !(v.closest('.l4') && $('#phone') && $('#phone').getAttribute('data-step') !== '4'); }
  function load(v) { if (!v.src) { v.preload = 'auto'; v.src = (v.getAttribute('data-src') || VIDEO + v.getAttribute('data-v') + '.mp4'); } }
  var scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; sync(); }); }
  function sync() {
    if (reduce) return;
    var list = $$('video[data-v], video[data-src]').filter(wanted);
    list.sort(function (a, b) { return (b.hasAttribute('data-prio') ? 1 : 0) - (a.hasAttribute('data-prio') ? 1 : 0); });
    var play = list.slice(0, CAP);
    $$('video[data-v], video[data-src]').forEach(function (v) {
      if (play.indexOf(v) >= 0) { load(v); if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
      else if (!v.paused) v.pause();
    });
  }
  var vio = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
    schedule();
  }, { rootMargin: '80px 0px', threshold: 0.15 }) : null;
  function watchVideos(root) { $$('video[data-v], video[data-src]', root).forEach(function (v) { prepVideo(v); if (vio) vio.observe(v); }); }
  watchVideos(document);
  document.addEventListener('visibilitychange', function () { if (document.hidden) $$('video').forEach(function (v) { v.pause(); }); else schedule(); });

  /* Pause marquees that are off screen (no work for the GPU when nobody sees them). */
  if ('IntersectionObserver' in window) {
    var mio = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('paused', !e.isIntersecting); }); }, { rootMargin: '60px 0px' });
    $$('.hero-stage, .gal, .strip, .lang-run, .final').forEach(function (el) { mio.observe(el); });
  }
  var ps = document.createElement('style');
  ps.textContent = '.paused .track,.paused.gal .gal-track,.paused.strip .strip-track,.paused.lang-run div{animation-play-state:paused!important}';
  document.head.appendChild(ps);

  /* ---------- header ---------- */
  var hd = $('#hd');
  var onScroll = function () { hd.classList.toggle('scrolled', scrollY > 8); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  var mb = $('#menuB'), mn = $('#mnav');
  mb.addEventListener('click', function () { var open = mn.hidden; mn.hidden = !open; mb.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  $$('a', mn).forEach(function (a) { a.addEventListener('click', function () { mn.hidden = true; mb.setAttribute('aria-expanded', 'false'); }); });

  /* ---------- hero moment ---------- */
  var heroRoot = $('.hero');
  var ready = function () { heroRoot.classList.add('ready'); };
  if (reduce) ready();
  else if (document.fonts && document.fonts.ready) { var t = setTimeout(ready, 600); document.fonts.ready.then(function () { clearTimeout(t); setTimeout(ready, 60); }); }
  else setTimeout(ready, 120);

  var FEAT = [['UGC talking video', 'A creator at her podcast mic'], ['Local business promo', 'A café owner talks to camera'], ['UGC talking video', 'A skincare creator and her serum'], ['UGC creator ad', 'A creator at her desk']];
  var fvs = $$('.fv'), dots = $$('#fDots li'), fi = 0, heroOn = true;
  function feature(n) {
    fi = (n + fvs.length) % fvs.length;
    fvs.forEach(function (v, k) { v.classList.toggle('on', k === fi); });
    dots.forEach(function (d, k) { d.classList.remove('on'); if (k === fi) { void d.offsetWidth; d.classList.add('on'); } });
    var cap = $('.feature-cap'); cap.classList.add('swap');
    setTimeout(function () { $('#fCap').textContent = FEAT[fi][0]; $('#fMeta').textContent = FEAT[fi][1]; cap.classList.remove('swap'); }, 260);
    schedule();
  }
  if (!reduce && fvs.length) {
    setInterval(function () { if (heroOn && !document.hidden) feature(fi + 1); }, 5500);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { heroOn = es[0].isIntersecting; }).observe($('#heroStage'));
  }

  /* ---------- prompt boxes ---------- */
  var IDEAS = ['A café promo for our new oat latte, morning light, friendly barista', 'A 15-second UGC ad for a vitamin C serum, women 25 to 40', 'Weekend sale at my boutique, 30% off knitwear', 'A tour of a bright three-bedroom home for sale', 'An app ad: how a budget planner helped her save every month', 'A street-interview style ad for a meal prep service'];
  var hq = $('#heroQ');
  if (hq && !reduce) {
    var ii = 0, ci = 0, typing = null;
    var tick = function () {
      if (document.activeElement === hq || hq.value) { hq.placeholder = 'What do you want to make?'; typing = setTimeout(tick, 1500); return; }
      var s = IDEAS[ii];
      ci++; hq.placeholder = s.slice(0, ci);
      if (ci >= s.length) { ci = 0; ii = (ii + 1) % IDEAS.length; typing = setTimeout(tick, 2200); }
      else typing = setTimeout(tick, 34);
    };
    typing = setTimeout(tick, 1600);
  }
  // "Idea → video" demo under the box (i2v.js): runs once in view; a chip re-runs it with that idea's sample.
  var demo = window.VooI2V && $('#i2v') ? VooI2V.mount($('#i2v'), { base: VIDEO, key: 'cafe' }) : null;
  $$('#heroChips button').forEach(function (b) {
    b.addEventListener('click', function () {
      hq.value = b.getAttribute('data-p'); hq.focus(); hq.setSelectionRange(hq.value.length, hq.value.length);
      $$('#heroChips button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      if (demo) demo.show(b.getAttribute('data-k'));
    });
  });
  $$('form.prompt').forEach(function (f) {
    var ta = $('textarea', f);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.submit(); } });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = ta.value.trim();
      if (!v) { ta.focus(); ta.placeholder = 'Type what you sell, for example: “a café promo for our oat latte”'; return; }
      store.set('va_prompt', v.slice(0, 400));
      location.href = APP + '#signup';
    });
  });

  /* ---------- who tabs ---------- */
  var tabs = $$('.seg [role=tab]'), pill = $('.seg-pill');
  function movePill(b) { pill.style.width = b.offsetWidth + 'px'; pill.style.transform = 'translateX(' + (b.offsetLeft - 5) + 'px)'; }
  function selectTab(b) {
    tabs.forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; var p = document.getElementById(x.getAttribute('aria-controls')); p.hidden = !on; });
    movePill(b); schedule();
  }
  tabs.forEach(function (b, k) {
    b.addEventListener('click', function () { selectTab(b); });
    b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var n = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); selectTab(n); } });
  });
  var pillInit = function () { movePill(tabs[0]); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(pillInit); pillInit();
  addEventListener('resize', function () { var b = tabs.filter(function (x) { return x.getAttribute('aria-selected') === 'true'; })[0]; if (b) movePill(b); });

  /* ---------- reveal-on-view for the bento demos ---------- */
  if ('IntersectionObserver' in window) {
    var rio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); } }); }, { threshold: 0.35 });
    $$('.bx').forEach(function (b) { rio.observe(b); });
  } else $$('.bx').forEach(function (b) { b.classList.add('in'); });
  if (reduce) $$('.bx').forEach(function (b) { b.classList.add('in'); });

  /* ---------- scroll story ---------- */
  var phone = $('#phone'), typeT = $('#typeT'), typed = false;
  var TYPE = 'Vitamin C serum for tired-looking skin, women 25 to 40';
  function typeIt() {
    if (typed) return; typed = true;
    if (reduce) { typeT.textContent = TYPE; return; }
    var k = 0; (function step() { typeT.textContent = TYPE.slice(0, ++k); if (k < TYPE.length) setTimeout(step, 30); })();
  }
  if (phone && 'IntersectionObserver' in window) {
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var s = e.target.getAttribute('data-s');
        $$('.hs').forEach(function (h) { h.classList.toggle('on', h === e.target); });
        phone.setAttribute('data-step', s);
        if (s === '1') typeIt();
        schedule();
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$('.hs').forEach(function (h) { sio.observe(h); });
    $$('.hs')[0].classList.add('on');
  }

  /* ---------- final CTA parallax ---------- */
  var fin = $('.final'), ffs = $$('.ff');
  if (fin && !reduce) {
    var base = ffs.map(function (f) { return getComputedStyle(f).transform; });
    var raf = 0;
    var par = function () {
      raf = 0;
      var r = fin.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var p = (innerHeight - r.top) / (innerHeight + r.height); // 0 → 1 while it crosses the screen
      ffs.forEach(function (f, k) { var d = (k % 2 ? -1 : 1) * (40 + k * 12); f.style.transform = 'translate3d(0,' + ((0.5 - p) * d).toFixed(1) + 'px,0) ' + (base[k] === 'none' ? '' : base[k]); });
    };
    addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(par); }, { passive: true });
  }

  /* ---------- Ban Shield (free tool) ---------- */
  var shf = $('#shForm');
  if (shf) shf.addEventListener('submit', function (e) {
    e.preventDefault();
    var out = $('#shOut'), fix = $('#shFix'), text = $('#shIn').value.trim();
    if (!text) return;
    out.textContent = 'Checking…';
    var done = function (d) {
      var score = Math.max(0, Math.min(100, Math.round(d.score)));
      var col = score >= 80 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
      var n = (d.flags || []).length;
      out.innerHTML = '<span class="score"><span class="ring" style="background:' + col + '">' + score + '</span>' + (n ? n + ' risky ' + (n === 1 ? 'phrase' : 'phrases') + ' found' : 'Looks ad-safe') + '</span>';
      if (d.rewrite && d.rewrite !== text) { fix.hidden = false; fix.innerHTML = '<b>Safer version:</b> ' + esc(d.rewrite); } else fix.hidden = true;
    };
    fetch('/api/public/shield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, niche: 'general' }) })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(done)
      .catch(function () { if (window.VA_SHIELD_LOCAL) done(window.VA_SHIELD_LOCAL(text)); else out.textContent = 'Try again in a moment.'; });
  });

  /* ---------- pricing ---------- */
  var period = 'month', P = window.VA_PRICING_FALLBACK || null;
  var money = function (n) { return '$' + Number(n).toLocaleString('en-US'); };
  var num = function (n) { return Number(n).toLocaleString('en-US'); };
  function renderPricing() {
    if (!P) return;
    var ugc15 = Math.ceil((P.costs.ugc_video_per_second || 15) * 15);
    $('#plans').innerHTML = P.plans.map(function (p) {
      var yearly = period === 'year';
      var price = yearly ? Math.round(p.price_year / 12) : p.price_month;
      var feats = [
        ['Every ad style and all 24 languages', true],
        ['UGC videos up to ' + p.max_ugc_seconds + 's', true],
        ['Product videos up to ' + p.max_video_seconds + 's', true],
        ['AI script writer and angles', !!p.scripts],
        ['No watermark, commercial use', true],
        ['Ban Shield on every script', true],
      ];
      return '<article class="plan' + (p.popular ? ' pop' : '') + '">' + (p.popular ? '<span class="tag">Recommended</span>' : '') +
        '<h3>' + esc(p.name) + '</h3><div class="price"><b>' + money(price) + '</b><span>/ month</span></div>' +
        '<p class="yr">' + (yearly ? money(p.price_year) + ' billed yearly' : 'or ' + money(p.price_year) + ' a year') + '</p>' +
        '<div class="cr"><b>' + num(p.credits_month) + ' credits a month</b>About ' + Math.floor(p.credits_month / ugc15) + ' UGC videos of 15 seconds</div>' +
        '<ul>' + feats.map(function (f) { return '<li' + (f[1] ? '' : ' class="no"') + '>' + esc(f[0]) + '</li>'; }).join('') + '</ul>' +
        '<a class="btn ' + (p.popular ? 'btn-blue' : 'alt') + '" href="' + APP + '?plan=' + encodeURIComponent(p.id) + '&period=' + period + '#signup">Choose ' + esc(p.name) + '</a></article>';
    }).join('');
    var c = P.costs;
    var rows = [['UGC video with an AI actor', (c.ugc_video_per_second || 15) + ' credits / second'], ['Product video or photo to video', (c.video_per_second || 10) + ' credits / second'], ['Image set in 3 sizes', (c.image_3_sizes || 12) + ' credits'], ['20 hooks', (c.hook_pack_20 || 6) + ' credits'], ['10 angles', (c.angles || 6) + ' credits'], ['AI script', (c.script || 8) + ' credits']];
    $('#costTable tbody').innerHTML = rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + (P.free_trial && P.free_trial.credits ? '<tr><td>Free credits when you sign up</td><td>' + num(P.free_trial.credits) + ' credits</td></tr>' : '');
    $('#topups').innerHTML = (P.topups || []).map(function (t) { return '<div class="tu"><b>' + money(t.price) + '</b><span>' + num(t.credits) + ' credits</span></div>'; }).join('');
  }
  $$('.bill button').forEach(function (b) {
    b.addEventListener('click', function () { period = b.getAttribute('data-period'); $$('.bill button').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }); renderPricing(); });
  });
  renderPricing();
  fetch('/api/public/config').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) {
    if (d && d.plans && d.plans.length) { P = { plans: d.plans, topups: d.topups || [], costs: d.costs || P.costs, free_trial: d.free_trial }; renderPricing(); }
  }).catch(function () {});

  /* ---------- showcase picked by the owner (made by Vooads' own pipeline) ---------- */
  fetch('/api/public/showcase').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) {
    var items = (d && d.items) || [];
    if (!items.length) return;
    var track = $('#galTrack');
    var html = items.map(function (x) { return '<article class="gc"><video data-src="' + esc(x.url) + '" muted loop playsinline preload="none"></video><span class="made">Made with Vooads</span><div class="gc-t"><b>' + esc(x.title) + '</b><span>' + esc(x.style || '') + '</span></div></article>'; }).join('');
    track.innerHTML = html + html;
    watchVideos(track);
  }).catch(function () {});

  var yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();
})();
