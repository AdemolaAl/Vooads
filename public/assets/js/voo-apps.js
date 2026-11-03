// Zedapex "Voo family" app cards with their logos and live animations. Shared by the website and the studio.
// Change APP_LINKS to point each button at the real product page.
(function () {
var APP_LINKS = { Joinvoo: 'https://voosquare.com', Replyvoo: 'https://voosquare.com', Castvoo: 'https://voosquare.com', Affleego: 'https://voosquare.com', Landvoo: 'https://voosquare.com', VooSquare: 'https://voosquare.com' };
const LOGO={
 jv:['linear-gradient(150deg,#7759FF,#4426DE)','<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><circle cx="8.6" cy="12" r="5"/><circle cx="15.4" cy="12" r="5"/></svg>'],
 rv:['#121110','<svg viewBox="0 0 24 24"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="#FFC21A"/><circle cx="8.5" cy="11" r="1.5" fill="#121110"/><circle cx="12" cy="11" r="1.5" fill="#121110"/><circle cx="15.5" cy="11" r="1.5" fill="#121110"/></svg>'],
 cv:['linear-gradient(150deg,#5583FF,#2345DE)','<svg viewBox="0 0 24 24" fill="none"><path d="M16 7.2A6.6 6.6 0 1 0 16 16.8" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><circle cx="18.6" cy="12" r="2.1" fill="#fff"/></svg>'],
 af:['#FFE15C','<svg viewBox="0 0 24 24"><path d="M12 3.5 4.6 20.5h3.6l1.5-3.7h4.6l1.5 3.7h3.6L12 3.5zm-1.2 10.2L12 10.4l1.2 3.3z" fill="#121110"/></svg>'],
 lv:['linear-gradient(150deg,#FF86BC,#DD3F88)','<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 10h17M7.5 14.5h6"/></svg>'],
 vs:['linear-gradient(150deg,#1BD089,#067A47)','<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2.2" fill="#fff"/><rect x="13" y="3" width="8" height="8" rx="2.2" fill="#C6EEDB"/><rect x="3" y="13" width="8" height="8" rx="2.2" fill="#C6EEDB"/><rect x="13" y="13" width="8" height="8" rx="2.2" fill="#C8F25C"/></svg>'],
 va:['#121110','<svg viewBox="0 0 24 24"><circle cx="7.6" cy="12" r="4.3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16.4" cy="12" r="4.3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="8.4" cy="12" r="1.9" fill="#FF4A1C"/><circle cx="17.2" cy="12" r="1.9" fill="#FF4A1C"/></svg>'],
};
const logo=k=>`<span class="vlogo" style="background:${LOGO[k][0]}" aria-hidden="true">${LOGO[k][1]}</span>`;
function stage(k){
 if(k==="jv")return `<div class="stg" aria-hidden="true"><span class="jvline"></span><span class="jvok">Real joins → Meta <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span class="jvbad">Fakes blocked</span>${[["A","#F2C9A8",18,0],["K","#C9DDF2",58,-1.5],["M","#D8F2C9",36,-3],["T","#F2D9C9",72,-4.5]].map(a=>`<span class="jva" style="top:${a[2]}%;animation-delay:${a[3]}s;background:${a[1]}">${a[0]}</span>`).join("")}${[[28,-1],[50,-4.5]].map(a=>`<span class="jva bot" style="top:${a[0]}%;animation-delay:${a[1]}s"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#7A1F1F" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></span>`).join("")}</div>`;
 if(k==="rv")return `<div class="stg" aria-hidden="true"><div class="rvs"><div class="rvq">How much is the black dress?</div><div class="rvslot"><div class="rvt"><i></i><i></i><i></i></div><div class="rva">$49 with free delivery. Want the payment link?</div></div><div class="rvp"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg> Paid · $49</div></div></div>`;
 if(k==="cv")return `<div class="stg" aria-hidden="true"><div class="cvs" style="bottom:30px"><div class="cvmsg">New lesson is live<small>Drip · Day 3</small></div><div class="cvrows">${["A","J","M","S"].map((e,i)=>`<div class="cvr" style="--d:${i*.25}s"><span class="cvln"><i></i></span><span class="av2">${e}</span><span class="tk"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span></div>`).join("")}</div></div><span class="cnt">2,418 delivered</span><div class="cvdrip">${["Day 1","Day 3","Day 7"].map((d,i)=>`<span style="--d:${i*2}s">${d}</span>`).join("")}</div></div>`;
 if(k==="af"){const rows=[["P","Prop firm challenge","Trading · Global","$120 CPA","#4426DE"],["S","Sportsbook","Betting · LATAM","$85 CPA","#0E7A44"],["C","Crypto exchange","Crypto · Global","40% rev share","#E8390C"],["V","VPN app","Apps · Tier 1","$9 CPI","#121110"]].map(r=>`<div class="afr"><span class="i" style="background:${r[4]}">${r[0]}</span><div style="min-width:0"><b>${r[1]}</b><small>${r[2]}</small></div><span class="pay">${r[3]}</span><span class="jn">Join</span></div>`).join("");return `<div class="stg" aria-hidden="true"><div class="afs"><div class="aftr">${rows}${rows}</div></div></div>`}
 if(k==="lv")return `<div class="stg" aria-hidden="true"><div class="lvs"><div class="lvnav" style="--d:0s"><i></i><i></i><i></i></div><div class="lvhero" style="--d:.5s"><div class="t"><i></i><i></i><i></i></div><div class="im"></div></div><span class="lvbtn" style="--d:1s">Get started</span></div><span class="lvcv">Conversion 12.4%</span></div>`;
 return ""}
const APPS=[
 {k:"jv",name:"Joinvoo",tag:"Track",h:"Track every lead.<br>Kill every fake.",p:"Tracks every real Telegram join, sign-up and deposit and feeds it back to Meta, TikTok and Snapchat, so your ads buy quality, not noise.",w:"Put a Joinvoo tracking link on your Vooads ads to see which creative brings real joins and deposits.",chip:"First 500 joins free",bb:"#fff",bc:"#4426DE"},
 {k:"rv",name:"Replyvoo",tag:"Convert",h:"Sky-rocket your sales.<br>On autopilot.",p:"AI Closers answer every chat in seconds, qualify every lead and send the payment link while you sleep.",w:"Your Vooads traffic lands in chats. Replyvoo answers every one of them, day and night.",chip:"30 free chats a month",bb:"#FFC21A",bc:"#121110"},
 {k:"cv",name:"Castvoo",tag:"Retain",h:"Turn your Telegram into a sales machine.",p:"Welcomes every new subscriber, follows up on time and sends each group the message written for them.",w:"Reuse your best Vooads hooks as broadcasts and drip messages.",chip:"7 days free",bb:"#fff",bc:"#2345DE"},
 {k:"af",name:"Affleego",tag:"Monetize",h:"Find offers that pay.<br>Run them in minutes.",p:"Our affiliate deals platform. Pick top-paying offers in trading, betting, crypto and apps, all in one place.",w:"Pick an offer, then make its ads in Vooads.",chip:"Voo family",bb:"#121110",bc:"#fff"},
 {k:"lv",name:"Landvoo",tag:"Coming soon",h:"Landing pages that convert.",p:"Fast, tracked landing pages built from one sentence. It's on the way.",w:"Send Vooads traffic to a page built for that exact ad.",chip:"Join the waitlist",bb:"#fff",bc:"#DD3F88",cta:"Get notified"},
];
const pillFor=a=>a.k==="rv"?'<span class="pill" style="background:#FFC21A;color:#121110">'+a.tag+'</span>':a.k==="af"?'<span class="pill ink">'+a.tag+'</span>':'<span class="pill glass2">'+a.tag+'</span>';
const appCard=a=>`<article class="appc ${a.k}"><div class="hd">${logo(a.k)}<b>${a.name}</b>${pillFor(a)}</div><h3>${a.h}</h3><p>${a.p}</p>${stage(a.k)}<div class="with">${logo("va")}<span>${a.w}</span></div><div class="ft"><button class="btn" type="button" data-app="${a.name}" style="background:${a.bb};color:${a.bc}">${a.cta||"Learn more"} <span class="arrow"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></button><span class="chipx">${a.chip}</span></div></article>`;
const vsqHero=()=>`<div class="vsq-hero"><div class="vsq-top"><div class="vsq-tiles" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><h3>Voo<span>Square</span></h3><p style="font-weight:800;color:#D9FF8A;margin-top:4px">Media buying, squared.</p></div></div><p>One Voo ID opens every Voo family tool. See the numbers from all your apps in one dashboard, and use one referral link across all of them.</p><div class="vflow" aria-label="How the Voo apps work together">${[["va","Vooads","Make the ad"],["jv","Joinvoo","Track the join"],["cv","Castvoo","Follow up"],["rv","Replyvoo","Close the sale"],["af","Affleego","Earn more"]].map((n,i)=>`<div class="vfn" style="--i:${i}">${logo(n[0])}<b>${n[1]}</b><small>${n[2]}</small></div>`).join("")}</div><a class="btn" href="https://voosquare.com/#dashboard" target="_blank" rel="noopener">Open VooSquare <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></a></div>`;
const appsBlock=()=>vsqHero()+`<div class="apps">${APPS.map(appCard).join("")}</div>`;
var miniStrip = function (go) { return '<div class="mini-apps">' + [["vs","VooSquare","All your tools and numbers in one dashboard"],["jv","Joinvoo","See which ad brought the sale"],["rv","Replyvoo","AI answers every chat and closes"],["cv","Castvoo","Follow up every subscriber on time"],["af","Affleego","Offers that pay, ready to run"]].map(function (m) { return '<a class="mini ' + m[0] + '" href="' + (APP_LINKS[m[1]] || '#') + '" target="_blank" rel="noopener"><span class="r">' + logo(m[0]) + '<b>' + m[1] + '</b></span><small>' + m[2] + '</small><span class="live">Works with Vooads</span></a>'; }).join('') + '</div>'; };
// Home carousel "Grow with Zedapex apps": one app per slide (two or three on wide screens), auto-advances every 3.5s, loops,
// pauses on hover / touch / when off screen or the tab is hidden, swipes natively (scroll-snap) and drags with a mouse.
// Each slide has a real call to action (APP_LINKS). prefers-reduced-motion: no auto-advance and no entrance motion.
var CAR = [
  { k: 'vs', name: 'VooSquare', tag: 'Your hub', line: 'All your tools and numbers in one dashboard.', chip: 'One Voo ID for every app', cta: 'Open VooSquare' },
  { k: 'jv', name: 'Joinvoo', tag: 'Track', line: 'See which ad brought the join, the sign-up and the sale.', chip: 'First 500 joins free', cta: 'Open Joinvoo' },
  { k: 'rv', name: 'Replyvoo', tag: 'Convert', line: 'AI answers every chat in seconds and sends the payment link.', chip: '30 free chats a month', cta: 'Try Replyvoo free' },
  { k: 'cv', name: 'Castvoo', tag: 'Retain', line: 'Welcomes and follows up every subscriber on time.', chip: '7 days free', cta: 'Start 7 days free' },
  { k: 'af', name: 'Affleego', tag: 'Monetize', line: 'Top-paying offers in trading, betting, crypto and apps.', chip: 'Voo family', cta: 'Browse offers' },
];
var ARW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var carousel = function () {
  return '<div class="vcar" role="region" aria-roledescription="carousel" aria-label="Voo family apps"><div class="vcar-vp" tabindex="0"><div class="vcar-tr">' + CAR.map(function (a, i) {
    return '<article class="vcs ' + a.k + '" role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + CAR.length + ': ' + a.name + '" data-i="' + i + '"><span class="vcs-glow" aria-hidden="true"></span><span class="vcs-shine" aria-hidden="true"></span>' +
      '<div class="vcs-hd">' + logo(a.k) + '<span><b>' + a.name + '</b><small>' + a.tag + '</small></span></div><p class="vcs-l">' + a.line + '</p>' +
      '<div class="vcs-ft"><a class="vcs-cta" href="' + (APP_LINKS[a.name] || 'https://voosquare.com') + '" target="_blank" rel="noopener" data-cta="' + a.name + '">' + a.cta + ' ' + ARW + '</a><span class="vcs-chip">' + a.chip + '</span></div></article>';
  }).join('') + '</div></div><div class="vcar-nav"><div class="vcar-dots" role="tablist" aria-label="Pick an app"></div><span class="vcar-live" aria-live="polite"></span></div></div>';
};
function mountCarousel(root) {
  if (!root || root._car) return;
  var vp = root.querySelector('.vcar-vp'), slides = [].slice.call(root.querySelectorAll('.vcs')), dotsEl = root.querySelector('.vcar-dots');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DELAY = 3500, idx = 0, timer = null, hovering = false, holdUntil = 0, visible = true, dots = [];
  var perView = function () { var w = vp.clientWidth, s = slides[0] ? slides[0].getBoundingClientRect().width : w; return Math.max(1, Math.round(w / Math.max(1, s))); };
  var stops = function () { return Math.max(1, slides.length - perView() + 1); };
  var near = function () { var x = vp.scrollLeft, best = 0, d = Infinity; slides.forEach(function (s, i) { var dd = Math.abs(s.offsetLeft - slides[0].offsetLeft - x); if (dd < d) { d = dd; best = i; } }); return Math.min(best, stops() - 1); };
  var paintDots = function () {
    var n = stops();
    if (dots.length !== n) { dotsEl.innerHTML = Array.from({ length: n }, function (_, i) { return '<button type="button" role="tab" aria-label="Show ' + CAR[i].name + '"><i></i></button>'; }).join(''); dots = [].slice.call(dotsEl.children); dots.forEach(function (d, i) { d.onclick = function () { go(i, true); }; }); }
    dots.forEach(function (d, i) { d.classList.toggle('on', i === idx); d.setAttribute('aria-selected', i === idx); });
    root.style.setProperty('--dur', DELAY + 'ms');
  };
  var activate = function () {
    slides.forEach(function (s, i) { var on = i >= idx && i < idx + perView(); if (on && !s.classList.contains('in')) { s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); } if (!on) s.classList.remove('in'); s.setAttribute('aria-hidden', on ? 'false' : 'true'); s.querySelector('.vcs-cta').tabIndex = on ? 0 : -1; });
    root.querySelector('.vcar-live').textContent = CAR[idx] ? CAR[idx].name : '';
  };
  var go = function (i, user) {
    idx = ((i % stops()) + stops()) % stops();
    vp.scrollTo({ left: slides[idx].offsetLeft - slides[0].offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
    if (user) holdUntil = Date.now() + 6000;
    paintDots(); activate(); restart();
  };
  var paused = function () { return reduce || hovering || !visible || document.hidden || Date.now() < holdUntil; };
  var restart = function () {
    clearTimeout(timer);
    root.classList.remove('run'); void root.offsetWidth;
    if (paused()) { root.classList.add('hold'); timer = setTimeout(restart, 700); return; }
    root.classList.remove('hold'); root.classList.add('run');
    timer = setTimeout(function () { if (!document.body.contains(root)) return; if (paused()) return restart(); go(idx + 1); }, DELAY);
  };
  // Parallax: the glow behind each slide drifts against the scroll.
  var raf = 0;
  var onScroll = function () {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var vw = vp.clientWidth, x0 = vp.getBoundingClientRect().left;
      slides.forEach(function (s) { var r = s.getBoundingClientRect(); s.style.setProperty('--px', ((r.left + r.width / 2 - x0 - vw / 2) / Math.max(1, vw)).toFixed(3)); });
    });
  };
  var settle = null;
  vp.addEventListener('scroll', function () { onScroll(); clearTimeout(settle); settle = setTimeout(function () { var n = near(); if (n !== idx) { idx = n; paintDots(); activate(); restart(); } }, 140); }, { passive: true });
  root.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hovering = true; restart(); } });
  root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hovering = false; restart(); } });
  vp.addEventListener('touchstart', function () { holdUntil = Date.now() + 6000; restart(); }, { passive: true });
  vp.addEventListener('focusin', function () { hovering = true; restart(); });
  vp.addEventListener('focusout', function () { hovering = false; restart(); });
  vp.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1, true); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1, true); } });
  // Mouse drag (touch uses native swiping).
  var drag = null;
  vp.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('a,button')) return; drag = { x: e.clientX, l: vp.scrollLeft, i: idx, moved: false }; vp.setPointerCapture(e.pointerId); root.classList.add('drag'); });
  vp.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; vp.scrollLeft = drag.l - dx; });
  var end = function (e) { if (!drag) return; var dx = e.clientX - drag.x, n = near(), from = drag.i; root.classList.remove('drag'); drag = null; if (Math.abs(dx) > 40 && n === from) n = from + (dx < 0 ? 1 : -1); go(n, true); };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; restart(); }, { threshold: 0.35 }).observe(root);
  document.addEventListener('visibilitychange', restart);
  var rz = null; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (!document.body.contains(root)) return; idx = Math.min(idx, stops() - 1); paintDots(); activate(); onScroll(); }, 150); });
  root._car = { go: go, index: function () { return idx; }, paused: paused };
  root.classList.toggle('still', reduce);
  paintDots(); activate(); onScroll(); restart();
}
var famLogos = function () { return '<div class="famlogos">' + [["jv","joinvoo"],["rv","replyvoo"],["cv","castvoo"],["af","affleego"],["va","vooads"]].map(function (x) { return '<span>' + logo(x[0]) + x[1] + '</span>'; }).join('') + '</div>'; };
document.addEventListener('click', function (e) { var b = e.target.closest('[data-app]'); if (!b) return; window.open(APP_LINKS[b.dataset.app] || 'https://voosquare.com', '_blank', 'noopener'); });
window.VooApps = { logo: logo, appsBlock: appsBlock, miniStrip: miniStrip, carousel: carousel, mountCarousel: mountCarousel, CAR: CAR, famLogos: famLogos, APPS: APPS, LINKS: APP_LINKS };
})();
