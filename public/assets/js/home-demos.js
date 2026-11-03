// Homepage live demos: example feed, drawn format scenes, Change background, Auto-edit, Brand music studio,
// quality levels, language cycler and Coach Vee. Inline SVG + CSS; motion is transform/opacity only.
// Every loop runs only while its block is on screen, and prefers-reduced-motion shows a still, finished state.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var TN = window.VooToons;
  var I = window.VooUI ? VooUI.icon : function () { return ''; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Visibility: adds .off while a block is off screen (CSS pauses its animations) and lets loops wait for it.
  var seen = new WeakMap();
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { seen.set(e.target, e.isIntersecting); e.target.classList.toggle('off', !e.isIntersecting); });
  }, { rootMargin: '80px' }) : null;
  function watch(el) { if (!el) return; if (io) { seen.set(el, false); io.observe(el); } else seen.set(el, true); }
  async function onScreen(el) { while (!seen.get(el)) await sleep(250); }
  // Wait ms, but hold the clock while the block is off screen.
  async function wait(el, ms) { var left = ms; while (left > 0) { await onScreen(el); var step = Math.min(left, 200); await sleep(step); left -= step; } }
  var person = function (who, cls, pose) { return TN && TN.person ? TN.person({ who: who, cls: cls || 'talking', pose: pose || 'idle' }) : ''; };

  /* ---------- drawn scenes on the format cards ---------- */
  if (TN && TN.typeScene) {
    $$('.tsc[data-scene]').forEach(function (el) { el.innerHTML = TN.typeScene(el.dataset.scene); });
    if (TN.watchScenes) TN.watchScenes(document.body);
  }
  $$('.tsc:not([data-scene])').forEach(function (el) { if (io) io.observe(el); });

  /* ---------- example feed (clearly labelled examples) ---------- */
  var FEED = [
    ['sound', 'Brand jingle', '30s · sings “Lumi” · Afrobeats'],
    ['ugc', 'UGC talking video', '15s · Spanish (MX)'],
    ['mic', 'Podcast clip', '30s · English (UK)'],
    ['image', 'Change background', 'kitchen → beach'],
    ['film', 'Auto-edit', '4 min raw → 32s, captions on'],
    ['globe', 'Dub', 'English → Portuguese (BR), lip-synced'],
    ['hooks', 'Hook pack', '20 hooks · French'],
    ['imgvid', 'Photo to video', '10s · sneakers'],
    ['spark', 'Animated ad', 'Ultra · 15s · 1:1'],
    ['sound', 'Brand track', 'instrumental · 60s · cinematic'],
    ['ugc', 'Green-screen reaction', '20s · German'],
    ['remix', 'Hook remix', '5 new openings on a winner'],
    ['slides', 'Slideshow ad', '30s · Swahili'],
    ['image', 'Image set', '1:1 · 4:5 · 9:16'],
  ];
  var feedT = $('#feedT');
  if (feedT) {
    var one = FEED.map(function (f) { return '<span class="fi"><span class="fi-ic">' + I(f[0], 14) + '</span><b>' + esc(f[1]) + '</b><span>' + esc(f[2]) + '</span></span>'; }).join('');
    feedT.innerHTML = one + '<span aria-hidden="true" class="fdup">' + one + '</span>';
    watch($('#feed'));
  }

  /* ---------- Change background ---------- */
  (function bgSwap() {
    var root = $('#dmBg'); if (!root) return;
    $('#bgxP').innerHTML = '<svg viewBox="0 0 140 174" aria-hidden="true">' + person('maya', 'talking', 'idle') + '</svg>';
    var L = $$('.bgx-l', root), sw = $$('#bgxSw i'), name = $('#bgxName'), i = 0;
    function show(k) {
      L.forEach(function (l, j) { l.classList.toggle('on', j === k); });
      sw.forEach(function (s, j) { s.classList.toggle('on', j === k); });
      name.textContent = L[k].dataset.bg; name.classList.remove('flip'); void name.offsetWidth; name.classList.add('flip');
    }
    watch(root);
    if (reduce) return;
    (async function loop() { while (true) { await wait(root, 2600); i = (i + 1) % L.length; show(i); } })();
  })();

  /* ---------- Auto-edit ---------- */
  (function autoEdit() {
    var root = $('#dmAe'); if (!root) return;
    $('#aexWho').innerHTML = person('kofi', 'talking', 'idle');
    // Raw voice track: clips with silences and filler words between them (percent of the track width).
    var SEG = [['c', 16], ['g', 7, 'um'], ['c', 21], ['g', 10, 'pause'], ['c', 13], ['g', 6, 'uh'], ['c', 17]];
    var clips = $('#aexClips'), x = 0;
    clips.innerHTML = SEG.map(function (s) { var h = '<i class="' + (s[0] === 'c' ? 'ck' : 'gp') + '" style="left:' + x + '%;width:' + s[1] + '%">' + (s[2] ? '<em>' + s[2] + '</em>' : '') + '</i>'; x += s[1]; return h; }).join('');
    $('#aexMu').innerHTML = new Array(30).join('.').split('.').map(function (_, k) { return '<i style="--k:' + k + ';--h:' + (0.35 + ((k * 37) % 11) / 16).toFixed(2) + '"></i>'; }).join('');
    var F = $('#aexF'), S = $('#aexS'), cap = $('#aexCap'), ar = $('#aexAr'), st = $('#aexSt'), ph = $('#aexPh'), mu = $('#aexMu');
    var parts = $$('#aexClips i');
    var CAP = ['This', 'serum', 'changed', 'my', 'skin', 'in', 'two', 'weeks.'];
    function status(t, done) { st.innerHTML = (done ? '<span class="ok">' + I('check', 14, 3) + '</span>' : '<span class="spinner"></span>') + '<span>' + esc(t) + '</span>'; st.classList.toggle('done', !!done); }
    function reset() {
      F.classList.remove('vert', 'end'); S.classList.remove('zoom'); mu.classList.remove('duck'); cap.textContent = ''; cap.classList.remove('on'); ar.textContent = '16:9';
      parts.forEach(function (p) { p.style.transform = ''; p.classList.remove('mark', 'cut'); });
      ph.classList.remove('go'); status('Reading your footage');
    }
    function closeGaps() {
      var w = clips.offsetWidth, shift = 0;
      parts.forEach(function (p, k) { var s = SEG[k]; if (s[0] === 'g') { p.classList.add('cut'); shift += s[1] / 100 * w; } else p.style.transform = 'translateX(' + (-shift) + 'px)'; });
    }
    function finalState() { closeGaps(); F.classList.add('vert', 'end'); mu.classList.add('duck'); cap.textContent = 'weeks.'; cap.classList.add('on'); ar.textContent = '9:16'; status('Edited. 4:12 raw → 0:32, ready to post', true); }
    watch(root);
    if (reduce) { finalState(); return; }
    (async function loop() {
      while (true) {
        reset(); await wait(root, 700);
        ph.classList.add('go'); status('Finding silences and filler words'); await wait(root, 900);
        parts.forEach(function (p, k) { if (SEG[k][0] === 'g') p.classList.add('mark'); }); await wait(root, 1100);
        status('Cutting 3 gaps'); closeGaps(); await wait(root, 1000);
        status('Adding captions in your brand colour');
        for (var k = 0; k < CAP.length; k++) { cap.textContent = CAP[k]; cap.classList.remove('on'); void cap.offsetWidth; cap.classList.add('on'); await wait(root, 330); if (k === 3) S.classList.add('zoom'); }
        status('Punch-in zoom on the key line'); await wait(root, 700); S.classList.remove('zoom');
        status('Music ducked under your voice'); mu.classList.add('duck'); await wait(root, 1000);
        status('Reframing for Reels and TikTok'); F.classList.add('vert'); ar.textContent = '9:16'; await wait(root, 1300);
        F.classList.add('end'); status('Edited. 4:12 raw → 0:32, ready to post', true); await wait(root, 3200);
      }
    })();
  })();

  /* ---------- Brand music studio ---------- */
  (function music() {
    var root = $('#mux'); if (!root) return;
    var PROMPT = 'Upbeat Afro-pop, 30s, sing ‘Vooads’';
    var eq = $('#muxEq'), wv = $('#muxWv');
    eq.innerHTML = new Array(29).join('.').split('.').map(function (_, k) { return '<i style="--k:' + k + ';--d:' + (-((k * 53) % 9) / 10) + 's"></i>'; }).join('');
    var H = []; for (var k = 0; k < 46; k++) { var v = 0.28 + 0.62 * Math.abs(Math.sin(k * 1.7) * Math.cos(k * 0.43)); H.push(v.toFixed(2)); }
    wv.innerHTML = H.map(function (h) { return '<i style="--h:' + h + '"></i>'; }).join('');
    var typeEl = $('#muxType'), G = $$('#muxGenres span'), LEN = $$('#muxLen span'), VOX = $$('#muxVox span'), gen = $('#muxGen'), pr = $('#muxPr'), gs = $('#muxGs'), trk = $('#muxTrk'), ly = $$('#muxLy span'), bars = $$('#muxWv i');
    function set(list, k) { list.forEach(function (x, j) { x.classList.toggle('on', j === k); }); }
    function reset() {
      typeEl.textContent = ''; set(G, -1); set(LEN, -1); set(VOX, -1); root.classList.remove('gen', 'ready', 'saved', 'play', 'press');
      pr.style.transform = 'scaleX(0)'; bars.forEach(function (b) { b.classList.remove('p'); }); ly.forEach(function (w) { w.classList.remove('on'); });
    }
    function finalState() { typeEl.textContent = PROMPT; set(G, 0); set(LEN, 1); set(VOX, 1); root.classList.add('ready', 'saved'); bars.forEach(function (b, j) { b.classList.toggle('p', j < 20); }); ly.forEach(function (w) { w.classList.add('on'); }); }
    watch(root);
    if (reduce) { finalState(); return; }
    (async function loop() {
      while (true) {
        reset(); await wait(root, 600);
        for (var c = 0; c < PROMPT.length; c++) { typeEl.textContent = PROMPT.slice(0, c + 1); await wait(root, 48); }
        await wait(root, 300);
        for (var g = 0; g < 3; g++) { set(G, [2, 1, 0][g]); await wait(root, 260); }
        await wait(root, 200); set(LEN, 1); await wait(root, 380); set(VOX, 1); await wait(root, 500);
        root.classList.add('press'); await wait(root, 260); root.classList.remove('press');
        root.classList.add('gen'); gs.textContent = 'Writing the melody';
        requestAnimationFrame(function () { pr.style.transform = 'scaleX(1)'; });
        await wait(root, 1000); gs.textContent = 'Singing your brand name'; await wait(root, 1000); gs.textContent = 'Mixing and mastering'; await wait(root, 900);
        root.classList.remove('gen'); root.classList.add('ready', 'play');
        var per = 150, wpb = Math.floor(bars.length / ly.length);
        for (var b = 0; b < bars.length; b++) {
          bars[b].classList.add('p');
          var wi = Math.floor(b / wpb); if (ly[wi]) ly[wi].classList.add('on');
          if (b === 14) root.classList.add('saved');
          await wait(root, per);
        }
        root.classList.remove('play'); await wait(root, 2200);
      }
    })();
  })();

  /* ---------- Quality levels: the same scene, more real at each level ---------- */
  (function quality() {
    var tiles = $$('#qls .ql'); if (!tiles.length) return;
    var who = person('maya', 'talking', 'idle');
    var uid = 0;
    function scene(level) {
      var u = 'q' + (++uid), d = '<defs>', bg = '', fx = '';
      if (level === 0) {
        bg = '<rect width="160" height="200" fill="#FFEDE6"/><rect y="150" width="160" height="50" fill="#F6DDD0"/>';
      } else if (level === 1) {
        // Pro: a real room, soft key light from the window, gentle shadow on the far side.
        d += '<radialGradient id="' + u + 'w" cx="28%" cy="22%" r="95%"><stop offset="0" stop-color="#FFF3E8"/><stop offset=".6" stop-color="#EBCDB6"/><stop offset="1" stop-color="#B98E70"/></radialGradient>' +
          '<radialGradient id="' + u + 'k" cx="34%" cy="34%" r="40%"><stop offset="0" stop-color="#FFF8F0" stop-opacity=".35"/><stop offset="1" stop-color="#FFF8F0" stop-opacity="0"/></radialGradient>' +
          '<linearGradient id="' + u + 'r" x1="0" x2="1"><stop offset=".5" stop-color="#3B2219" stop-opacity="0"/><stop offset="1" stop-color="#3B2219" stop-opacity=".3"/></linearGradient>';
        bg = '<rect width="160" height="200" fill="url(#' + u + 'w)"/><rect x="108" y="20" width="38" height="62" rx="3" fill="#FFF7EE" opacity=".7"/><path d="M127 20v62M108 51h38" stroke="#D9B79C" stroke-width="1.5"/><rect x="10" y="96" width="26" height="54" rx="3" fill="#C99A78" opacity=".55"/><circle cx="23" cy="88" r="11" fill="#7C9A6E" opacity=".75"/><rect y="150" width="160" height="50" fill="#A9805F" opacity=".5"/><ellipse cx="80" cy="198" rx="64" ry="9" fill="#3B2219" opacity=".25"/>';
        fx = '<rect width="160" height="200" fill="url(#' + u + 'k)"/><rect x="0" y="0" width="160" height="200" fill="url(#' + u + 'r)"/>';
      } else {
        // Ultra: low-key cinematic set, warm practical lights out of focus, rim light, grade, vignette and grain.
        d += '<radialGradient id="' + u + 'w" cx="70%" cy="30%" r="90%"><stop offset="0" stop-color="#5A3826"/><stop offset=".55" stop-color="#2E1C13"/><stop offset="1" stop-color="#140C08"/></radialGradient>' +
          '<filter id="' + u + 'b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.4"/></filter>' +
          '<radialGradient id="' + u + 'k" cx="38%" cy="36%" r="38%"><stop offset="0" stop-color="#FFE2C4" stop-opacity=".28"/><stop offset="1" stop-color="#FFE2C4" stop-opacity="0"/></radialGradient>' +
          '<linearGradient id="' + u + 'rim" x1="0" x2="1"><stop offset=".62" stop-color="#FF8A3C" stop-opacity="0"/><stop offset=".9" stop-color="#FF8A3C" stop-opacity=".32"/><stop offset="1" stop-color="#FF8A3C" stop-opacity="0"/></linearGradient>' +
          '<linearGradient id="' + u + 'sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".45" stop-color="#000" stop-opacity="0"/></linearGradient>' +
          '<radialGradient id="' + u + 'v" cx="50%" cy="45%" r="72%"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>' +
          '<filter id="' + u + 'n"><feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter>';
        bg = '<rect width="160" height="200" fill="url(#' + u + 'w)"/>' +
          '<g filter="url(#' + u + 'b)"><circle cx="124" cy="46" r="10" fill="#FFB65C" opacity=".85"/><circle cx="146" cy="78" r="7" fill="#FF8A3C" opacity=".7"/><circle cx="22" cy="34" r="8" fill="#FFD9A0" opacity=".55"/><circle cx="44" cy="62" r="5" fill="#FF9F5C" opacity=".5"/><circle cx="104" cy="22" r="5" fill="#FFE3B0" opacity=".6"/><circle cx="14" cy="104" r="6" fill="#FFB65C" opacity=".4"/></g>' +
          '<rect y="156" width="160" height="44" fill="#0E0805" opacity=".55"/>';
        fx = '<rect width="160" height="200" fill="url(#' + u + 'sh)"/><rect width="160" height="200" fill="url(#' + u + 'rim)"/><rect width="160" height="200" fill="url(#' + u + 'k)"/><rect width="160" height="200" fill="#FF6A1C" opacity=".07"/><rect width="160" height="200" fill="url(#' + u + 'v)"/><rect class="ql-grain" width="160" height="200" filter="url(#' + u + 'n)" opacity=".12"/>';
      }
      return d + '</defs>' + bg + '<g transform="translate(10 28)">' + who + '</g>' + fx;
    }
    tiles.forEach(function (t, k) { $('.qls-svg', t).innerHTML = scene(k); });
    watch($('#qls'));
  })();

  /* ---------- Words: one hook, written for each market ---------- */
  (function langs() {
    var K = $('#wlK'), T = $('#wlT'); if (!K) return;
    var L = [['EN · US', 'I almost returned this serum…'], ['ES · MX', 'Casi devuelvo este sérum…'], ['PT · BR', 'Quase devolvi esse sérum…'], ['FR · FR', 'J’ai failli renvoyer ce sérum…'], ['DE · DE', 'Fast hätte ich das Serum zurückgeschickt…'], ['HI · IN', 'मैंने ये सीरम लगभग लौटा ही दिया था…'], ['AR · AE', 'كدت أعيد هذا السيروم…'], ['PCM · NG', 'I nearly return this serum o…']];
    var box = K.parentNode, i = 1;
    watch(box);
    if (reduce) return;
    (async function loop() {
      while (true) {
        await wait(box, 2200);
        box.classList.add('out'); await sleep(260);
        K.textContent = L[i][0]; T.textContent = L[i][1]; T.dir = /^AR/.test(L[i][0]) ? 'rtl' : 'ltr';
        box.classList.remove('out'); i = (i + 1) % L.length;
      }
    })();
  })();

  /* ---------- Coach Vee ---------- */
  var cv = $('#coachV'); if (cv && TN && TN.coach) { cv.innerHTML = TN.coach({ talk: true }); watch(cv); }
})();
