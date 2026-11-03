/* Vooads "idea → video": a short demo under the prompt box. When it first scrolls into view, the idea types in, four steps
   tick in (Script, Actor & voice, Edit, Captions & music) and a phone frame reveals a real sample, which plays once, muted,
   and rests on its last frame. Picking another idea chip re-runs it with that idea's sample. Under reduced motion it shows the
   finished state with no animation and no autoplay. Used on the website hero and the studio's empty "New ad" page.
   VooI2V.mount(el, { base: '/samples/', key: 'cafe' }) → { show(key, text) } */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var IDEAS = {
    cafe: { text: 'A café promo for our new oat latte, first one half price', v: 'sample-cafe' },
    boutique: { text: 'Weekend sale at my boutique, 30% off knitwear', v: 'biz-fashion-boutique' },
    app: { text: 'An app ad: how she saved more in three months', v: 'sample-savings' },
    realestate: { text: 'A calm tour of a bright three-bedroom home for sale', v: 'biz-real-estate' },
    fitness: { text: 'A fitness creator with our chocolate protein shake', v: 'sample-fitness' }
  };
  // Small line icons (stroke only), then the check that replaces each one when the step is done.
  var P = { script: 'M7 4h7l4 4v12H7zM14 4v4h4M9.5 12h5M9.5 15.5h5', actor: 'M12 12a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM6 19.5c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6', edit: 'M6.5 7.5a2 2 0 1 0 0-.01M6.5 16.5a2 2 0 1 0 0-.01M8.3 8.6 18 17M8.3 15.4 18 7', captions: 'M4.5 6.5h15v11h-15zM8 11.2h3M13 11.2h3M8 14h8', check: 'M6 12.5l4 4 8-9' };
  var ic = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[k] + '"/></svg>'; };
  var STEPS = [['script', 'Script'], ['actor', 'Actor & voice'], ['edit', 'Edit'], ['captions', 'Captions & music']];

  function keyFor(text) {
    var t = String(text || '').toLowerCase();
    if (/caf|coffee|latte|restaurant|food|bakery/.test(t)) return 'cafe';
    if (/boutique|fashion|knit|dress|shop|sale|cloth/.test(t)) return 'boutique';
    if (/app|software|saas|budget|saving|fintech|install/.test(t)) return 'app';
    if (/home|house|property|estate|apartment|tour/.test(t)) return 'realestate';
    if (/fit|gym|protein|workout|shake/.test(t)) return 'fitness';
    return null;
  }

  function mount(el, opts) {
    opts = opts || {};
    var base = opts.base || '/samples/';
    el.classList.add('i2v');
    el.innerHTML = '<div class="i2v-l"><p class="i2v-idea"><span class="i2v-k">Your idea</span><span class="i2v-t" aria-live="polite"></span></p>' +
      '<ol class="i2v-steps">' + STEPS.map(function (s) { return '<li data-s="' + s[0] + '"><span class="i2v-ic">' + ic(s[0]) + '</span><span>' + esc(s[1]) + '</span><span class="i2v-ok">' + ic('check') + '</span></li>'; }).join('') + '</ol>' +
      '<p class="i2v-note">About two minutes for a 15-second ad. Change anything after by chat.</p></div>' +
      '<figure class="i2v-phone"><video muted playsinline preload="none" aria-label="Example video made with Vooads"></video><figcaption>Made with Vooads</figcaption></figure>';
    var tEl = el.querySelector('.i2v-t'), steps = [].slice.call(el.querySelectorAll('.i2v-steps li')), phone = el.querySelector('.i2v-phone'), v = phone.querySelector('video');
    var timers = [], run = 0, seen = false, cur = opts.key || 'cafe';
    var clear = function () { timers.forEach(clearTimeout); timers = []; };
    var at = function (ms, fn) { timers.push(setTimeout(fn, ms)); };
    var setVideo = function (name, play) {
      v.pause(); v.poster = base + name + '.webp';
      if (v.getAttribute('data-n') !== name) { v.setAttribute('data-n', name); v.src = base + name + '.mp4'; }
      try { v.currentTime = 0; } catch (e) {}
      if (play && !reduce) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    };
    var finalState = function (idea) {
      tEl.textContent = idea.text;
      steps.forEach(function (s) { s.classList.add('done'); });
      phone.classList.add('on');
      setVideo(idea.v, false);
    };
    var play = function (key, text) {
      var idea = IDEAS[key] || IDEAS.cafe, my = ++run;
      cur = key; clear();
      if (text) idea = { text: text, v: idea.v };
      if (reduce) return finalState(idea);
      steps.forEach(function (s) { s.classList.remove('done'); });
      phone.classList.remove('on');
      tEl.textContent = '';
      var s = idea.text, n = 0, step = Math.max(14, Math.min(32, 1400 / s.length));
      (function type() { if (my !== run) return; n++; tEl.textContent = s.slice(0, n); if (n < s.length) at(step, type); else afterType(); })();
      function afterType() {
        steps.forEach(function (li, i) { at(320 + i * 380, function () { if (my === run) li.classList.add('done'); }); });
        at(320 + steps.length * 380 + 120, function () { if (my !== run) return; phone.classList.add('on'); setVideo(idea.v, true); });
      }
    };
    // Plays once; rests on the last frame (the Vooads end card).
    v.addEventListener('ended', function () { v.pause(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var e = es[0];
        if (e.isIntersecting && !seen) { seen = true; play(cur); }
        else if (!e.isIntersecting && !v.paused) v.pause();
      }, { threshold: 0.35 }).observe(el);
    } else { seen = true; play(cur); }
    if (reduce) finalState(IDEAS[cur]);
    return {
      show: function (key, text) { if (!IDEAS[key]) return; if (!seen) { cur = key; if (reduce) finalState(IDEAS[key]); return; } play(key, text); },
      keyFor: keyFor
    };
  }
  window.VooI2V = { mount: mount, keyFor: keyFor, IDEAS: IDEAS };
})();
