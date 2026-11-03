// Makes every Vooads eye follow the pointer (and drift when idle), and renders the two-tone wordmark: Voo (ink) + ads (grey).
(function () {
  var root = document.documentElement, last = 0;
  function words() {
    var els = document.querySelectorAll('.lword');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length || !/^vooads$/i.test(el.textContent.trim())) continue;
      el.innerHTML = 'Voo<span>ads</span>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', words); else words();
  new MutationObserver(function () { words(); }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('pointermove', function (e) {
    last = Date.now();
    root.style.setProperty('--px', Math.max(-1, Math.min(1, (e.clientX / innerWidth - 0.5) * 2)).toFixed(2));
    root.style.setProperty('--py', Math.max(-1, Math.min(1, (e.clientY / innerHeight - 0.5) * 2)).toFixed(2));
  }, { passive: true });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var spots = [[0, 0], [-1, -0.4], [1, -0.3], [0.8, 0.6], [-0.7, 0.5], [0, -1]];
  setInterval(function () {
    if (Date.now() - last < 3000) return;
    var p = spots[Math.floor(Math.random() * spots.length)];
    root.style.setProperty('--px', p[0]); root.style.setProperty('--py', p[1]);
  }, 1600);
})();
