/* Vooads website: "Watch with sound".
   Background cards keep autoplaying muted. A sample with a real sound track gets a "Watch with sound" button; it opens a
   lightbox player (full screen on phones) that starts from 0:00 with sound and controls, captions when the sample has a
   caption file, the "Made with Vooads" label, the format name and "Make one like this" (sign-up with that format chosen).
   Only one video plays sound at a time. Escape or a swipe down closes it. Under reduced motion nothing animates and the
   video does not autoplay (the visitor presses play).
   Samples whose format should speak but whose file is silent (waiting for real synced versions) get no sound button. */
(function () {
  'use strict';
  var VIDEO = window.VA_VIDEO || '/samples/';
  var IMG = window.VA_IMG || '/samples/';
  var APP = window.VA_APP || '/app';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // sound: what the file's audio holds (null = no audio track). format: the studio style key for "Make one like this".
  // captions: a <name>.vtt next to the sample.
  var META = {
    'sample-street': { label: 'Street interview', sound: 'voice', format: 'street', captions: true },
    'sample-podcast': { label: 'Podcast clip', sound: 'voice', format: 'podcast', captions: true },
    'sample-founder': { label: 'UGC talking video', sound: 'voice', format: 'ugc', captions: true },
    'sample-savings': { label: 'UGC talking video', sound: 'voice', format: 'ugc', captions: true },
    'sample-cafe': { label: 'Local business promo', sound: 'voice', format: 'cafe', captions: true },
    'sample-fitness': { label: 'UGC talking video', sound: 'voice', format: 'ugc', captions: true },
    'sample-skincare': { label: 'UGC talking video', sound: 'voice', format: 'ugc', captions: true },
    'ugc-podcast-creator': { label: 'UGC talking video', sound: 'voice', format: 'podcast' },
    'ugc-desk-creator': { label: 'UGC creator ad', sound: 'voice', format: 'ugc' },
    'ugc-serum': { label: 'UGC talking video', sound: 'voice', format: 'ugc' },
    'ugc-serum-es': { label: 'UGC talking video, Spanish', sound: 'voice', format: 'ugc' },
    'ugc-protein': { label: 'UGC talking video', sound: 'voice', format: 'ugc' },
    'ugc-saas': { label: 'App ad', sound: 'voice', format: 'ugc' },
    'ugc-fintech': { label: 'App ad', sound: 'voice', format: 'ugc' },
    'ugc-language-app': { label: 'App install ad', sound: 'voice', format: 'ugc' },
    'ugc-sneakers': { label: 'Unboxing', sound: 'voice', format: 'ugc' },
    'ugc-sunscreen': { label: 'UGC talking video', sound: 'voice', format: 'ugc' },
    'ad-skincare-v2': { label: 'Animated ad', sound: 'voice', format: 'ugc' },
    'ad-app-v2': { label: 'App ad', sound: 'voice', format: 'ugc' },
    'ad-explainer-vooads': { label: 'Explainer', sound: 'voice', format: 'ugc' },
    'promo-motion-sample': { label: 'Animated ad', sound: 'voice+music', format: 'product' },
    'biz-cafe-promo': { label: 'Café promo', sound: 'music', format: 'cafe' },
    'biz-real-estate': { label: 'Property tour', sound: 'music', format: 'property' },
    'style-product-headphones': { label: 'Fast-cut product', sound: 'music', format: 'product' }
  };
  window.VA_SOUND_META = META;
  var NOTE = { voice: 'Real AI voice and lip-sync', 'voice+music': 'AI voice-over and music', music: 'Music bed' };

  var box = null, current = null;
  function close() {
    if (!box) return;
    var v = box.querySelector('video'); try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    box.remove(); box = null; document.documentElement.classList.remove('lb-open');
    removeEventListener('keydown', onKey);
    if (current && current.focus) current.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open(name, trigger) {
    var m = META[name]; if (!m || !m.sound) return;
    close();
    current = trigger || null;
    // Only one video with sound: everything else on the page goes back to muted.
    $$('video').forEach(function (v) { v.muted = true; });
    box = document.createElement('div');
    box.className = 'lb' + (reduce ? ' still' : '');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', m.label + ', with sound');
    box.innerHTML = '<div class="lb-in"><div class="lb-top"><span class="lb-made">Made with Vooads</span><b>' + esc(m.label) + '</b><button type="button" class="lb-x" aria-label="Close">×</button></div>' +
      '<video class="lb-v" controls playsinline preload="auto" poster="' + esc(IMG + name + '.webp') + '"' + (reduce ? '' : ' autoplay') + '>' +
      (m.captions ? '<track kind="captions" srclang="en" label="Captions" src="' + esc(VIDEO + name + '.vtt') + '">' : '') + '</video>' +
      '<div class="lb-bot"><span class="lb-note">' + esc(NOTE[m.sound] || '') + (m.captions ? ' · CC for captions' : '') + '</span><a class="btn btn-blue lb-go" href="' + esc(APP + '?format=' + encodeURIComponent(m.format) + '#signup') + '">Make one like this</a></div></div>';
    document.body.appendChild(box);
    document.documentElement.classList.add('lb-open');
    var v = box.querySelector('video');
    v.src = VIDEO + name + '.mp4';
    v.muted = false; v.currentTime = 0;
    if (!reduce) { var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; }); }
    box.querySelector('.lb-x').onclick = close;
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    addEventListener('keydown', onKey);
    // Swipe down to close (phones).
    var y0 = null, inner = box.querySelector('.lb-in');
    inner.addEventListener('touchstart', function (e) { if (e.target.closest('video') && e.touches[0].clientY > inner.getBoundingClientRect().bottom - 80) return; y0 = e.touches[0].clientY; }, { passive: true });
    inner.addEventListener('touchmove', function (e) { if (y0 == null) return; var d = e.touches[0].clientY - y0; if (d > 0 && !reduce) inner.style.transform = 'translateY(' + d + 'px)'; }, { passive: true });
    inner.addEventListener('touchend', function (e) { if (y0 == null) return; var d = (e.changedTouches[0].clientY - y0); y0 = null; inner.style.transform = ''; if (d > 90) close(); });
    box.querySelector('.lb-x').focus();
  }
  window.VA_SOUND = { open: open, close: close };

  // A sound button on every sample card that has sound (not the decorative wall or the face strip).
  function button(name, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'snd' + (cls ? ' ' + cls : '');
    b.setAttribute('aria-label', 'Watch ' + (META[name].label || 'this sample') + ' with sound');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>' + (cls === 'tap' ? 'Tap for sound' : 'Watch with sound') + '</span>';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); open(name, b); });
    return b;
  }
  function enhance() {
    $$('.gc, .rc, [data-sound-card]').forEach(function (card) {
      var v = card.querySelector('video[data-v]'); if (!v || card.querySelector('.snd') || card.getAttribute('aria-hidden') === 'true') return;
      var n = v.getAttribute('data-v'); if (!META[n] || !META[n].sound) return;
      card.appendChild(button(n));
    });
    // Hero: the chip follows the featured video that is showing.
    var frame = document.querySelector('.feature-frame');
    if (frame && !frame.querySelector('.snd')) {
      var chip = null, shown = null;
      var sync = function () {
        var on = frame.querySelector('video.fv.on'); var n = on && on.getAttribute('data-v');
        if (n === shown) return; // only when the featured sample changes
        shown = n;
        if (chip) chip.remove(); chip = null;
        if (n && META[n] && META[n].sound) { chip = button(n, 'tap'); frame.appendChild(chip); }
      };
      sync();
      if ('MutationObserver' in window) new MutationObserver(sync).observe(frame, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance); else enhance();
})();
