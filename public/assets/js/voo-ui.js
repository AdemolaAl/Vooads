/* Image fallbacks without inline handlers (the CSP has no 'unsafe-inline'): data-fallback swaps in another src once,
   data-gone removes the image when it does not load. */
document.addEventListener('error', function (e) {
  var t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.getAttribute('data-fallback')) { var f = t.getAttribute('data-fallback'); t.removeAttribute('data-fallback'); t.src = f; }
  else if (t.hasAttribute('data-gone')) t.remove();
}, true);
// Shared UI helpers for the Vooads site, studio and trainer: line icons, resilient media loading and support agents.
(function () {
  'use strict';
  var P = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowUR: '<path d="M7 17 17 7M8 7h9v9"/>',
    play: '<path d="M7 5.5v13a.8.8 0 0 0 1.2.7l10.6-6.5a.8.8 0 0 0 0-1.4L8.2 4.8A.8.8 0 0 0 7 5.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    shield: '<path d="M12 3l7.5 3v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/>',
    ugc: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><circle cx="12" cy="9.5" r="2.3"/><path d="M8.8 16c.7-1.6 1.8-2.4 3.2-2.4s2.5.8 3.2 2.4"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.3 4.6 2.7-4.6 2.7z"/>',
    slides: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M19 8v8M21.5 10v4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
    imgvid: '<rect x="3" y="4" width="13" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.4"/><path d="m16 13-3.5-3.5L6 16M18 10l3-1.6v7.2L18 14"/>',
    hooks: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    script: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    remix: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M20 7v3M4 17v-3"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
    gift: '<path d="M20 12v8H4v-8M2.5 7.5h19v4.5h-19zM12 21V7.5"/><path d="M12 7.5H8a2.3 2.3 0 1 1 0-4.6c2.8 0 4 4.6 4 4.6zM12 7.5h4a2.3 2.3 0 1 0 0-4.6c-2.8 0-4 4.6-4 4.6z"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
    chat: '<path d="M20.5 12a8 8 0 0 1-11.6 7.1L3.5 20.5l1.4-5A8 8 0 1 1 20.5 12z"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-1.5 2.5-4 2.5h-2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.3 7.1l-.1-.1A2 2 0 1 1 7 4.2l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.2 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.2z"/>',
    home: '<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    library: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    learn: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.5 1.4 3.4 2 5.5 2s4-.6 5.5-2V11M21.5 9v5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    chevronD: '<path d="m6 9 6 6 6-6"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    cc: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>',
    upload: '<path d="M12 16V5M7 9.5l5-5 5 5M4.5 20h15"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
    send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    stitch: '<path d="M3 12h4M10 12h4M17 12h4"/><path d="M7 8v8M14 8v8"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    ticket: '<path d="M3.5 8.5V6a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 6v2.5a3.5 3.5 0 0 0 0 7V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18v-2.5a3.5 3.5 0 0 0 0-7z"/><path d="M14 5v14" stroke-dasharray="2 2.5"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
    credits: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  };
  function icon(name, size, sw) {
    return '<svg class="ic ic-' + name + '" viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  }
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  // Videos: <div class="media"><video muted loop playsinline preload="metadata" data-src="..."></video></div>
  // Loads when near the viewport, plays only while visible, marks .ok/.err on the frame so a missing file still looks intentional.
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
        if (!v.dataset.noauto && !reduce) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      } else if (!v.paused) v.pause();
    });
  }, { rootMargin: '160px' }) : null;
  function frameOf(el) { return el.closest('.media') || el.parentElement; }
  function media(rootEl) {
    var r = rootEl || document;
    Array.prototype.forEach.call(r.querySelectorAll('video[data-src]:not([data-w])'), function (v) {
      v.setAttribute('data-w', '1'); v.muted = true; v.playsInline = true;
      if (!v.getAttribute('preload')) v.setAttribute('preload', 'metadata');
      var f = frameOf(v);
      v.addEventListener('loadeddata', function () { if (f) { f.classList.add('ok'); f.classList.remove('err'); } });
      v.addEventListener('error', function () { if (f) f.classList.add('err'); });
      if (io) io.observe(v); else v.src = v.dataset.src;
    });
    Array.prototype.forEach.call(r.querySelectorAll('.media img:not([data-w])'), function (im) {
      im.setAttribute('data-w', '1');
      var f = frameOf(im);
      var ok = function () { if (f) f.classList.add('ok'); }, bad = function () { if (f) f.classList.add('err'); };
      if (im.complete) { if (im.naturalWidth) ok(); else if (im.getAttribute('src')) bad(); }
      im.addEventListener('load', ok); im.addEventListener('error', bad);
    });
  }

  // Human support team (photos generated for Vooads). Falls back to warm initials if a photo is missing.
  var AGENTS = [
    { img: '/samples/support-agent-1.webp', c: '#E9D7C6' },
    { img: '/samples/support-agent-2.webp', c: '#D6E0CF' },
    { img: '/samples/support-agent-3.webp', c: '#DED5E8' },
  ];
  function agent(i, size, cls) {
    var a = AGENTS[Math.abs(i) % AGENTS.length];
    return '<span class="agent ' + (cls || '') + '" style="--s:' + (size || 40) + 'px;--c:' + a.c + '"><b>' + icon('user', Math.round((size || 40) * .5), 1.6) + '</b><img src="' + a.img + '" alt="Vooads support" loading="lazy" data-gone="1"></span>';
  }
  function agentsStack(size) { return '<span class="agents">' + [0, 1, 2].map(function (i) { return agent(i, size); }).join('') + '</span>'; }

  window.VooUI = { icon: icon, media: media, agent: agent, agentsStack: agentsStack, AGENTS: AGENTS, reduce: reduce };
})();
