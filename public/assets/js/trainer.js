// Vooads training player: a video-like 16:9 player that animates a faithful mock of the studio.
// Loads lessons from GET /api/training ({lessons, audio}); falls back to a built-in lesson so it always works.
// Narration: scene mp3 from the audio map when present, else the browser's speechSynthesis (most natural English voice), else timed captions.
// Usage: VooTrainer.open({ id: 'getting-started' }) or VooTrainer.open({ match: 'getting started' }); VooTrainer.lessons() -> Promise<lessons>.
(function () {
  'use strict';
  var W = 1280, H = 720;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ic = function (n, s, w) { return window.VooUI ? VooUI.icon(n, s, w) : ''; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var mmss = function (ms) { var s = Math.max(0, Math.round(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };

  /* ---------------- Built-in fallback lesson ---------------- */
  var FALLBACK = [{
    id: 'getting-started', title: 'Getting started', minutes: 2, level: 'Beginner', summary: 'A two-minute tour: the guide, credits, the builder and your first ad.',
    scenes: [
      { screen: 'home', target: '#m-guide', action: 'point', caption: 'Your studio home', narration: 'Welcome to Vooads. This is your studio home. The live guide always shows your next step, and points at the exact button.' },
      { screen: 'home', target: '#m-credits', action: 'point', caption: 'Your credits', narration: 'Your credits live up here. Every price is shown before you generate, so there are no surprises.' },
      { screen: 'home', target: '#m-create-btn', action: 'click', caption: 'Open the builder', narration: 'Tap Create an ad to open the builder.' },
      { screen: 'create', target: '#m-type-ugc', action: 'click', caption: 'Pick what to make', narration: 'Pick what you want to make. A UGC talking video is the one most buyers start with.' },
      { screen: 'create', target: '#m-product', action: 'type', text: 'Vitamin C serum for women 25 to 40 with dull skin', caption: 'Describe the product in one line', narration: 'Describe your product in one clear line, and who it is for.' },
      { screen: 'create', target: '#m-language', action: 'click', caption: 'Choose the language', narration: 'Choose the language of the geo you run. The script is written for that language, not translated word for word.' },
      { screen: 'create', target: '#m-length', action: 'click', caption: 'Long videos render in parts', narration: 'Set the length. Anything over ten seconds renders in parts, and Vooads stitches them into one video for you.' },
      { screen: 'create', target: '#m-generate', action: 'click', caption: 'Check the cost, then Generate', narration: 'Check the cost in the summary, then hit Generate. If anything fails, every credit comes back.' },
      { screen: 'library', target: '#m-first-ad', action: 'point', caption: 'Your ads land in My ads', narration: 'Finished ads land in My ads, with the video, the captions file and the script.' },
      { screen: 'library', target: '#m-download', action: 'click', caption: 'Download and launch', narration: 'Download, upload to your ad account, and launch. That is it. Make the next one while this one learns.' },
    ],
  }];

  var data = null, loading = null, PRON = [];
  // Pronunciation dictionary (SPEC §12): case-insensitive whole words, e.g. Vooads -> Voo-ads, applied before the browser voice speaks.
  fetch('/api/public/config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (c) { if (Array.isArray(c.pronunciations)) PRON = c.pronunciations.filter(function (x) { return x && x.word && x.say; }); }).catch(function () {});
  var reEsc = function (w) { return String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  function pronounce(text) {
    var out = String(text || '');
    PRON.forEach(function (x) { out = out.replace(new RegExp('(^|[^\\p{L}\\p{N}])(' + reEsc(x.word) + ')(?=$|[^\\p{L}\\p{N}])', 'giu'), function (m, pre) { return pre + x.say; }); });
    return out;
  }
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch('/api/training', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var ls = Array.isArray(d) ? d : d.lessons;
      if (!ls || !ls.length) throw 0;
      ls = ls.filter(function (l) { return l && l.scenes && l.scenes.length; });
      if (!ls.length) throw 0;
      data = { lessons: ls, audio: (d && d.audio) || {} };
      return data;
    }).catch(function () { data = { lessons: FALLBACK, audio: {}, fallback: true }; return data; });
    return loading;
  }

  /* ---------------- Mock studio screens (1280x720) ---------------- */
  var IMG = ['/samples/creator-3.webp', '/samples/creator-4.webp', '/samples/creator-5.webp', '/samples/creator-6.webp'];
  var face = function (i, cls, id) { return '<span class="vt-face ' + (cls || '') + '"' + (id ? ' id="' + id + '"' : '') + '><img src="' + IMG[i % 4] + '" alt="" data-gone="1"></span>'; };
  var NAV = [['home', 'home', 'Home'], ['create', 'plus', 'Create an ad'], ['library', 'library', 'My ads'], ['shield', 'shield', 'Ban Shield'], ['wallet', 'wallet', 'Credits & plan'], ['refer', 'gift', 'Refer & earn'], ['support', 'headset', 'Help'], ['settings', 'settings', 'Settings']];
  var TITLES = { home: 'Home', create: 'Create an ad', 'create-ugc': 'Create an ad', library: 'My ads', wallet: 'Credits & plan', shield: 'Ban Shield', support: 'Help', refer: 'Refer & earn', settings: 'Settings' };
  function shell(screen, body) {
    var key = screen === 'create-ugc' ? 'create' : screen;
    return '<div class="vt-app"><aside class="vt-side"><div class="vt-logo"><span class="lmark sm"><i class="eye"><b></b></i><i class="eye"><b></b></i></span><span class="lword">Vooads<span></span></span></div>' +
      NAV.map(function (n) { return '<div class="vt-nv' + (n[0] === key ? ' on' : '') + (n[0] === 'create' ? ' mk' : '') + '">' + ic(n[1], 18) + n[2] + '</div>'; }).join('') +
      '<div class="vt-wal"><small>Credits</small><b>3,500</b><span>Pro plan</span></div></aside>' +
      '<div class="vt-main"><div class="vt-top"><h2>' + TITLES[screen] + '</h2><div class="vt-tr"><span class="vt-cp" id="m-credits"><span class="coin">VA</span>3,500</span><span class="vt-av">A</span></div></div><div class="vt-body" id="vtBody">' + body + '</div></div></div>';
  }
  var S = {};
  S.home = function () {
    return '<div class="vt-hello"><div class="vt-life"><span class="vt-rec"></span></div><div><span class="vt-ml">good morning</span><h3>Morning, Alex. <span>Let’s make ads.</span></h3><p>You have 3,500 credits, about 15 UGC videos.</p></div><span class="vt-btn vt-big" id="m-create-btn">' + ic('plus', 18) + 'Create an ad</span></div>' +
      '<div class="vt-guide" id="m-guide"><div class="vt-gh"><span class="vt-ml" style="color:#7EE2A8">● live guide · step 2 of 5</span></div><div class="vt-path">' +
      ['Your brand', 'First hooks', 'Ban Shield', 'Unlock video', 'First UGC'].map(function (t, i) { return '<div class="vt-node ' + (i < 1 ? 'done' : i === 1 ? 'now' : '') + '"><i>' + (i < 1 ? ic('check', 18, 2.4) : i + 1) + '</i><b>' + t + '</b></div>'; }).join('') + '</div></div>' +
      '<div class="vt-qa">' + [['ugc', 'UGC video'], ['film', 'Product video'], ['slides', 'Slideshow'], ['hooks', 'Hook pack']].map(function (q) { return '<div>' + ic(q[0], 22) + '<b>' + q[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="vt-row"><h4>Recent ads</h4></div><div class="vt-lib">' + [0, 1, 2, 3, 0].map(function (i, k) { return '<div class="vt-li"' + (k === 0 ? ' id="m-first-ad"' : '') + '>' + face(i) + '<span>' + ['Serum · ES', 'Protein · EN', 'App · PT', 'SPF · EN', 'Serum · FR'][k] + '</span></div>'; }).join('') + '</div>';
  };
  S.create = function (ugc) {
    return '<div class="vt-bld"><div class="vt-col">' +
      '<div class="vt-card"><span class="vt-ml">1 · what do you want to make?</span><div class="vt-types">' +
      [['ugc', 'm-type-ugc', 'ugc', 'UGC talking video', '15 cr / sec'], ['video', 'm-type-video', 'film', 'Product video', '10 cr / sec'], ['slideshow', 'm-type-slideshow', 'slides', 'Slideshow', '3 cr / sec'], ['hooks', 'm-type-hooks', 'hooks', 'Hook pack', '6 cr']].map(function (t) { return '<div class="vt-ty' + (ugc && t[0] === 'ugc' ? ' on' : '') + '" id="' + t[1] + '">' + ic(t[2], 22) + '<b>' + t[3] + '</b><small>' + t[4] + '</small></div>'; }).join('') + '</div></div>' +
      '<div class="vt-card"><span class="vt-ml">2 · what are you advertising?</span><div class="vt-inp vt-ta" id="m-product"></div>' +
      '<div class="vt-two"><div><span class="vt-ml">language and geo</span><div class="vt-inp vt-sel" id="m-language">' + ic('globe', 16) + '<span>English · US</span>' + ic('chevronD', 16) + '</div></div><div><span class="vt-ml">creator</span><div class="vt-pres" id="m-presenter">' + [0, 1, 2, 3].map(function (i) { return face(i, i === 2 ? 'on' : ''); }).join('') + '</div></div></div></div>' +
      '<div class="vt-card"><span class="vt-ml">3 · length and script</span><div class="vt-len" id="m-length"><div class="vt-track"><i id="vtFill" style="width:22%"></i><b id="vtKnob" style="left:22%"></b></div><span class="vt-lv" id="vtLen">15s</span></div>' +
      '<div class="vt-note" id="m-long-note">' + ic('stitch', 16) + '<span id="vtNote">15s video = 2 parts of 10s, stitched automatically</span></div>' +
      '<div class="vt-sw" id="m-script-toggle"><i></i><span><b>Write it for me</b> <em>Pro</em></span></div>' +
      '<div class="vt-inp vt-ta sm" id="m-script">I almost returned this serum… then week two happened.</div>' +
      '<div class="vt-shl" id="m-shield-line"><span>94/100 · Safe</span>Ban Shield checks your script as you type.</div></div>' +
      '</div><div class="vt-sum"><span class="vt-ml" style="color:#A19E95">this will cost</span><div class="vt-cost"><span class="coin">VA</span><span id="vtCost">225</span><small>credits</small></div>' +
      '<div class="vt-sr"><span>Making</span><b>UGC talking video</b></div><div class="vt-sr"><span>Length</span><b id="vtSumLen">15s · 2 parts</b></div><div class="vt-sr"><span>Language</span><b id="vtSumLang">English</b></div><div class="vt-sr"><span>You have</span><b>3,500</b></div>' +
      '<div class="vt-btn vt-gen" id="m-generate">Generate <i>' + ic('arrow', 16) + '</i></div><div class="vt-prog" id="vtProg"><span>Rendering part 1 of 6</span><div><i></i></div></div><small style="color:#6E6B63">Failed renders refund automatically.</small></div></div>';
  };
  S['create-ugc'] = function () { return S.create(true); };
  S.library = function () {
    return '<div class="vt-row"><div class="vt-seg" id="m-filter"><span class="on">All</span><span>UGC</span><span>Videos</span><span>Images</span><span>Hooks</span></div><span class="vt-btn">' + ic('plus', 16) + 'New ad</span></div>' +
      '<div class="vt-libg">' + [2, 0, 1, 3, 2, 1, 0, 3].map(function (i, k) { return '<div class="vt-li big"' + (k === 0 ? ' id="m-first-ad"' : '') + '>' + face(i) + '<span>' + ['Serum · ES · 60s', 'Protein · EN', 'Budget app · EN', 'SPF · PT', 'Serum · FR', 'Sneakers · EN', 'Course · ES', 'Protein · DE'][k] + '</span>' + (k === 0 ? '<div class="vt-dl" id="m-download">' + ic('download', 16) + 'Download</div>' : '') + '</div>'; }).join('') + '</div>';
  };
  S.wallet = function () {
    return '<div class="vt-balc"><span class="vt-ml" style="color:#A19E95">your credits</span><b>3,500</b><div class="vt-bk"><span>Plan 3,200</span><span>Top-up 300</span><span>Trial 0</span></div></div>' +
      '<div class="vt-card"><span class="vt-ml">pick a plan</span><div class="vt-plans" id="m-plans">' + [['Starter', '$49', '1,000'], ['Pro', '$149', '3,500'], ['Scale', '$349', '8,500'], ['Agency', '$799', '20,000']].map(function (p, i) { return '<div class="vt-pl' + (i === 1 ? ' pop' : '') + '"><b>' + p[0] + '</b><strong>' + p[1] + '<small>/mo</small></strong><span>' + p[2] + ' credits</span></div>'; }).join('') + '</div></div>' +
      '<div class="vt-two"><div class="vt-card"><span class="vt-ml">top up</span><div class="vt-tops" id="m-topup"><span>350 · $19</span><span>1,000 · $49</span><span>2,200 · $99</span></div></div><div class="vt-card"><span class="vt-ml">discount code</span><div class="vt-inp" id="m-discount"></div></div></div>';
  };
  S.shield = function () {
    return '<div class="vt-two big"><div class="vt-card"><span class="vt-ml">ad copy</span><div class="vt-inp vt-ta tall" id="m-shield-text"></div><div class="vt-btn" id="m-shield-check">' + ic('shield', 16) + 'Check it</div></div>' +
      '<div class="vt-card" id="vtShRes"><div class="vt-score"><div class="vt-ring" id="vtRing"><b id="vtScore">–</b></div><div><span class="vt-ml">score out of 100</span><h4 id="vtLvl">Your score shows here</h4></div></div><div id="vtFlags"></div><div class="vt-btn ghost" id="m-shield-fix">' + ic('check', 16) + 'Fix all lines</div></div></div>';
  };
  S.support = function () {
    return '<div class="vt-two big"><div class="vt-card"><div class="vt-row"><h4>Your tickets</h4><span class="vt-btn" id="m-new-ticket">' + ic('plus', 16) + 'New ticket</span></div>' +
      '<div class="vt-tk"><b>Video stuck on part 4</b><span class="vt-pillg">Solved</span></div><div class="vt-tk"><b>Invoice for March</b><span class="vt-pillg">Solved</span></div>' +
      '<div class="vt-agents"><span class="agents">' + [0, 1, 2].map(function (i) { return window.VooUI ? VooUI.agent(i, 36) : ''; }).join('') + '</span><span><b>Support team online</b><small>A person replies to every ticket</small></span></div></div>' +
      '<div class="vt-card" id="vtTkForm"><span class="vt-ml">new ticket</span><div class="vt-inp" id="m-ticket-subject"></div><div class="vt-cats"><span class="on">Video</span><span>Billing</span><span>Account</span><span id="m-call">Request a call</span></div><div class="vt-callf" id="vtCallF"><div class="vt-inp">+234 801 234 5678</div><div class="vt-inp">Tomorrow, 10:00</div></div><div class="vt-inp vt-ta sm">My 60s video has been on part 4 for a while.</div><div class="vt-btn" id="m-ticket-send">' + ic('send', 16) + 'Send</div><div id="vtThread"></div></div></div>';
  };
  S.refer = function () {
    return '<div class="vt-balc lt"><h3>Share Vooads. <span>Earn every month.</span></h3><p>You get a share of what your referrals pay, every month they pay.</p></div>' +
      '<div class="vt-card"><span class="vt-ml">your link</span><div class="vt-copy"><div class="vt-inp" id="m-ref-link">vooads.com/?ref=ada42</div><div class="vt-btn" id="m-ref-copy">' + ic('copy', 16) + '<span>Copy</span></div></div><div class="vt-cats"><span>WhatsApp</span><span>Telegram</span><span>X</span></div></div>' +
      '<div class="vt-stats"><div><small>Signed up</small><b>12</b></div><div><small>Paying</small><b>4</b></div><div><small>Your share</small><b>10%</b></div></div>';
  };
  S.settings = function () {
    return '<div class="vt-two big"><div class="vt-card"><span class="vt-ml">your brand</span><div class="vt-inp" id="m-brand">Glowlab</div><div class="vt-inp vt-sel"><span>Beauty</span>' + ic('chevronD', 16) + '</div><div class="vt-sw on"><i></i><span><b>Write hooks in my brand voice</b></span></div><div class="vt-btn" id="m-save">' + ic('check', 16) + '<span>Save brand</span></div></div>' +
      '<div class="vt-card"><span class="vt-ml">account</span><div class="vt-inp">Alex</div><div class="vt-inp">alex@glowlab.co</div><div class="vt-sw on"><i></i><span><b>Show the live guide on Home</b></span></div></div></div>';
  };
  var SCREENS = Object.keys(S);

  /* ---------------- Effects for clicks (and their instant versions when seeking) ---------------- */
  function effect(id, el, root, instant) {
    var q = function (s) { return $(s, root); };
    switch (id) {
      case 'm-type-ugc': case 'm-type-video': case 'm-type-slideshow': case 'm-type-hooks':
        $$('.vt-ty', root).forEach(function (t) { t.classList.toggle('on', t === el); }); break;
      case 'm-language': $('span', el).textContent = 'Spanish · MX'; if (q('#vtSumLang')) q('#vtSumLang').textContent = 'Spanish'; break;
      case 'm-length': q('#vtFill').style.width = '100%'; q('#vtKnob').style.left = '100%'; q('#vtLen').textContent = '60s'; q('#vtNote').textContent = '60s video = 6 parts of 10s, stitched automatically'; q('#vtCost').textContent = '900'; q('#vtSumLen').textContent = '60s · 6 parts'; el.classList.add('is-on'); break;
      case 'm-script-toggle': el.classList.toggle('on'); break;
      case 'm-generate': q('#vtProg').classList.add('on'); break;
      case 'm-shield-check': var r = q('#vtRing'); r.style.setProperty('--p', 41); r.style.setProperty('--c', '#D63B2F'); q('#vtScore').textContent = '41'; q('#vtLvl').textContent = 'High ban risk'; q('#vtFlags').innerHTML = '<div class="vt-flag"><b>“guaranteed”</b><small>Promises a result. Try: “many people notice”</small></div><div class="vt-flag"><b>“Are you embarrassed”</b><small>Points at a personal trait. Try: “If this bugs you too”</small></div>'; break;
      case 'm-shield-fix': var r2 = q('#vtRing'); r2.style.setProperty('--p', 94); r2.style.setProperty('--c', '#1F9D55'); q('#vtScore').textContent = '94'; q('#vtLvl').textContent = 'Safe to run'; q('#vtFlags').innerHTML = '<div class="vt-flag ok"><b>Rewritten</b><small>Risky lines replaced with safer ones.</small></div>'; var t = q('#m-shield-text'); if (t) t.textContent = 'Many people notice a flatter-looking belly in a few weeks. If this bugs you too, here’s what I changed.'; break;
      case 'm-filter': $$('span', el).forEach(function (s, i) { s.classList.toggle('on', i === 1); }); break;
      case 'm-download': el.innerHTML = ic('check', 16) + 'Downloaded'; el.classList.add('is-on'); break;
      case 'm-plans': $$('.vt-pl', el).forEach(function (p, i) { p.classList.toggle('pick', i === 1); }); break;
      case 'm-topup': $$('span', el)[1].classList.add('on'); break;
      case 'm-new-ticket': q('#vtTkForm').classList.add('is-on'); break;
      case 'm-call': $$('.vt-cats span', root).forEach(function (s) { s.classList.toggle('on', s === el); }); q('#vtCallF').classList.add('on'); break;
      case 'm-ticket-send': q('#vtThread').innerHTML = '<div class="vt-msg bot"><b>Instant answer</b> Long videos render in parts. Read “Long videos” while a person on the team looks at it.</div>'; break;
      case 'm-ref-copy': $('span', el).textContent = 'Copied'; el.classList.add('is-on'); break;
      case 'm-save': $('span', el).textContent = 'Saved'; el.classList.add('is-on'); break;
      default: if (el) el.classList.toggle('is-on');
    }
  }

  /* ---------------- Narration ---------------- */
  var voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var vs = speechSynthesis.getVoices().filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
    if (!vs.length) return null;
    var pref = ['Natural', 'Neural', 'Google', 'Samantha', 'Daniel'];
    for (var i = 0; i < pref.length; i++) { var m = vs.filter(function (v) { return v.name.indexOf(pref[i]) >= 0; }); if (m.length) return m.find(function (v) { return /en-US/i.test(v.lang); }) || m[0]; }
    return vs.find(function (v) { return /en-US/i.test(v.lang); }) || vs[0];
  }
  if ('speechSynthesis' in window) { voice = pickVoice(); try { speechSynthesis.addEventListener('voiceschanged', function () { voice = pickVoice(); }); } catch (e) {} }
  var estimate = function (sc) { var w = String(sc.narration || sc.caption || '').split(/\s+/).filter(Boolean).length; var t = sc.action === 'type' ? String(sc.text || '').length * 45 : 0; return Math.max(3200, w * 360 + 900, t + 2400); };

  /* ---------------- Player ---------------- */
  var P = null;
  function open(opts) {
    opts = opts || {};
    close();
    var m = document.createElement('div'); m.className = 'vt-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Vooads training');
    m.innerHTML = '<div class="vt-box"><div class="vt-head"><div class="vt-ttl"><span class="vt-ml" id="vtMeta">loading lesson…</span><h3 id="vtTitle">Vooads training</h3></div><button class="vt-x" aria-label="Close" data-vtclose>' + ic('x', 20) + '</button></div>' +
      '<div class="vt-frame" id="vtFrame"><div class="vt-stage" id="vtStage"><div class="vt-screen" id="vtScreen"></div><div class="vt-hl" id="vtHl"></div><div class="vt-cur" id="vtCur"><svg width="34" height="34" viewBox="0 0 24 24"><path d="M5 3.5 19 11l-6.2 1.6L10 19z" fill="#0B0B0A" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><i></i></div></div>' +
      '<div class="vt-cap" id="vtCap"></div><button class="vt-bigplay" id="vtBig" aria-label="Play">' + ic('play', 30) + '</button>' +
      (window.VooToons ? '<div class="vt-coach" id="vtCoach">' + VooToons.coachFace() + '<span><b>Coach Vee</b><small><i></i><i></i><i></i>&nbsp;talking you through it</small></span></div>' : '') +
      '</div>' +
      '<div class="vt-ctrl"><button class="vt-b" id="vtPP" aria-label="Play">' + ic('play', 20) + '</button><span class="vt-time" id="vtTime">00:00 / 00:00</span><div class="vt-scrub" id="vtScrub" role="slider" aria-label="Seek" tabindex="0"><div class="vt-rail"><i id="vtDone"></i></div><div id="vtTicks"></div></div><button class="vt-b vt-spd" id="vtSpd" aria-label="Playback speed">1x</button><button class="vt-b on" id="vtCC" aria-label="Captions">' + ic('cc', 20) + '</button><button class="vt-b" id="vtFS" aria-label="Fullscreen">' + ic('full', 20) + '</button></div>' +
      '<div class="vt-under"><div class="vt-chaps" id="vtChaps"></div><div class="vt-lessons" id="vtLessons"></div></div></div>';
    document.body.appendChild(m);
    document.documentElement.classList.add('vt-lock');
    P = { m: m, playing: false, speed: 1, i: 0, token: 0, pt: 0, last: 0, cc: true, audio: null, utter: null, est: [], sceneStart: 0, raf: 0, started: false };
    var key = function (e) { if (!P) return; if (e.key === 'Escape') close(); if (e.key === ' ' && e.target === document.body) { e.preventDefault(); toggle(); } };
    addEventListener('keydown', key); P.key = key;
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-vtclose]')) close(); });
    addEventListener('resize', fit); P.fit = fit;
    $('#vtPP', m).onclick = toggle; $('#vtBig', m).onclick = toggle;
    $('#vtStage', m).onclick = toggle;
    $('#vtSpd', m).onclick = function () { var s = [1, 1.25, 1.5]; P.speed = s[(s.indexOf(P.speed) + 1) % s.length]; this.textContent = P.speed + 'x'; if (P.audio) P.audio.playbackRate = P.speed; };
    $('#vtCC', m).onclick = function () { P.cc = !P.cc; this.classList.toggle('on', P.cc); $('#vtCap', m).classList.toggle('off', !P.cc); };
    $('#vtFS', m).onclick = function () {
      var box = $('.vt-box', m);
      try {
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        if (box.requestFullscreen) { var pr = box.requestFullscreen(); if (pr && pr.catch) pr.catch(function () { box.classList.toggle('vt-max'); fit(); }); }
        else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
        else { box.classList.toggle('vt-max'); }
      } catch (e) { box.classList.toggle('vt-max'); }
      setTimeout(fit, 120);
    };
    document.addEventListener('fullscreenchange', fit);
    var scrub = $('#vtScrub', m);
    var seekAt = function (x) { var r = scrub.getBoundingClientRect(); var f = Math.max(0, Math.min(1, (x - r.left) / r.width)); var tot = total(), acc = 0; for (var k = 0; k < P.est.length; k++) { if (acc + P.est[k] > f * tot || k === P.est.length - 1) { seek(k); return; } acc += P.est[k]; } };
    scrub.addEventListener('click', function (e) { seekAt(e.clientX); });
    scrub.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') seek(Math.min(P.lesson.scenes.length - 1, P.i + 1)); if (e.key === 'ArrowLeft') seek(Math.max(0, P.i - 1)); });
    fit();
    load().then(function (d) {
      if (!P) return;
      P.data = d;
      var ls = d.lessons, l = null;
      if (opts.id) l = ls.find(function (x) { return x.id === opts.id; });
      if (!l && opts.match) { var rx = new RegExp(opts.match, 'i'); l = ls.find(function (x) { return rx.test(x.title) || rx.test(x.id); }); }
      setLesson(l || ls[0], opts.autoplay !== false);
    });
    return m;
  }
  function clearNext() { $$('.vt-next', P.m).forEach(function (b) { b.remove(); }); }
  function setLesson(l, autoplay) {
    stopNarration(); P.token++; clearNext(); P.screen = null;
    P.lesson = l; P.i = 0; P.pt = 0; P.est = l.scenes.map(estimate); P.started = false;
    var ls = P.data.lessons, idx = ls.indexOf(l);
    $('#vtTitle', P.m).textContent = l.title;
    $('#vtMeta', P.m).textContent = 'lesson ' + (idx + 1) + ' of ' + ls.length + ' · ' + (l.minutes || Math.max(1, Math.round(total() / 60000))) + ' min · ' + (l.level || 'Beginner').toLowerCase();
    $('#vtLessons', P.m).innerHTML = ls.length > 1 ? '<span class="vt-ml">more lessons</span><div>' + ls.map(function (x, k) { return '<button class="vt-lc' + (x === l ? ' on' : '') + '" data-k="' + k + '"><b>' + esc(x.title) + '</b><small>' + (x.minutes || 2) + ' min · ' + esc((x.level || 'Beginner').toLowerCase()) + '</small></button>'; }).join('') + '</div>' : '';
    $$('.vt-lc', P.m).forEach(function (b) { b.onclick = function () { setLesson(ls[Number(b.dataset.k)], true); }; });
    $('#vtChaps', P.m).innerHTML = l.scenes.map(function (s, k) { return '<button data-k="' + k + '"><span>' + pad(k + 1) + '</span>' + esc(s.caption || ('Step ' + (k + 1))) + '</button>'; }).join('');
    $$('#vtChaps button', P.m).forEach(function (b) { b.onclick = function () { seek(Number(b.dataset.k)); }; });
    var tot = total(), acc = 0;
    $('#vtTicks', P.m).innerHTML = l.scenes.map(function (s, k) { var x = acc / tot * 100; acc += P.est[k]; return k ? '<i style="left:' + x + '%"></i>' : ''; }).join('');
    render(l.scenes[0].screen); place(l.scenes[0], true);
    $('#vtCap', P.m).textContent = l.scenes[0].caption || '';
    paintTime();
    if (autoplay) play(); else setPlaying(false);
  }
  function total() { return P.est.reduce(function (a, b) { return a + b; }, 0) || 1; }
  function fit() {
    if (!P) return;
    var f = $('#vtFrame', P.m), st = $('#vtStage', P.m);
    var s = f.clientWidth / W; st.style.transform = 'scale(' + s + ')'; P.scale = s;
  }
  function render(screen) {
    var sc = $('#vtScreen', P.m);
    if (!S[screen]) screen = 'home';
    if (P.screen === screen) return;
    P.screen = screen;
    sc.classList.remove('in'); void sc.offsetWidth;
    sc.innerHTML = shell(screen, S[screen]());
    sc.classList.add('in');
    if (window.VooUI) VooUI.media(sc);
  }
  function find(sel) { try { return $(sel, $('#vtScreen', P.m)); } catch (e) { return null; } }
  function locate(scene) {
    var el = find(scene.target);
    if (el) return el;
    for (var k = 0; k < SCREENS.length; k++) { if (SCREENS[k] === P.screen) continue; var tmp = document.createElement('div'); tmp.innerHTML = S[SCREENS[k]](); if (tmp.querySelector(scene.target)) { render(SCREENS[k]); return find(scene.target); } }
    return null;
  }
  function rectOf(el) {
    var st = $('#vtStage', P.m).getBoundingClientRect(), r = el.getBoundingClientRect(), s = P.scale || 1;
    return { x: (r.left - st.left) / s, y: (r.top - st.top) / s, w: r.width / s, h: r.height / s };
  }
  function ensureVisible(el, instant) {
    var body = find('#vtBody'); if (!body || !body.contains(el)) return;
    var r = rectOf(el), b = rectOf(body), target = body.scrollTop;
    if (r.y + r.h > b.y + b.h - 20) target = body.scrollTop + (r.y + r.h) - (b.y + b.h) + 60;
    else if (r.y < b.y + 10) target = body.scrollTop - (b.y - r.y) - 40;
    if (target === body.scrollTop) return;
    if (instant) { body.scrollTop = target; return; }
    var from = body.scrollTop, t0 = performance.now();
    (function step(t) { var k = Math.min(1, (t - t0) / 600), e = 1 - Math.pow(1 - k, 3); body.scrollTop = from + (target - from) * e; if (k < 1) requestAnimationFrame(step); })(t0);
  }
  function place(scene, instant) {
    var el = locate(scene), cur = $('#vtCur', P.m), hl = $('#vtHl', P.m);
    if (!el) { hl.style.opacity = 0; return null; }
    ensureVisible(el, true);
    var r = rectOf(el);
    var dur = instant ? 0 : Math.round(750 / P.speed);
    cur.style.transitionDuration = dur + 'ms'; hl.style.transitionDuration = dur + 'ms';
    cur.style.transform = 'translate(' + (r.x + Math.min(r.w * .55, r.w - 14)) + 'px,' + (r.y + Math.min(r.h * .55, r.h - 10)) + 'px)';
    hl.style.left = (r.x - 8) + 'px'; hl.style.top = (r.y - 8) + 'px'; hl.style.width = (r.w + 16) + 'px'; hl.style.height = (r.h + 16) + 'px'; hl.style.opacity = 1;
    return el;
  }
  function wait(ms, tok) {
    var target = P.pt + ms;
    return new Promise(function (res, rej) {
      (function chk() { if (!P || P.token !== tok) return rej('x'); if (P.pt >= target) return res(); setTimeout(chk, 40); })();
    });
  }
  function loop(t) {
    if (!P) return;
    var dt = P.last ? Math.min(100, t - P.last) : 0; P.last = t;
    if (P.playing) P.pt += dt * P.speed;
    paintTime();
    P.raf = requestAnimationFrame(loop);
  }
  function paintTime() {
    if (!P || !P.lesson) return;
    var before = 0; for (var k = 0; k < P.i; k++) before += P.est[k];
    var inScene = Math.min(P.est[P.i] || 0, Math.max(0, P.pt - P.sceneStart));
    var cur = before + inScene, tot = total();
    $('#vtDone', P.m).style.width = (cur / tot * 100) + '%';
    $('#vtTime', P.m).textContent = mmss(cur) + ' / ' + mmss(tot);
  }
  function setPlaying(on) {
    P.playing = on;
    P.m.classList.toggle('vt-playing', on);
    $('#vtPP', P.m).innerHTML = ic(on ? 'pause' : 'play', 20); $('#vtPP', P.m).setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (P.audio) { if (on) P.audio.play().catch(function () {}); else P.audio.pause(); }
    if (P.utter && 'speechSynthesis' in window) { try { if (on) speechSynthesis.resume(); else speechSynthesis.pause(); } catch (e) {} }
  }
  function toggle() { if (!P || !P.lesson) return; if (!P.started) { if (P.i === 0 && P.pt > 0) { seek(0); return; } play(); return; } setPlaying(!P.playing); }
  function play() {
    clearNext();
    if (!P.raf) P.raf = requestAnimationFrame(loop);
    P.started = true; setPlaying(true); run(P.i);
  }
  function seek(k) {
    stopNarration();
    P.token++; clearNext(); var wasStarted = P.started;
    var l = P.lesson, scene = l.scenes[k];
    P.screen = null; render(locateScreen(scene));
    // replay earlier scenes on the same screen instantly so the mock is in the right state
    for (var j = 0; j < k; j++) { var s = l.scenes[j]; if (locateScreen(s) !== P.screen) continue; var el = find(s.target); if (!el) continue; if (s.action === 'type') typeInstant(el, s.text); else if (s.action === 'click') effect(el.id, el, $('#vtScreen', P.m), true); }
    P.i = k;
    if (!wasStarted) { P.started = true; if (!P.raf) P.raf = requestAnimationFrame(loop); }
    setPlaying(true); run(k);
  }
  function locateScreen(scene) {
    if (S[scene.screen]) { var tmp = document.createElement('div'); tmp.innerHTML = S[scene.screen](); if (!scene.target || tmp.querySelector(scene.target)) return scene.screen; }
    for (var k = 0; k < SCREENS.length; k++) { var t2 = document.createElement('div'); t2.innerHTML = S[SCREENS[k]](); if (scene.target && t2.querySelector(scene.target)) return SCREENS[k]; }
    return S[scene.screen] ? scene.screen : 'home';
  }
  function typeInstant(el, text) { if ('value' in el && /INPUT|TEXTAREA/.test(el.tagName)) el.value = text || ''; else el.textContent = text || ''; }
  // Coach Vee's mouth moves only while a scene's narration is playing.
  function talk(on) { var c = P && P.m && P.m.querySelector('#vtCoach'); if (c) c.classList.toggle('talking', !!on); }
  function stopNarration() {
    talk(false);
    if (P && P.audio) { try { P.audio.pause(); } catch (e) {} P.audio = null; }
    if (P) P.utter = null;
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
  }
  function narrate(k, tok) {
    var l = P.lesson, sc = l.scenes[k], text = sc.narration || sc.caption || '';
    var urls = (P.data.audio || {})[l.id], url = urls && urls[k];
    var fallbackWait = function () { return wait(P.est[k] - 300, tok); };
    if (url) {
      return new Promise(function (res) {
        var a = new Audio(url); a.playbackRate = P.speed; P.audio = a;
        var done = false, fin = function () { if (done) return; done = true; res(); };
        a.addEventListener('ended', fin); a.addEventListener('error', function () { P.audio = null; fallbackWait().then(fin, fin); });
        a.addEventListener('loadedmetadata', function () { if (isFinite(a.duration) && a.duration > 0 && P && P.token === tok) { P.est[k] = Math.max(P.est[k], a.duration * 1000 + 700); } });
        if (P.playing) a.play().catch(function () { P.audio = null; fallbackWait().then(fin, fin); });
      });
    }
    if (voice && 'speechSynthesis' in window && text) {
      return new Promise(function (res) {
        var u = new SpeechSynthesisUtterance(pronounce(text)); u.voice = voice; u.lang = voice.lang; u.rate = 1.02 * P.speed; u.pitch = 1;
        P.utter = u; var done = false, fin = function () { if (done) return; done = true; res(); };
        u.onend = fin; u.onerror = fin;
        try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { fin(); }
        // safety net: never hang if the browser drops the end event
        wait(P.est[k] * 1.9 + 2500, tok).then(fin, fin);
      });
    }
    return fallbackWait();
  }
  async function run(k) {
    var tok = ++P.token, l = P.lesson;
    try {
      for (var i = k; i < l.scenes.length; i++) {
        P.i = i; P.sceneStart = P.pt;
        var sc = l.scenes[i];
        $$('#vtChaps button', P.m).forEach(function (b, j) { b.classList.toggle('on', j === i); b.classList.toggle('done', j < i); });
        var cap = $('#vtCap', P.m); cap.classList.remove('in'); void cap.offsetWidth; cap.textContent = sc.caption || ''; cap.classList.add('in');
        var scr = locateScreen(sc);
        if (scr !== P.screen) { render(scr); await wait(350, tok); }
        var speech = narrate(i, tok);
        talk(true); speech.then(function () { if (P && P.token === tok) talk(false); }, function () {});
        var el = place(sc);
        await wait(800, tok);
        if (el) {
          if (sc.action === 'click') { ripple(); await wait(260, tok); effect(el.id, el, $('#vtScreen', P.m)); }
          else if (sc.action === 'type') { el.classList.add('vt-typing'); typeInstant(el, ''); var txt = String(sc.text || ''); for (var c = 1; c <= txt.length; c++) { typeInstant(el, txt.slice(0, c)); await wait(38, tok); } el.classList.remove('vt-typing'); }
          else if (sc.action === 'scroll') { ensureVisible(el); }
        }
        await speech;
        if (P.token !== tok) return;
        await wait(450, tok);
      }
      P.i = l.scenes.length - 1; P.sceneStart = P.pt - P.est[P.i];
      setPlaying(false); P.started = false; P.i = 0;
      var ls = P.data.lessons, nx = ls[ls.indexOf(l) + 1];
      $('#vtCap', P.m).innerHTML = 'Lesson complete' + (nx ? ' · next: <b>' + esc(nx.title) + '</b>' : '');
      if (nx) { var b = document.createElement('button'); b.className = 'vt-next'; b.innerHTML = 'Next lesson: ' + esc(nx.title) + ' ' + ic('arrow', 16); b.onclick = function () { b.remove(); setLesson(nx, true); }; $('#vtFrame', P.m).appendChild(b); }
    } catch (e) { /* cancelled by seek / close */ }
  }
  function ripple() {
    var cur = $('#vtCur i', P.m); if (!cur) return;
    cur.classList.remove('go'); void cur.offsetWidth; cur.classList.add('go');
    var c = $('#vtCur', P.m); c.classList.remove('press'); void c.offsetWidth; c.classList.add('press');
  }
  function close() {
    if (!P) return;
    stopNarration(); P.token++;
    cancelAnimationFrame(P.raf);
    removeEventListener('keydown', P.key); removeEventListener('resize', P.fit); document.removeEventListener('fullscreenchange', fit);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    P.m.remove(); P = null;
    document.documentElement.classList.remove('vt-lock');
  }
  window.VooTrainer = { pronounce: function (t) { return pronounce(t); }, open: open, close: close, lessons: function () { return load().then(function (d) { return d.lessons; }); }, data: function () { return load(); } };
})();
