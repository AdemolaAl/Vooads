/* Moved out of app.html so the CSP can drop 'unsafe-inline' (security audit). */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var I = VooUI.icon;
var TN = null; // v3: no cartoons; every T() icon is a plain line icon
// Drawn duotone icon when the cast has one, plain line icon otherwise.
var T = function (n, s) { return TN && TN.has(n) ? TN.icon(n, s) : I(n, s); };
var root = $('#root');
var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
var FACE = function (s, cls) { return '<div class="face ' + (cls || '') + '" style="--s:' + s + 'px"><span class="eyes"><i class="eye"><b></b></i><i class="eye"><b></b></i></span><span class="mouth"></span></div>'; };
var COIN = '<span class="coin">VA</span>';
var ARR = function (ic) { return '<span class="arr">' + I(ic || 'arrow', 16) + '</span>'; };
var pad = function (n) { return String(n).padStart(2, '0'); };
var when = function (d) { if (!d) return ''; var t = new Date(d.replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(d) ? '' : 'Z')); return t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

async function api(method, url, body) {
  var r = await fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  var d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { var err = new Error(d.error || 'Something went wrong. Try again.'); err.status = r.status; err.data = d; throw err; }
  return d;
}
function toast(msg, bad) {
  var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  $$('.toast').forEach(function (x) { x.remove(); }); document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
}
function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied'); }, function () { toast('Press and hold to copy'); }); }

var PAGES = [['home', 'Create', 'spark'], ['create', 'New ad', 'plus'], ['library', 'Projects', 'film'], ['media', 'Library', 'library'], ['actors', 'Actors', 'user'], ['brand', 'Brand kit', 'palette'], ['wallet', 'Credits', 'credits'], ['learn', 'Learn', 'learn'], ['support', 'Support', 'headset'], ['shield', 'Ban Shield', 'shield'], ['refer', 'Refer and earn', 'gift'], ['apps', 'Voo family apps', 'grid'], ['settings', 'Settings', 'settings']];
var TITLES = {}, NIC = {}; PAGES.forEach(function (p) { TITLES[p[0]] = p[1]; NIC[p[0]] = p[2]; });
// Tools that are not video types (text and image jobs)
var TOOLS = {
  hooks: { ic: 'hooks', name: 'Hook pack', d: '20 scroll-stopping opening lines', cost: function () { return CFG.costs.hook_pack_20; } },
  angles: { ic: 'target', name: 'Angles', d: '10 angles with a hook and why it works', cost: function () { return CFG.costs.angles || 2; } },
  image: { ic: 'image', name: 'Image set', d: '1:1, 4:5 and 9:16 ad images', cost: function () { return CFG.costs.image_3_sizes; } },
  script: { ic: 'script', name: 'Ad script', d: 'A full UGC script, written for you', pro: true, cost: function () { return CFG.costs.script; } },
};
var PIPE_IC = { street: 'mic', mad_edit: 'spark', edit: 'stitch', actor: 'ugc', tool: 'spark', motion_ad: 'spark', ugc: 'ugc', video: 'film', image_to_video: 'imgvid', slideshow: 'slides', dub: 'mic', hook_remix: 'remix', bg_swap: 'image', auto_edit: 'stitch', brand_music: 'sound' };
var JOB_NAMES = { street: 'Street interview', mad_edit: 'Viral edit', edit: 'Edited version', actor: 'Actor faces', bg_swap: 'New background', auto_edit: 'Auto-edit', brand_music: 'Brand track', tool: 'AI tool', motion_ad: 'Animated ad', ugc: 'UGC video', video: 'Product video', image_to_video: 'Photo to video', slideshow: 'Slideshow', dub: 'Dubbed ad', hook_remix: 'Hook remix', image: 'Image set', hooks: 'Hook pack', script: 'Ad script', angles: 'Angles' };
var VIDEO_JOB = ['motion_ad', 'ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'hook_remix', 'bg_swap', 'auto_edit', 'street', 'mad_edit', 'edit'];
var STYLE_NAMES = { product: 'Product showcase', lifestyle: 'Lifestyle', unboxing: 'Unboxing', demo: 'App demo', motion: 'Motion background', testimonial_broll: 'Story b-roll' };
var NICHES = [['beauty', 'Beauty'], ['health', 'Health & fitness'], ['ecom', 'E-commerce'], ['apps', 'Apps & software'], ['finance', 'Finance & trading'], ['betting', 'Betting'], ['education', 'Courses'], ['other', 'Something else']];
var COUNTRIES = [['', 'Choose…'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['IN', 'India'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['TH', 'Thailand'], ['TR', 'Turkey'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'], ['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['CM', 'Cameroon'], ['CI', "Côte d'Ivoire"], ['PK', 'Pakistan'], ['JP', 'Japan'], ['KR', 'South Korea'], ['PL', 'Poland'], ['PT', 'Portugal'], ['SE', 'Sweden'], ['ZZ', 'Other']];
var CATS = [['video', 'Video'], ['billing', 'Billing'], ['account', 'Account'], ['bug', 'Something broke'], ['call', 'Request a call'], ['other', 'Other']];

var CFG = null, ME = null, JOBS = [], VT = [], ADDONS = null, VT_FALLBACK = false, route = 'home', sub = '';
var qs = new URLSearchParams(location.search);
// Referrals: ?invite= is ours. ?ref= still works for old links, but only when it looks like a Vooads invite code: VooSquare
// uses ref for its own attribution (handled by the Voo Connect kit), so a ref value is only kept as a Vooads invite here.
var ref = qs.get('invite') || (/^[a-z0-9]{4,16}$/i.test(qs.get('ref') || '') ? qs.get('ref') : '');
if (ref) store.set('va_ref', ref); else ref = store.get('va_ref');
var wantPlan = qs.get('plan') ? { id: qs.get('plan'), period: qs.get('period') === 'year' ? 'year' : 'month' } : null;
var langName = function (k) { return (CFG && CFG.languages && CFG.languages[k]) || k; };
var u15 = function () { var t = VT.find(function (x) { return x.pipeline === 'ugc'; }); return Math.ceil((t ? t.credits_per_unit : CFG.costs.ugc_video_per_second) * 15); };

/* ================= BOOT ================= */
(async function boot() {
  try {
    var both = await Promise.all([api('GET', '/api/public/config'), api('GET', '/api/me')]);
    CFG = both[0]; ME = both[1].user;
    if (both[1].banned) toast('This account is ' + both[1].banned + '. Contact support.', true);
  } catch (e) { toast('Could not reach Vooads. Refresh the page.', true); }
  $('#boot').classList.add('gone'); setTimeout(function () { var b = $('#boot'); if (b) b.remove(); }, 450);
  if (qs.get('login_error')) toast(qs.get('login_error'), true);
  if (!ME) return renderAuth();
  startApp();
})();

/* ================= AUTH ================= */
function renderAuth() {
  var newUser = location.hash === '#signup' || !!wantPlan;
  var trial = CFG && CFG.free_trial && CFG.free_trial.credits ? fmt(CFG.free_trial.credits) + ' free credits' : 'Free credits'; // live pricing, never a fixed number
  root.innerHTML = '<div class="auth"><div class="aside">' +
    '<a class="logo" href="/"><span class="lmark brandbg"><i class="eye"><b></b></i><i class="eye"><b></b></i></span><span class="lword">Vooads</span></a>' +
    '<div style="display:grid;gap:26px"><h2>Type what you sell. <span>Get an ad that sells.</span></h2>' +
    '<div class="amini">' + [['biz-cafe-promo', 'Café promo'], ['ugc-serum', 'UGC talking'], ['style-street-interview', 'Street interview']].map(function (v) { return '<div class="media"><video muted loop playsinline preload="metadata" data-src="/samples/' + v[0] + '.mp4"></video><span class="lab">' + v[1] + '</span></div>'; }).join('') + '</div>' +
    '<div class="aquote">Made with Vooads. Every face is AI-generated.</div></div>' +
    '<p style="color:#6E6B63;font:500 12px var(--mono)">AI video ads, made fast</p></div>' +
    '<div class="aform"><form class="abox" id="af" method="post" novalidate>' +
    '<div><span class="ml">' + (newUser ? trial + ' · no card · no password' : 'log in with a code we email you') + '</span><h1 id="ah" style="margin-top:10px">' + (newUser ? 'Start free. <span>Make ads today.</span>' : 'Welcome back. <span>Let’s make ads.</span>') + '</h1></div>' +
    (CFG && CFG.voosquare_login ? '<a class="vsqb" href="/auth/voosquare?return_to=%2Fapp' + (newUser ? '&signup=1' : '') + (ref ? '&invite=' + encodeURIComponent(ref) : '') + '"><span class="vsq-m" aria-hidden="true">V</span>Continue with VooSquare</a><div class="or">or with email</div>' : '') +
    '<div class="vooacct" id="vooAcct" hidden><b>You already have a Voo account.</b><span>Log in with VooSquare to use the same account everywhere.</span><a class="btn blue" href="/auth/voosquare?return_to=%2Fapp">Log in with VooSquare</a></div>' +
    '<div id="s1" style="display:grid;gap:14px"><div class="fld"><label for="em">Email</label><input class="inp" id="em" name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="you@company.com" required></div>' +
    '<label class="sw" style="font-size:14px"><input type="checkbox" id="keep" name="remember" checked><span class="k"></span><span>Keep me signed in <small style="color:var(--mut)">(30 days on this device)</small></span></label>' +
    '<button class="btn arrow lg" id="sendb" style="justify-content:space-between">Email me a code ' + ARR() + '</button></div>' +
    '<div id="s2" hidden style="display:grid;gap:14px"><p style="font-size:15px">We sent a 6-digit code to <b id="emv"></b>. <button type="button" class="linkbtn" id="chg">Change</button></p>' +
    '<div class="codes" id="codes"><input inputmode="numeric" name="code" autocomplete="one-time-code" maxlength="6" aria-label="Digit 1">' + [2, 3, 4, 5, 6].map(function (i) { return '<input inputmode="numeric" maxlength="1" aria-label="Digit ' + i + '">'; }).join('') + '</div>' +
    '<div class="fld" id="nmw"><label for="nm">Your first name <small>(new accounts)</small></label><input class="inp" id="nm" autocomplete="given-name" placeholder="Alex"></div>' +
    '<div class="fld" id="ctw"><label for="ct">Country <small>(shows the right payment options)</small></label><select class="inp" id="ct">' + COUNTRIES.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</select></div>' +
    '<button class="btn arrow lg" id="verb" style="justify-content:space-between">Continue ' + ARR() + '</button><p class="fine2">No code? Check spam, or <button type="button" class="linkbtn" id="resend">send a new one</button>.</p></div>' +
    '<p class="err" id="aerr" role="alert"></p>' +
    '<p class="fine2">By continuing you agree to the <a href="/legal/terms" target="_blank">Terms</a>, <a href="/legal/acceptable-use" target="_blank">Acceptable Use Policy</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>. Using Vooads for scams or anything illegal gets your account banned with no refund.</p>' +
    '<p class="fine2">' + (newUser ? 'Have an account? <a href="#login" id="sw1">Log in</a>' : 'New here? <a href="#signup" id="sw1">Create a free account</a>') + '</p></form></div></div>';
  VooUI.media(root);
  try { var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; var guess = { 'Europe/London': 'GB', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Los_Angeles': 'US', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Accra': 'GH', 'Africa/Johannesburg': 'ZA', 'Africa/Douala': 'CM', 'Asia/Kolkata': 'IN', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Madrid': 'ES', 'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX', 'Asia/Dubai': 'AE', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Australia/Sydney': 'AU', 'America/Toronto': 'CA' }[tz]; if (guess) $('#ct').value = guess; } catch (e) {}
  var em = $('#em'), step = 1;
  var lastEm = store.get('va_last_email'); if (lastEm && !em.value) em.value = lastEm;
  if (store.get('va_keep') === '0') $('#keep').checked = false;
  em.focus();
  $('#sw1').onclick = function (e) { e.preventDefault(); try { history.replaceState(null, '', this.getAttribute('href')); } catch (er) { location.hash = this.getAttribute('href'); } renderAuth(); };
  async function send() {
    $('#aerr').textContent = '';
    var v = em.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { $('#aerr').textContent = 'Type a valid email address.'; em.focus(); return; }
    var b = $('#sendb'); b.disabled = true; b.innerHTML = 'Sending <span class="spinner"></span>';
    try {
      var d = await api('POST', '/api/auth/code', { email: v });
      step = 2; $('#s1').hidden = true; $('#s2').hidden = false; $('#emv').textContent = v;
      var ins = $$('#codes input'); ins[0].focus();
      if (d.dev_code) { d.dev_code.split('').forEach(function (c, i) { ins[i].value = c; }); toast('Dev mode: code filled in for you'); }
    } catch (e) { $('#aerr').textContent = e.message; }
    b.disabled = false; b.innerHTML = 'Email me a code ' + ARR();
  }
  var ins = $$('#codes input');
  ins.forEach(function (inp, i) {
    inp.addEventListener('input', function () {
      var v = inp.value.replace(/\D/g, '');
      if (v.length > 1) { v.split('').slice(0, 6).forEach(function (c, k) { if (ins[k]) ins[k].value = c; }); ins[Math.min(5, v.length - 1)].focus(); if (v.length >= 6) verify(); return; }
      inp.value = v; if (v && ins[i + 1]) ins[i + 1].focus();
      if (ins.every(function (x) { return x.value; })) verify();
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
  });
  var verifying = false;
  async function verify() {
    if (verifying) return;
    var code = ins.map(function (x) { return x.value; }).join('');
    if (code.length < 6) { $('#aerr').textContent = 'Enter all 6 digits.'; return; }
    verifying = true; $('#aerr').textContent = '';
    var b = $('#verb'); b.disabled = true; b.innerHTML = 'Checking <span class="spinner"></span>';
    try {
      var d = await api('POST', '/api/auth/verify', { email: em.value.trim(), code: code, remember: $('#keep').checked, name: $('#nm').value.trim(), country: $('#ct').value === 'ZZ' ? '' : $('#ct').value, ref: ref || undefined });
      ME = d.user;
      store.set('va_last_email', em.value.trim()); store.set('va_keep', $('#keep').checked ? '1' : '0');
      if (d.new) store.set('va_new', '1');
      history.replaceState(null, '', '/app' + (wantPlan ? '#wallet' : (d.new ? '#home' : location.hash.replace(/#(signup|login)/, '') || '#home')));
      startApp();
      toast(d.new ? 'Welcome to Vooads, ' + (ME.name || 'friend') + '. ' + fmt(ME.balance.trial) + ' free credits added.' : 'Welcome back' + (ME.name ? ', ' + ME.name : '') + '.');
    } catch (e) {
      if (e.data && e.data.voo_account) { $('#vooAcct').hidden = false; $('#s2').hidden = true; $('#aerr').textContent = ''; verifying = false; b.disabled = false; b.innerHTML = 'Continue ' + ARR(); return; }
      $('#aerr').textContent = e.message; ins.forEach(function (x) { x.value = ''; }); ins[0].focus();
    }
    verifying = false; b.disabled = false; b.innerHTML = 'Continue ' + ARR();
  }
  $('#af').onsubmit = function (e) { e.preventDefault(); step === 1 ? send() : verify(); };
  $('#chg').onclick = function () { step = 1; $('#s2').hidden = true; $('#s1').hidden = false; em.focus(); };
  $('#resend').onclick = function () { step = 1; send(); };
}

/* ================= APP SHELL (v3: dark creative workspace) ================= */
var VOO = function () { return (CFG && CFG.voosquare) || {}; };
function navLink(k, extra) { return '<a class="nv" href="#' + k + '" data-r="' + k + '">' + I(NIC[k], 19) + '<span>' + TITLES[k] + '</span>' + (extra || '') + '</a>'; }
function startApp() {
  var initials = (ME.name || ME.email || '?').trim()[0].toUpperCase();
  root.innerHTML = '<div class="shell"><aside class="side" id="side" aria-label="Menu">' +
    '<a class="logo" href="#home"><span class="mark" aria-hidden="true"><i></i><i></i></span><span class="lword">Vooads</span></a>' +
    '<a class="newad" href="#home" data-new="1">' + I('plus', 18) + '<span>New ad</span></a>' +
    '<nav class="rail">' + navLink('home') + navLink('library') + navLink('media') + navLink('actors') + navLink('brand') + navLink('wallet') + navLink('learn') + navLink('support', '<span class="badge" id="supB" hidden>1</span>') + '</nav>' +
    '<div class="sgrp">More</div><nav class="rail sm">' + navLink('shield') + navLink('refer') + navLink('apps') + navLink('settings') + '</nav>' +
    '<div class="wallet" id="walletW"></div>' +
    '<a class="partof" href="' + esc(VOO().home_url || 'https://voosquare.com') + '" rel="noopener">Part of VooSquare</a></aside><div class="scrim" id="scrim"></div>' +
    '<div class="main"><header class="tbar"><button class="ham" id="ham" aria-label="Open menu">' + I('menu', 20) + '</button><h1 id="ptitle">Create</h1><div class="r"><button class="learnb" id="learnB" type="button">' + I('play', 14) + '<span>How it works</span></button><a class="cpill" href="#wallet" id="cpill"><span class="cdot" aria-hidden="true"></span><span class="num" id="cbal">0</span><span class="cl">credits</span></a><button class="av" id="avb" aria-label="Settings">' + esc(initials) + '</button></div></header>' +
    '<div id="page"></div></div></div>' +
    '<nav class="dock" aria-label="Quick menu"><a href="#home" data-r="home">' + I('spark', 21) + '<span>Create</span></a><a href="#library" data-r="library">' + I('library', 21) + '<span>Projects</span></a><a href="#create" class="mk" data-r="create" aria-label="New ad">' + I('plus', 24) + '</a><a href="#wallet" data-r="wallet">' + I('credits', 21) + '<span>Credits</span></a><button type="button" id="dockMore">' + I('menu', 21) + '<span>More</span></button></nav>' +
    '<a class="sup-fab" href="#support" id="supFab" aria-label="Help">' + I('headset', 18) + '<span class="t">Help</span></a>';
  $('#ham').onclick = function () { document.body.classList.add('menu'); };
  $('#dockMore').onclick = function () { document.body.classList.add('menu'); };
  $('#scrim').onclick = function () { document.body.classList.remove('menu'); };
  $('#avb').onclick = function () { go('#settings'); };
  $('#learnB').onclick = function () { VooTrainer.open({ match: 'getting started' }); };
  paintWallet();
  if (wantPlan && location.hash !== '#wallet') history.replaceState(null, '', '/app' + location.search + '#wallet');
  if (!startApp._wired) {
    startApp._wired = true;
    document.addEventListener('click', function (e) {
      if (!ME || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var u; try { u = new URL(a.href, location.href); } catch (er) { return; }
      if (!u.hash || u.hash.length < 2 || u.origin !== location.origin || u.pathname !== location.pathname || u.search !== location.search) return;
      e.preventDefault(); go(u.hash);
    });
    addEventListener('hashchange', onNav);
    addEventListener('popstate', onNav);
  }
  window.VooStudio = { api: api, modal: modal, toast: toast, openJob: openJob, go: go, refreshMe: refreshMe, paintWallet: paintWallet, upsell: upsell, copy: copy, I: I, me: function () { return ME; }, addJob: function (j) { JOBS.unshift(j); } };
  var manualId = window.VooStudioX && qs.get('manual');
  if (manualId) history.replaceState(null, '', '/app' + location.hash);
  loadTypes().then(onRoute).then(function () { if (manualId) VooStudioX.manual(manualId); });
  if (qs.get('paid')) { toast('Payment received. Your credits are in.'); refreshMe(); history.replaceState(null, '', '/app' + location.hash); }
  if (qs.get('cancelled')) { toast('Checkout cancelled. Nothing was charged.'); history.replaceState(null, '', '/app' + location.hash); }
  if (qs.get('voo') === 'linked') { toast('Your VooSquare account is connected.'); history.replaceState(null, '', '/app' + location.hash); }
  if (qs.get('welcome')) history.replaceState(null, '', '/app' + location.hash);
  pollSupport(); setInterval(pollSupport, 30000);
}
function paintWallet() {
  if (!ME) return;
  var b = ME.balance, p = ME.plan;
  var old = Number(($('#cbal') || {}).textContent ? $('#cbal').textContent.replace(/,/g, '') : 0);
  $('#cbal').textContent = fmt(b.total);
  if (old && old !== b.total) { var c = $('#cpill'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  var cap = p ? p.credits_month : ((CFG.free_trial && CFG.free_trial.credits) || Math.max(1, b.total));
  var pct = Math.max(0, Math.min(100, Math.round(b.total / Math.max(1, cap) * 100)));
  $('#walletW').innerHTML = '<div class="wtop"><small>Credits</small><span class="wplan">' + (p ? esc(p.name) : 'Free trial') + '</span></div><div class="bal num">' + fmt(b.total) + '</div><div class="wbar"><i style="transform:scaleX(' + (pct / 100) + ')"></i></div><div class="plan">' + (p ? (p.auto_renew ? 'Renews ' : 'Ends ') + esc((p.expires_at || '').slice(0, 10)) : 'Videos unlock on any plan') + '</div><a class="btn ' + (p ? 'ghost' : 'blue') + ' sm" href="#wallet">' + (p ? 'Top up' : 'Pick a plan') + '</a>';
}

/* ================= CREATE (home) ================= */
// Business templates: what a beginner picks first. Each fills the ad builder; nothing runs until they press Generate.
var BIZ = [
  { k: 'restaurant', t: 'Restaurant promo', d: 'Food close-ups, a warm offer', pipe: 'video', style: 'lifestyle', v: 'biz-cafe-promo', ph: 'Our café: fresh oat lattes and pastries, first coffee free this week', det: 'Warm close-ups of the food and drinks, friendly staff, end on the offer.' },
  { k: 'launch', t: 'Product launch', d: 'Premium product shots', pipe: 'video', style: 'product', v: 'style-product-headphones', ph: 'New matte wireless headphones with 40-hour battery', det: 'Fast premium cuts, studio light, the product in hand at the end.' },
  { k: 'sale', t: 'Shop sale', d: 'A person talks about the deal', pipe: 'ugc', v: 'sample-cafe', ph: 'Weekend sale at our boutique: 30% off knitwear', presenterDesc: 'friendly shop owner in a bright fashion boutique with clothing racks' },
  { k: 'property', t: 'Real estate tour', d: 'A smooth listing walkthrough', pipe: 'video', style: 'lifestyle', v: 'biz-real-estate', ph: 'Bright three-bedroom home for sale with a big kitchen', det: 'Smooth walkthrough from the entrance into the living room and kitchen, afternoon light, no people.' },
  { k: 'testimonial', t: 'Testimonial style', d: 'A happy customer story', pipe: 'ugc', v: 'ugc-sunscreen', ph: 'Daily SPF 50 sunscreen that leaves no white cast', angle: 'customer story' },
  { k: 'app', t: 'App ad', d: 'Explain your app simply', pipe: 'ugc', v: 'ugc-saas', ph: 'Budget planner app that sorts every payment for you' },
];
// Ad styles as visual tiles. Each opens the builder on that format.
var STYLES = [
  { t: 'UGC talking', pipe: 'ugc', v: 'ugc-serum' },
  { t: 'Street interview', pipe: 'ugc', v: 'style-street-interview', presenterDesc: 'cheerful person on a sunny city sidewalk, an interviewer holds a small handheld microphone toward them' },
  { t: 'Podcast clip', id: 'ugc_podcast', pipe: 'ugc', v: 'sample-podcast' },
  { t: 'Fast-cut product', pipe: 'video', style: 'product', v: 'style-product-headphones' },
  { t: 'Green-screen reaction', id: 'ugc_greenscreen', pipe: 'ugc', v: 'ugc-saas' },
  { t: 'Photo to video', pipe: 'image_to_video', v: 'ugc-sneakers' },
  { t: 'Animated ad', pipe: 'motion_ad', v: 'ad-skincare-v2' },
  { t: 'Slideshow', pipe: 'slideshow', v: 'ad-app-v2' },
  { t: 'Dub to a language', pipe: 'dub', v: 'ugc-serum-es' },
  { t: 'Hook remix', pipe: 'hook_remix', v: 'ugc-protein' },
  { t: 'Auto-edit my video', pipe: 'auto_edit', v: 'life-phone-scroll' },
  { t: 'Change background', pipe: 'bg_swap', v: 'life-creator-filming' },
];
// Silent, looping style cards at the top of Create. Tapping one picks the style for the prompt box.
var REEL = [
  { k: 'ugc', t: 'UGC', v: 'ugc-serum', g: { pipe: 'ugc' } },
  { k: 'street', t: 'Street interview', v: 'style-street-interview', g: { pipe: 'ugc', presenterDesc: 'cheerful person on a sunny city sidewalk, an interviewer holds a small handheld microphone toward them' } },
  { k: 'product', t: 'Product', v: 'style-product-headphones', g: { pipe: 'video', style: 'product' } },
  { k: 'cafe', t: 'Café promo', v: 'biz-cafe-promo', g: { pipe: 'video', style: 'lifestyle' } },
  { k: 'podcast', t: 'Podcast', v: 'sample-podcast', g: { pipe: 'ugc', id: 'ugc_podcast' } },
  { k: 'property', t: 'Real estate', v: 'biz-real-estate', g: { pipe: 'video', style: 'lifestyle', det: 'Smooth walkthrough of the home, rooms full of daylight, no people.' } },
];
// ?format=<key> (from the website's "Make one like this") preselects that style; it survives the sign-up step.
var reelPick = (function () { var f = qs.get('format') || ''; try { if (f) localStorage.setItem('va_format', f); else f = localStorage.getItem('va_format') || ''; } catch (e) {} return REEL.some(function (x) { return x.k === f; }) ? f : null; })();
var SELLS = [['restaurant', 'Restaurant or café', 'other'], ['shop', 'Shop or fashion', 'ecom'], ['beauty', 'Beauty or salon', 'beauty'], ['property', 'Real estate', 'other'], ['coach', 'Coaching or courses', 'other'], ['ecom', 'Online store', 'ecom'], ['app', 'App or software', 'apps'], ['service', 'Local service', 'other'], ['igaming', 'iGaming offers', 'other'], ['trading', 'Trading app', 'finance']];
var SELL_TPL = { restaurant: ['restaurant', 'sale', 'testimonial'], shop: ['sale', 'launch', 'testimonial'], beauty: ['testimonial', 'launch', 'sale'], property: ['property', 'testimonial', 'app'], coach: ['testimonial', 'app', 'launch'], ecom: ['launch', 'testimonial', 'sale'], app: ['app', 'testimonial', 'launch'], service: ['testimonial', 'sale', 'restaurant'], igaming: ['app', 'testimonial', 'launch'], trading: ['app', 'testimonial', 'launch'] };
var MEDIA = function (n, ext) { return '/samples/' + n + '.' + (ext || 'mp4'); };
function vtFor(pipe, id) { return (id && vtById(id)) || VT.find(function (t) { return t.pipeline === pipe && !t.locked; }) || VT.find(function (t) { return t.pipeline === pipe; }); }
// Start a draft in the builder from a template, a style tile or the prompt box.
function startDraft(o) {
  var t = o.kind && (TOOLS[o.kind] || vtById(o.kind)) ? null : vtFor(o.pipe, o.id);
  var kind = o.kind || (t ? t.id : defaultKind());
  if (t && t.locked) { upsell(t.locked_reason, t.name); return; }
  B = newDraft(kind);
  if (o.product) B.product = o.product;
  if (o.style) B.style = o.style;
  if (o.det) B.details = o.det;
  if (o.angle) B.angle = o.angle;
  if (o.presenterDesc) { B.presenter = 'custom'; B.presenter_desc = o.presenterDesc; }
  if (o.presenter) B.presenter = o.presenter;
  go('#create?type=' + kind);
}
// The prompt box: pick the most likely format from the words, put the whole line in as the product brief.
function guessFromPrompt(text) {
  var s = text.toLowerCase();
  var has = function (re) { return re.test(s); };
  var plan = !!ME.plan;
  if (!plan) return { kind: has(/script/) ? 'script' : has(/image|photo|picture|banner/) ? 'image' : 'hooks' };
  if (has(/podcast/)) return { pipe: 'ugc', id: 'ugc_podcast' };
  if (has(/dub|translate|in spanish|in french|in portuguese|in arabic/)) return { pipe: 'dub' };
  if (has(/slideshow|slides|carousel/)) return { pipe: 'slideshow' };
  if (has(/animated|motion|kinetic|text on screen/)) return { pipe: 'motion_ad' };
  if (has(/street|interview|vox pop/)) return { pipe: 'ugc', presenterDesc: STYLES[1].presenterDesc };
  if (has(/tour|walkthrough|property|home for sale|apartment|house/)) return { pipe: 'video', style: 'lifestyle' };
  if (has(/launch|product shot|b-roll|broll|unbox|cinematic|headphones|bottle|sneaker/)) return { pipe: 'video', style: has(/unbox/) ? 'unboxing' : 'product' };
  if (has(/caf[eé]|restaurant|food|menu|kitchen|bakery/)) return { pipe: 'video', style: 'lifestyle' };
  return { pipe: 'ugc' };
}
function tile(v, label, sub, attrs, lock) {
  return '<button class="tile" ' + attrs + '><span class="tv"><img src="' + MEDIA(v, 'webp') + '" alt="" loading="lazy"><video muted loop playsinline preload="none" data-src="' + MEDIA(v) + '"></video></span>' + (lock ? '<span class="tlock">' + I('lock', 11, 2.4) + 'Plan</span>' : '') + '<span class="tt"><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>';
}
function wireTiles(el) {
  $$('.tile', el).forEach(function (b) {
    var v = $('video', b); if (!v) return;
    var on = function () { if (!v.src) v.src = v.dataset.src; v.play().then(function () { b.classList.add('playing'); }).catch(function () {}); };
    var off = function () { v.pause(); b.classList.remove('playing'); };
    b.addEventListener('mouseenter', on); b.addEventListener('mouseleave', off); b.addEventListener('focus', on); b.addEventListener('blur', off);
  });
}
// The style reel: videos play only while on screen (and not at all with reduced motion); a tap picks the style.
function wireReel(el, after) {
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var vids = $$('#reel video', el);
  vids.forEach(function (v) { v.muted = true; v.playsInline = true; if (reduce) { v.removeAttribute('autoplay'); v.preload = 'none'; } });
  if (!reduce) {
    var start = function (v) { if (!v.src) v.src = v.dataset.src; var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) start(e.target); else e.target.pause(); }); }, { threshold: 0.2 });
      vids.forEach(function (v) { io.observe(v); });
    } else vids.forEach(start);
  }
  $$('#reel .rcard', el).forEach(function (b) {
    b.onclick = function () {
      var x = REEL.find(function (r) { return r.k === b.dataset.reel; }), t = vtFor(x.g.pipe, x.g.id);
      if (t && t.locked) { upsell(t.locked_reason, t.name); return; }
      reelPick = reelPick === x.k ? null : x.k; try { localStorage.removeItem('va_format'); } catch (e) {}
      $$('#reel .rcard', el).forEach(function (o) { var on = o.dataset.reel === reelPick; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); });
      if (after) after();
      if (reelPick) $('#pq').focus({ preventScroll: true });
    };
  });
}
async function pHome(el) {
  var nm = String(ME.name || '').trim().split(/\s+/)[0];
  var ob = ME.onboarding || {};
  var sell = (ME.brand && ME.brand.sells) || store.get('va_sells') || '';
  var order = SELL_TPL[sell] ? SELL_TPL[sell].concat(BIZ.map(function (x) { return x.k; }).filter(function (k) { return SELL_TPL[sell].indexOf(k) < 0; })) : BIZ.map(function (x) { return x.k; });
  var biz = order.map(function (k) { return BIZ.find(function (x) { return x.k === k; }); });
  var pending = store.get('va_prompt') || '';
  el.innerHTML = '<section class="cx">' +
    '<div class="cx-h"><p class="hi">' + (nm ? 'Hi ' + esc(nm) + '.' : 'Hi.') + '</p><h2>What do you want to make?</h2></div>' +
    '<div class="reel" id="reel" role="radiogroup" aria-label="Pick a style">' + REEL.map(function (x) { var t = vtFor(x.g.pipe, x.g.id); return '<button type="button" class="rcard' + (reelPick === x.k ? ' on' : '') + '" role="radio" aria-checked="' + (reelPick === x.k) + '" data-reel="' + x.k + '"><video muted loop playsinline autoplay preload="metadata" poster="' + MEDIA(x.v, 'webp') + '" data-src="' + MEDIA(x.v) + '"></video><span>' + esc(x.t) + (t && t.locked ? ' ' + I('lock', 10, 2.4) : '') + '</span></button>'; }).join('') + '</div>' +
    '<form class="pbox" id="pbox" autocomplete="off"><textarea id="pq" rows="2" maxlength="600" placeholder="Describe your ad. For example: a 15-second ad for our café’s new oat latte, warm and friendly"></textarea>' +
    '<div class="pbar"><div class="pchips" id="pchips">' + biz.slice(0, 4).map(function (x) { return '<button type="button" data-ph="' + esc(x.ph) + '">' + esc(x.t) + '</button>'; }).join('') + '</div><span class="pq-cost" id="pqCost"></span><button class="btn arrow go" type="submit">Make it ' + ARR() + '</button></div></form>' +
    '<p class="cx-note">You pick the style, length and actor next, and see the exact credits before anything is made.</p><div id="i2vS"></div></section>' +
    (!sell && !ob.sells ? '<section class="sellq" id="sellq"><b>What do you sell?</b><div class="chips" id="sellChips">' + SELLS.map(function (s) { return '<button type="button" class="chip" data-s="' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></section>' : '') +
    '<section class="blk"><div class="ch"><h2>Start from your business</h2></div><div class="tiles biz" id="bizT">' + biz.map(function (x) { var t = vtFor(x.pipe); return tile(x.v, x.t, x.d, 'data-biz="' + x.k + '"', t && t.locked); }).join('') + '</div></section>' +
    '<section class="blk"><div class="ch"><h2>Ad styles</h2><a class="btn ghost sm" href="#create">All formats</a></div><div class="tiles sty" id="styT">' + STYLES.map(function (x, i) { var t = vtFor(x.pipe, x.id); return t ? tile(x.v, x.t, '', 'data-sty="' + i + '"', t.locked) : ''; }).join('') + '</div></section>' +
    '<section class="blk"><div class="ch"><h2>Text and images</h2></div><div class="qtools">' + Object.keys(TOOLS).map(function (k) { var x = TOOLS[k], lk = x.pro && !(ME.plan && ME.plan.scripts); return '<button class="qt" data-tool="' + k + '"><span class="ic2">' + I(x.ic, 20) + '</span><span><b>' + esc(x.name) + '</b><small>' + fmt(x.cost()) + ' credits' + (lk ? ' · Pro' : !ME.plan && k !== 'script' ? ' · free trial' : '') + '</small></span></button>'; }).join('') + '<a class="qt" href="#shield"><span class="ic2">' + I('shield', 20) + '</span><span><b>Ban Shield</b><small>Free ad-safe check</small></span></a></div></section>' +
    '<section class="blk"><div class="ch"><h2>Recent projects</h2><a class="btn ghost sm" href="#library">All projects</a></div><div class="lib" id="recent"><div class="empty" style="grid-column:1/-1"><span class="spinner"></span></div></div></section>';
  var pq = $('#pq');
  if (pending) { pq.value = pending; store.set('va_prompt', ''); }
  // Idea → video preview under the box (i2v.js), the same pattern as the website hero.
  var i2v = window.VooI2V && $('#i2vS') ? VooI2V.mount($('#i2vS'), { base: '/samples/', key: VooI2V.keyFor(pending) || 'cafe' }) : null;
  if (i2v) $('#i2vS').classList.add('dark');
  $$('#pchips button').forEach(function (b) { b.onclick = function () { pq.value = b.dataset.ph; pq.focus(); costHint(); var k = i2v && VooI2V.keyFor(b.dataset.ph + ' ' + b.textContent); if (k) i2v.show(k); }; });
  var costHint = function () {
    var v = pq.value.trim(), picked = REEL.find(function (x) { return x.k === reelPick; }), g = picked ? picked.g : v ? guessFromPrompt(v) : null, c = $('#pqCost');
    if (!g) { c.textContent = ''; return; }
    var t = g.kind ? null : vtFor(g.pipe, g.id);
    c.textContent = g.kind ? (TOOLS[g.kind] ? TOOLS[g.kind].name + ' · ' + fmt(TOOLS[g.kind].cost()) + ' credits' : '') : t ? t.name + (t.unit === 'second' ? ' · from ' + fmt(Math.ceil(t.credits_per_unit * (t.min_seconds || 5))) + ' credits' : '') : '';
  };
  pq.addEventListener('input', costHint); costHint();
  pq.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#pbox').requestSubmit ? $('#pbox').requestSubmit() : $('#pbox').dispatchEvent(new Event('submit')); } });
  $('#pbox').onsubmit = function (e) {
    e.preventDefault();
    var v = pq.value.trim();
    if (v.length < 4) { pq.focus(); toast('Type what you sell or what the ad should show.'); return; }
    var picked = REEL.find(function (x) { return x.k === reelPick; });
    var g = picked && ME.plan ? picked.g : guessFromPrompt(v);
    startDraft(Object.assign({ product: v.slice(0, 300) }, g));
  };
  $$('#bizT .tile').forEach(function (b) { b.onclick = function () { var x = BIZ.find(function (y) { return y.k === b.dataset.biz; }); startDraft({ pipe: x.pipe, style: x.style, product: '', det: x.det, angle: x.angle, presenterDesc: x.presenterDesc }); setTimeout(function () { var p = $('#bProd'); if (p) { p.placeholder = x.ph; p.focus(); } }, 120); }; });
  $$('#styT .tile').forEach(function (b) { b.onclick = function () { var x = STYLES[Number(b.dataset.sty)]; startDraft({ pipe: x.pipe, id: x.id, style: x.style, presenterDesc: x.presenterDesc }); }; });
  $$('.qt[data-tool]').forEach(function (b) { b.onclick = function () { startDraft({ kind: b.dataset.tool }); }; });
  if ($('#sellq')) $$('#sellChips .chip').forEach(function (c) {
    c.onclick = async function () {
      var s = SELLS.find(function (x) { return x[0] === c.dataset.s; });
      store.set('va_sells', s[0]);
      try { var d = await api('PUT', '/api/me', { brand: { name: (ME.brand || {}).name || '', color: (ME.brand || {}).color || '', niche: s[2] === 'other' ? (ME.brand || {}).niche || '' : s[2] }, onboarding: { sells: true } }); ME = d.user; } catch (e) {}
      toast('Got it. Templates for ' + s[1].toLowerCase() + ' are first.');
      pHome(el);
    };
  });
  wireTiles(el);
  wireReel(el, costHint);
  await loadJobs();
  if (route !== 'home') return;
  $('#recent').innerHTML = JOBS.length ? JOBS.slice(0, 8).map(libItem).join('') : '<div class="empty" style="grid-column:1/-1"><b>No projects yet</b><p>Type what you sell above, or pick a template. Your ads show up here.</p></div>';
  wireLib($('#recent'));
}

/* ================= LIBRARY (every finished file) ================= */
async function pMedia(el) {
  el.innerHTML = '<div class="ch"><div class="seg" id="mf">' + [['video', 'Videos'], ['image', 'Images'], ['text', 'Hooks and scripts'], ['music', 'Music']].map(function (x, i) { return '<button data-f="' + x[0] + '"' + (i ? '' : ' class="on"') + '>' + x[1] + '</button>'; }).join('') + '</div></div><div class="lib" id="medG"><div class="empty" style="grid-column:1/-1"><span class="spinner"></span></div></div>';
  await loadJobs();
  if (route !== 'media') return;
  var f = 'video';
  var kindOf = function (j) { if (j.type === 'brand_music') return 'music'; if (j.type === 'image') return 'image'; if (['hooks', 'angles', 'script'].indexOf(j.type) >= 0) return 'text'; if (j.type === 'tool') return (j.input && j.input.output) === 'image' ? 'image' : (j.input && j.input.kind) === 'video' ? 'video' : 'text'; return 'video'; };
  var paint = function () {
    var list = JOBS.filter(function (j) { return j.status === 'done' && kindOf(j) === f; });
    $('#medG').innerHTML = list.length ? list.map(libItem).join('') : '<div class="empty" style="grid-column:1/-1"><b>Nothing here yet</b><p>Finished files land here, ready to download.</p><a class="btn blue" href="#home">Make something</a></div>';
    wireLib($('#medG'));
  };
  $('#mf').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; f = b.dataset.f; $$('#mf button').forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); };
  paint();
}

/* ================= ACTORS ================= */
function pActors(el) {
  if (window.VooP2) return VooP2.actors(el);
  var ps = CFG.presenters || [];
  var ugc = vtFor('ugc');
  el.innerHTML = '<p class="lead muted">Every actor is AI-generated. Pick one for a UGC video, or describe a new one.</p>' +
    '<div class="actors">' + ps.map(function (p) { return '<button class="actor" data-p="' + esc(p.id) + '"><span class="ph"><img src="' + esc(String(p.img || '').replace(/\.png$/, '.webp')) + '" alt="" loading="lazy" data-fallback="' + esc(p.img || '') + '"></span><b>' + esc(p.name) + '</b><small>Use in a video</small></button>'; }).join('') +
    '<button class="actor new" id="actNew"><span class="ph">' + I('plus', 26) + '</span><b>Describe an actor</b><small>Age, look, setting</small></button></div>' +
    (ugc && ugc.locked ? '<div class="card note">' + I('lock', 16) + ' Videos with actors unlock on any plan. <a href="#wallet">See plans</a></div>' : '');
  $$('.actor[data-p]', el).forEach(function (b) { b.onclick = function () { startDraft({ pipe: 'ugc', presenter: b.dataset.p }); }; });
  $('#actNew').onclick = function () { startDraft({ pipe: 'ugc', presenterDesc: ' ' }); setTimeout(function () { var x = $('#bPd'); if (x) { x.value = ''; B.presenter_desc = ''; x.focus(); } }, 150); };
}

/* ================= BRAND KIT ================= */
function pBrand(el) {
  var br = ME.brand || {};
  el.innerHTML = '<div class="g2"><div class="card" id="brandCard"><h2>Your brand</h2><p class="muted">Every script, hook and animated ad uses these.</p>' +
    '<div class="fld"><label for="kBn">Brand name</label><input class="inp" id="kBn" maxlength="40" value="' + esc(br.name || '') + '" placeholder="e.g. Northwind Coffee"></div>' +
    '<div class="fld"><label for="kBni">What you sell</label><select class="inp" id="kBni">' + NICHES.map(function (n) { return '<option value="' + n[0] + '"' + (br.niche === n[0] ? ' selected' : '') + '>' + n[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="fld"><label for="kBc">Brand colour</label><div class="colrow"><input type="color" id="kBc" value="' + esc(/^#[0-9a-f]{6}$/i.test(br.color || '') ? br.color : '#1E4DFF') + '"><span class="muted">Used for captions, end cards and animated ads</span></div></div>' +
    '<div class="fld"><span class="lbl">Logo</span><label class="upl"><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="kLogo">' + (br.logo_url ? '<img src="' + esc(br.logo_url) + '" alt="Your logo">' : '<span class="ph">' + I('upload', 22) + '</span>') + '<div><b style="font-size:14.5px" id="kLogoT">' + (br.logo_url ? 'Logo added' : 'Add your logo') + '</b><small class="muted" style="display:block;font-size:12.5px">PNG with a transparent background works best. Shown in the corner and on the end card.</small></div></label></div>' +
    '<div class="fld"><label for="kCta">End card text</label><input class="inp" id="kCta" maxlength="30" value="' + esc(br.cta || '') + '" placeholder="Shop now · 20% off today"></div>' +
    '<label class="sw" style="margin:4px 0 14px"><input type="checkbox" id="kAi"' + (br.ai_label_auto ? ' checked' : '') + '><span class="k"></span><span><b>Add an "AI-generated" label to every edit</b><small class="muted" style="display:block;font-size:12.5px">A small note in the corner of each new version you make with chat editing.</small></span></label>' +
    '<button class="btn blue" id="kSave">Save brand</button></div>' +
    '<div class="card"><h2>Brand music</h2><p class="muted">A track or jingle made for your brand. Make it once, then use it on any video for free.</p><div id="kTracks" class="tracks"><span class="spinner"></span></div><a class="btn ghost" href="#create?type=brand_music">Make brand music</a></div></div>';
  $('#kSave').onclick = async function () { try { var d = await api('PUT', '/api/me', { brand: { name: $('#kBn').value, niche: $('#kBni').value, color: $('#kBc').value, logo_url: br.logo_url || undefined, cta: $('#kCta').value, ai_label_auto: $('#kAi').checked }, onboarding: { brand: true } }); ME = d.user; toast('Brand saved'); } catch (e) { toast(e.message, true); } };
  $('#kLogo').onchange = async function () {
    var f = this.files[0]; if (!f) return;
    try { var r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f, credentials: 'same-origin' }); var j = await r.json(); if (!r.ok) throw new Error(j.error || 'Upload failed'); br.logo_url = j.url; $('#kLogoT').textContent = 'Logo added · press Save brand'; } catch (e) { toast(e.message, true); }
  };
  var paintT = function () {
    var list = window.VooEdit && VooEdit.tracks ? VooEdit.tracks() || [] : [];
    $('#kTracks').innerHTML = list.length ? list.map(function (t) { return '<div class="ktrk"><b>' + esc(t.name || 'Brand track') + '</b><audio controls preload="none" src="' + esc(t.url || '') + '"></audio></div>'; }).join('') : '<p class="muted">No brand tracks yet.</p>';
  };
  if (window.VooEdit) VooEdit.loadTracks(api).then(paintT).catch(paintT); else paintT();
}

async function refreshMe() { try { var d = await api('GET', '/api/me'); if (!d.user) { location.reload(); return; } ME = d.user; paintWallet(); } catch (e) {} }

async function loadTypes() {
  try {
    var d = await api('GET', '/api/video-types');
    VT = (d.video_types || []).filter(function (t) { return t.enabled !== false; }); ADDONS = d.addons || null; VT_FALLBACK = false;
    if (!VT.length) throw 0;
  } catch (e) {
    VT_FALLBACK = true;
    var p = ME.plan, lock = p ? null : 'Video needs a paid plan. Trial credits cover images and hooks only.';
    VT = [
      { id: 'ugc', name: 'UGC talking video', description: 'A real-looking creator talks about your product', pipeline: 'ugc', unit: 'second', credits_per_unit: CFG.costs.ugc_video_per_second, segment_seconds: 10, min_seconds: 5, max_seconds: p ? p.max_ugc_seconds : 0, locked: !!lock, locked_reason: lock, badge: 'Most used' },
      { id: 'video', name: 'Product video', description: 'B-roll, unboxing, lifestyle or app demo', pipeline: 'video', unit: 'second', credits_per_unit: CFG.costs.video_per_second, segment_seconds: 10, min_seconds: 5, max_seconds: p ? p.max_video_seconds : 0, locked: !!lock, locked_reason: lock },
    ];
  }
}

function parseHash() {
  var h = (location.hash || '#home').slice(1);
  var q = h.split('?'), parts = q[0].split('/');
  return { page: parts[0], sub: decodeURIComponent(parts.slice(1).join('/') || ''), q: new URLSearchParams(q[1] || '') };
}
// Navigate inside the studio. Uses pushState (no fragment navigation), then renders the page directly.
var routedHash = null;
function go(h, replace) {
  h = String(h || '#home'); if (h.charAt(0) !== '#') h = '#' + h;
  try { history[replace ? 'replaceState' : 'pushState'](null, '', h); } catch (e) { location.hash = h; return; }
  onRoute();
}
function onNav() { if (location.hash !== routedHash) onRoute(); }
function onRoute() {
  routedHash = location.hash;
  var r = parseHash(), h = r.page;
  if (h === 'signup' || h === 'login') h = 'home';
  if (!TITLES[h]) h = 'home';
  route = h; sub = r.sub;
  document.body.classList.remove('menu');
  document.body.classList.toggle('creating', h === 'create');
  $$('.nv,.dock a').forEach(function (a) { a.classList.toggle('on', a.dataset.r === h); });
  document.body.setAttribute('data-page', h);
  $('#ptitle').textContent = TITLES[h];
  document.title = TITLES[h] + ' · Vooads Studio';
  $('#supFab').classList.toggle('hide', h === 'support' || h === 'create');
  var pg = $('#page'); pg.innerHTML = '<div class="page" id="pg"></div>';
  closeCoach(); clearInterval(tickT);
  $$('.modal').forEach(function (m) { if (m._close) { m._onclose = null; m._close(); } else m.remove(); });
  ({ home: pHome, create: pCreate, library: pLibrary, media: pMedia, actors: pActors, brand: pBrand, shield: pShield, learn: pLearn, wallet: pWallet, refer: pRefer, apps: pApps, support: pSupport, settings: pSettings }[h])($('#pg'), r);
  scrollTo(0, 0);
}

/* ================= LIVE GUIDE + COACH ================= */
function flowSteps() {
  var ob = ME.onboarding || {}, made = JOBS.filter(function (j) { return j.status === 'done'; });
  return [
    { k: 'brand', t: 'Your brand', d: 'Tell us what you sell', done: !!(ME.brand && ME.brand.name) || !!ob.brand, go: '#settings', sel: '#brandCard', tip: 'Add your brand name and niche. Every script and hook gets written for it.' },
    { k: 'hooks', t: 'First hooks', d: 'Free on your trial', done: made.some(function (j) { return j.type === 'hooks'; }) || !!ob.hooks, go: '#create?type=hooks', sel: '#tyGrid', tip: 'Hook packs work on your free credits. Pick “Hook pack”, type your product and tap Generate.' },
    { k: 'shield', t: 'Ban Shield', d: 'Check your copy', done: !!ob.shield, go: '#shield', sel: '#shText', tip: 'Paste any ad copy here. Ban Shield flags risky lines and rewrites them.' },
    { k: 'plan', t: 'Unlock video', d: 'Pick a plan', done: !!ME.plan, go: '#wallet', sel: '#plansGrid', tip: 'Videos unlock on any plan. Pro adds the AI script writer.' },
    { k: 'ugc', t: 'First UGC video', d: 'Your creator talks', done: made.some(function (j) { return j.type === 'ugc'; }), go: '#create', sel: '#tyGrid', tip: 'Pick “UGC talking video”, choose a creator and a language, then Generate.' },
  ];
}
function flowHTML() {
  var s = flowSteps(), cur = s.findIndex(function (x) { return !x.done; });
  if (cur < 0) return '<div class="flow"><span class="live"><span class="dot-live ok"></span>All set</span><h2 class="hx2">You know your way around. <span class="g">Time to scale.</span></h2><p style="color:#A19E95">More angles, more languages, more sizes. Winners come from volume.</p><a class="btn arrow lt" href="#create" style="justify-self:start">Make another ad ' + ARR() + '</a></div>';
  var pct = s.length > 1 ? cur / (s.length - 1) : 0;
  return '<div class="flow" id="flow"><div class="ch"><span class="live"><span class="dot-live ok"></span>Live guide · step ' + (cur + 1) + ' of ' + s.length + '</span><button class="btn xs" style="background:#1A1917;color:#A19E95" id="hideFlow">Hide guide</button></div>' +
    '<div class="path"><span class="prog" style="width:' + (pct * 80) + '%"></span><span class="runner" style="left:' + (10 + pct * 80) + '%"></span>' +
    s.map(function (x, i) { return '<button class="node ' + (x.done ? 'done' : i === cur ? 'now' : '') + '" data-i="' + i + '"><span class="dot">' + (x.done ? I('check', 20, 2.4) : (i + 1)) + '</span><b>' + x.t + '</b><small>' + x.d + '</small></button>'; }).join('') + '</div>' +
    '<div class="nextbox"><div class="t"><b>Next: ' + s[cur].t + '</b><p>' + s[cur].tip + '</p></div><button class="btn arrow lt" id="showMe">Show me where ' + ARR() + '</button></div></div>';
}
function wireFlow(el) {
  var s = flowSteps(), cur = s.findIndex(function (x) { return !x.done; });
  var goStep = function (i) { var x = s[i]; go(x.go); setTimeout(function () { coach(x.sel, x.t, x.tip, i + 1, s.length); }, 500); };
  $$('.node', el).forEach(function (n) { n.onclick = function () { goStep(Number(n.dataset.i)); }; });
  if ($('#showMe', el)) $('#showMe', el).onclick = function () { goStep(cur); };
  if ($('#hideFlow', el)) $('#hideFlow', el).onclick = function () { saveOb({ hide_flow: true }); toast('Guide hidden. Turn it back on in Settings.'); if (route === 'home') onRoute(); else $('#flow').remove(); };
}
function saveOb(o) { ME.onboarding = Object.assign({}, ME.onboarding || {}, o); api('PUT', '/api/me', { onboarding: o }).catch(function () {}); }
var coachEl = null;
function coach(sel, title, text, n, total) {
  closeCoach();
  var t = $(sel); if (!t) return;
  t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  coachEl = document.createElement('div'); coachEl.className = 'coach';
  coachEl.innerHTML = '<div class="ring"></div><span class="pointer"><svg width="34" height="34" viewBox="0 0 24 24"><path d="M5 3.5 19 11l-6.2 1.6L10 19z" fill="#0B0B0A" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></span><div class="tip" role="dialog" aria-label="Guide"><div class="hd">' + FACE(36, 'brand talking') + '<b>' + esc(title) + '</b></div><p>' + esc(text) + '</p><div class="ft"><small>' + (n ? 'step ' + n + ' of ' + total : '') + '</small><button class="btn solid sm" id="cgot">Got it</button></div></div>';
  document.body.appendChild(coachEl); document.body.classList.add('coaching');
  var place = function () {
    if (!coachEl) return;
    var r = t.getBoundingClientRect(), ring = $('.ring', coachEl), tip = $('.tip', coachEl), ptr = $('.pointer', coachEl);
    ring.style.left = (r.left - 8) + 'px'; ring.style.top = (r.top - 8) + 'px'; ring.style.width = (r.width + 16) + 'px'; ring.style.height = (r.height + 16) + 'px';
    // Keep the tip clear of the fixed phone dock and the Help launcher, so they stay tappable while the guide is open.
    var floor = innerHeight;
    ['.dock', '#supFab'].forEach(function (q) { var f = $(q); if (!f || getComputedStyle(f).display === 'none') return; var fr = f.getBoundingClientRect(); if (fr.height && fr.top > innerHeight / 2) floor = Math.min(floor, fr.top - 12); });
    var tw = tip.offsetWidth, th = tip.offsetHeight, below = r.bottom + 20 + th < floor;
    tip.style.left = Math.max(16, Math.min(innerWidth - tw - 16, r.left + r.width / 2 - tw / 2)) + 'px';
    tip.style.top = Math.max(16, Math.min(floor - th, below ? r.bottom + 20 : r.top - th - 20)) + 'px';
    ptr.style.left = (r.left + Math.min(r.width - 20, 40)) + 'px'; ptr.style.top = (r.top + Math.min(r.height - 10, 30)) + 'px';
  };
  setTimeout(place, 400); place();
  addEventListener('resize', place); addEventListener('scroll', place, { passive: true });
  coachEl._off = function () { removeEventListener('resize', place); removeEventListener('scroll', place); };
  $('#cgot', coachEl).onclick = closeCoach;
}
function closeCoach() { document.body.classList.remove('coaching'); if (coachEl) { coachEl._off(); coachEl.remove(); coachEl = null; } }

/* ================= HOME ================= */
var tickT = null;
// Credits wallet: a jar of orange fuel plus what the balance buys right now.
function creditGets() {
  var b = ME.balance, p = ME.plan, c = CFG.costs || {};
  var n = function (cost) { return cost ? fmt(Math.floor(b.total / cost)) : '–'; };
  var rows = [];
  if (p) rows.push(['ugc', 'UGC videos', '≈ ' + fmt(Math.floor(b.total / u15()))]);
  rows.push(['hooks', 'Hook packs', n(c.hook_pack_20)]);
  rows.push(['image', 'Image sets', n(c.image_3_sizes)]);
  rows.push(['shield', 'Ban Shield', 'Free']);
  if (!p) rows.push(['video', 'Video ads', '<span class="lk">' + I('lock', 12, 2.2) + 'Plan</span>']);
  return '<div class="wc-gets"><span>What ' + fmt(b.total) + ' credits gets you</span>' + rows.map(function (r) { return '<div class="wc-row"><span class="ri">' + T(r[0], 20) + '</span><b>' + r[1] + '</b><em' + (/lk/.test(r[2]) ? ' class="lk"' : '') + '>' + r[2] + '</em></div>'; }).join('') + '</div>';
}
function walletCard() {
  var b = ME.balance, p = ME.plan;
  var cap = p ? p.credits_month : ((CFG.free_trial && CFG.free_trial.credits) || Math.max(1, b.total));
  return '<div class="wcard" id="wCard"><div class="wc-top"><b>' + T('credits', 22) + 'Your credits</b><span class="wc-plan' + (p ? ' paid' : '') + '">' + (p ? esc(p.name) + ' plan' : 'Free trial') + '</span></div>' +
    '<div class="wc-mid"><div class="wc-num"><b class="num" id="wNum">0</b><small>' + (p ? 'of ' + fmt(cap) + ' this month' : 'free credits to spend') + '</small></div><div class="wc-jar">' + (TN ? TN.jar(b.total / Math.max(1, cap)) : '') + '</div></div>' +
    creditGets() +
    '<a class="btn arrow' + (p ? '' : ' hot') + '" href="#wallet">' + (p ? 'Top up credits' : 'Unlock video') + ' ' + ARR() + '</a></div>';
}
function quick() {
  var vt = function (pipe) { return VT.find(function (t) { return t.pipeline === pipe; }); };
  var q = [];
  var u = vt('ugc'); if (u) q.push(['#create?type=' + u.id, 'ugc', 'UGC video', 'Creator talks about your product', u.locked]);
  var v = vt('video'); if (v) q.push(['#create?type=' + v.id, 'film', 'Product b-roll', 'Shots, unboxing, demo', v.locked]);
  var ma = VT.find(function (t) { return t.pipeline === 'motion_ad' && !t.locked; }) || VT.find(function (t) { return t.pipeline === 'motion_ad'; }); if (ma) q.push(['#create?type=' + ma.id, 'spark', 'Animated ad', 'Footage, text, voice, music', ma.locked]);
  var s = vt('slideshow'); if (s) q.push(['#create?type=' + s.id, 'slides', 'Slideshow', 'Slides, voice, captions', s.locked]);
  q.push(['#create?type=hooks', 'hooks', 'Hook pack', '20 hooks for ' + CFG.costs.hook_pack_20 + ' credits']);
  q.push(['#create?type=angles', 'target', 'Angles', '10 angles with hooks']);
  q.push(['#shield', 'shield', 'Ban Shield', 'Free policy check']);
  return q.slice(0, 6).map(function (x) { return '<a href="' + x[0] + '"><span class="ic2">' + T(x[1], 24) + '</span><span><b>' + x[2] + '</b><small>' + x[3] + '</small></span>' + (x[4] ? '<span class="pill plain">' + I('lock', 11, 2.2) + 'Plan</span>' : '') + '</a>'; }).join('');
}
function partOf(j) { var m = /part (\d+) of (\d+)/i.exec(j.step || ''); return m ? { k: Number(m[1]), n: Number(m[2]) } : null; }
function presName(id) { var p = (CFG.presenters || []).find(function (x) { return x.id === id; }); return p ? p.name : null; }
function jobIcon(j) { return PIPE_IC[j.type] || (TOOLS[j.type] || {}).ic || 'film'; }
// Speech bubble over one of the crew (0 editor, 1 presenter, 2 camera). The speaker's mouth moves while it shows.
function crewSay(seat, html, delay) {
  setTimeout(function () {
    var set = $('#slSet'); if (!set || !TN) return;
    $$('.crew-bub', set).forEach(function (x) { x.remove(); });
    var h = TN.crewHead(seat), d = document.createElement('div');
    d.className = 'crew-bub' + (seat === 0 ? ' l' : seat === 2 ? ' r' : '');
    d.style.left = h.x + '%'; d.style.top = h.y + '%'; d.innerHTML = html;
    set.appendChild(d); setTimeout(function () { d.remove(); }, 3000);
    var who = $('.tn-p.c' + seat, set); if (who) { who.classList.add('talking'); setTimeout(function () { who.classList.remove('talking'); }, 1900); }
  }, delay || 0);
}
var CREW_LINES = [
  ['Captions look clean ✓', 'Spanish version done ✓', 'Rendering your 9:16…', 'Ban Shield says 94 ✓', 'Cutting the b-roll'],
  ['Hook 3 is a <em>banger</em>!', 'Stop scrolling. Look!', 'One more take?', 'This one will sell'],
  ['And… action!', 'The light is perfect', 'Got it in one take ✓', 'Rolling in 3, 2, 1'],
];
// Studio live: the crew on Home reacts to real jobs. Typing speeds up, REC blinks, everyone cheers when an ad lands.
function startTicker() {
  var seen = {}, tick = 0, today = new Date().toDateString();
  JOBS.forEach(function (j) { seen[j.id] = j.status; });
  var running = function (j) { return j.status !== 'done' && j.status !== 'failed'; };
  var paintCount = function () {
    var c = $('#slCount'); if (!c) return;
    var made = JOBS.filter(function (j) { return j.status === 'done'; });
    var td = made.filter(function (j) { return new Date(String(j.created_at).replace(' ', 'T') + 'Z').toDateString() === today; }).length;
    c.innerHTML = td || made.length ? (td ? 'Ads today' : 'Ads made') + ' <b>' + fmt(td || made.length) + '</b>' : '<b>' + fmt(ME.balance.total) + '</b> credits ready';
  };
  var cheer = function () {
    var hero = $('#slive'); if (!hero) return;
    hero.classList.add('cheer'); if (TN) TN.burst($('#slStage'), 34);
    crewSay(1, '<em>It’s ready!</em> Go launch it', 0);
    setTimeout(function () { if ($('#slive')) $('#slive').classList.remove('cheer'); }, 2600);
  };
  var paint = function () {
    if (!$('#slive')) return clearInterval(tickT);
    var run = JOBS.filter(running);
    var justDone = JOBS.filter(function (j) { return j.status === 'done' && seen[j.id] && seen[j.id] !== 'done'; });
    JOBS.forEach(function (j) { seen[j.id] = j.status; });
    var hero = $('#slive'), bar = $('#slBar'), seg = $('#slSeg'), pres = $('#slSet .tn-p.c1');
    hero.classList.toggle('busy', !!run.length);
    if (run.length) {
      var j = run[0], pt = partOf(j), n = j.segments || (pt && pt.n) || 1, k = pt ? pt.k : 1, isVid = VIDEO_JOB.indexOf(j.type) >= 0;
      var who = presName(j.input.presenter) || 'Your creator';
      if (pres) pres.classList.toggle('rec', j.type === 'ugc' || j.type === 'hook_remix');
      var what = (j.input.duration && isVid ? j.input.duration + 's ' : '') + (JOB_NAMES[j.type] || j.type) + (j.input.product ? ' · ' + j.input.product : '');
      bar.hidden = false;
      $('#slIc').innerHTML = T(jobIcon(j), 22);
      $('#slH').textContent = j.type === 'ugc' ? who + ' is filming ' + (n > 1 ? 'part ' + k + ' of ' + n : 'your ad') : j.type === 'motion_ad' ? 'Cutting your animated ad' + (n > 1 ? ', scene ' + k + ' of ' + n : '') : isVid ? 'Rendering ' + (n > 1 ? 'part ' + k + ' of ' + n : 'your video') : (j.step && j.step !== 'start' ? j.step : 'Getting started') + '…';
      $('#slP').textContent = what + (run.length > 1 ? ' · +' + (run.length - 1) + ' more in the queue' : '');
      $('#slTag').innerHTML = '<i></i>Studio live · working';
      var pct = Math.max(.06, Math.min(1, j.progress || 0));
      seg.hidden = false; seg.style.setProperty('--n', n);
      seg.innerHTML = n > 1 ? Array.from({ length: n }, function (_, x) { return '<i class="' + (x < k - 1 ? 'd' : x === k - 1 ? 'n' : '') + '" style="--k:.55"></i>'; }).join('') : '<i class="n" style="--k:' + pct.toFixed(2) + '"></i>';
      $('#slGo').textContent = 'Watch'; $('#slGo').onclick = function (e) { e.preventDefault(); openJob(j); };
    } else {
      seg.hidden = true; if (pres) pres.classList.remove('rec');
      var last = JOBS.find(function (x) { return x.status === 'done'; });
      $('#slTag').innerHTML = '<i></i>Studio live';
      if (last) {
        bar.hidden = false;
        $('#slIc').innerHTML = T(jobIcon(last), 22);
        $('#slH').textContent = (JOB_NAMES[last.type] || last.type) + ' is ready';
        $('#slP').textContent = (last.input.product ? last.input.product + ' · ' : '') + 'Winners come from volume. Make the next one.';
        $('#slGo').textContent = 'Open'; $('#slGo').onclick = function (e) { e.preventDefault(); openJob(last); };
      } else bar.hidden = true;
    }
    if (justDone.length) { cheer(); toast(JOB_NAMES[justDone[0].type] + ' ready'); }
    paintCount();
  };
  paint();
  tickT = setInterval(async function () {
    if (route !== 'home') return clearInterval(tickT);
    var busy = JOBS.some(running);
    if (busy) await loadJobs();
    paint();
    tick++;
    if ($('#slive') && $('#slive').classList.contains('cheer')) return;
    var seat = [1, 0, 2][tick % 3];
    if (JOBS.some(running)) {
      var j = JOBS.filter(running)[0], pt = partOf(j);
      crewSay(seat, [pt ? 'Stitching part ' + pt.k + ' of ' + pt.n + '…' : 'Rendering your ' + (j.input.aspect || '9:16') + '…', 'Filming your ad <em>now</em>', 'Rolling… <em>REC</em>'][seat]);
    } else {
      var L = CREW_LINES[seat]; crewSay(seat, L[Math.floor(tick / 3) % L.length]);
      if (seat === 0 && tick % 6 === 3) { var c0 = $('#slSet .tn-p.c0'); if (c0) { c0.classList.add('waving'); setTimeout(function () { c0.classList.remove('waving'); }, 2600); } }
    }
  }, 3000);
}
async function loadJobs() { try { var d = await api('GET', '/api/jobs?limit=100'); JOBS = d.jobs; } catch (e) { JOBS = []; } }

/* ================= CREATE (builder) ================= */
var B = null;
function vtById(id) { return VT.find(function (t) { return t.id === id; }); }
function defaultKind() { var u = VT.find(function (t) { return t.pipeline === 'ugc' && !t.locked; }); return u ? u.id : 'hooks'; }
function newDraft(kind) {
  var prs = CFG.presenters[0];
  return { kind: kind || defaultKind(), product: '', audience: '', angle: '', language: 'en', source_language: 'en', presenter: prs ? prs.id : 'p1', presenter_desc: '', duration: 15, style: 'product', aspect: '9:16', write_script: !!(ME.plan && ME.plan.scripts), script: '', image_url: '', image_prev: '', count: 1, hooks_n: 3, slides: 6, lines: '', hooks_text: '', video_url: '', captions: true, niche: (ME.brand && ME.brand.niche) || '', mstyle: 'bold', brand_color: (ME.brand && /^#[0-9a-f]{6}$/i.test(ME.brand.color || '') ? ME.brand.color : '#1E4DFF'), logo_url: '', logo_prev: '', cta: '', music_on: false, mood: 'upbeat', music_src: 'library', voice_tier: 'standard', level: 'auto', auto_edit: true, brand_finish: !!(ME.brand && ME.brand.logo_url) };
}
function isVT(k) { return !TOOLS[k] && !!vtById(k); }
function curVT() { return isVT(B.kind) ? vtById(B.kind) : null; }
function isMotion(t) { return t && t.pipeline === 'motion_ad'; }
function motionTypes() { return VT.filter(isMotion); }
function hasAddon(t, a) { return !!(t && t.addons && t.addons.indexOf(a) >= 0 && ADDONS && ADDONS[a]); }
function includes(t, a) { return !!(t && t.includes && t.includes.indexOf(a) >= 0); }
function per15(t) { return Math.ceil(t.credits_per_unit * 15); }
function maxSecs(t) { if (!t) return 0; if (t.max_seconds) return t.max_seconds; if (ME.plan && t.max_seconds_by_plan) return t.max_seconds_by_plan[ME.plan.id] || 0; var m = t.max_seconds_by_plan ? Object.values(t.max_seconds_by_plan) : []; return m.length ? Math.min.apply(null, m) : 15; }
function pCreate(el, r) {
  var want = r.q.get('type');
  if (want && VT_FALLBACK && (want === 'ugc' || want === 'video')) want = want;
  if (want && !TOOLS[want] && !vtById(want)) { var byPipe = VT.find(function (t) { return t.pipeline === want; }); want = byPipe ? byPipe.id : null; }
  if (!B || (want && want !== B.kind)) { var keep = B; B = newDraft(want); if (keep) { B.product = keep.product; B.audience = keep.audience; B.language = keep.language; } }
  if (B.kind && !TOOLS[B.kind] && !vtById(B.kind)) B.kind = defaultKind();
  el.innerHTML = '<div class="bld"><div style="display:grid;gap:14px;min-width:0">' +
    '<div class="card stp cur" id="st1"><span class="n">1</span><div style="display:grid;gap:14px;min-width:0"><div><h3>What do you want to make?</h3><p class="sub">Pick a format. You see the exact price before you generate.</p></div><div class="tgroup"><span class="ml">Video</span><div class="types" id="tyGrid"></div></div><div id="qPick" class="lvp" hidden></div><div class="tgroup"><span class="ml">Copy and images</span><div class="types" id="tlGrid"></div></div><div class="tgroup" id="mtG" hidden><span class="ml">More tools</span><div class="types" id="mtGrid"></div></div></div></div>' +
    '<div class="card stp" id="st2"><span class="n">2</span><div style="display:grid;gap:12px;min-width:0" id="bBase"></div></div>' +
    '<div class="card stp" id="st3"><span class="n">3</span><div style="display:grid;gap:14px;min-width:0" id="bOpts"></div></div>' +
    '</div><div class="summary"><div class="sumcard desk" id="sumD"></div><button class="learnc" id="bLearn" style="min-height:0;padding:16px;grid-template-columns:auto 1fr;align-items:center;display:grid"><span class="pl" style="width:40px;height:40px">' + I('play', 16) + '</span><span><b style="font-size:15px;letter-spacing:-.02em">Watch: your first UGC video</b><span class="ml" style="display:block;color:#8A877E">3 min lesson</span></span></button></div></div>' +
    '<div class="mbar" id="sumM"></div>';
  $('#bLearn').onclick = function () { VooTrainer.open({ match: 'first.?ugc' }); };
  paintTypes(); paintBase(); paintOpts(); quote();
  if (window.VooStudioX) VooStudioX.mountTools($('#mtGrid'), $('#mtG'));
  if (window.VooEdit) VooEdit.loadTracks(api).then(function () { if (route === 'create' && B && B.music_on && B.music_src === 'brand') paintOpts(); });
}
// One short line per format for the picker cards (about eight words). Unknown ids fall back to their pipeline, then the full text.
var SHORT = { ugc_talking: 'A creator talks to camera', ugc_greenscreen: 'A creator reacts to your page', ugc_podcast: 'A host on a studio mic', product_broll: 'Cinematic shots of your product', image_to_video: 'Your product photo, brought to life', slideshow: 'Slides, voiceover and captions', dub_translate: 'Your winning ad, new language', hook_remix: 'New hooks on a proven ad', motion_ad: 'Kinetic text, voice and music', motion_ad_ultra: 'Kinetic text, voice and music', bg_swap: 'Your video on any background', auto_edit: 'Raw footage, edited for the feed', brand_music: 'A jingle or track for your brand' };
var SHORT_PIPE = { ugc: 'ugc_talking', video: 'product_broll', image_to_video: 'image_to_video', slideshow: 'slideshow', dub: 'dub_translate', hook_remix: 'hook_remix', motion_ad: 'motion_ad' };
function shortLine(k, full) {
  if (SHORT[k]) return SHORT[k];
  var t = vtById(k); if (t && !/green|podcast/.test(k) && SHORT[SHORT_PIPE[t.pipeline]]) return SHORT[SHORT_PIPE[t.pipeline]];
  var w = String(full || '').split(/\s+/); return w.length > 9 ? w.slice(0, 8).join(' ').replace(/[,.;:]$/, '') + '…' : full;
}
function paintTypes() {
  var mt = motionTypes(), firstMotion = true, more = null;
  // Card: drawn animated scene, name, one short line, price chip. Full text lives in the title and the strip under the grid.
  var card = function (k, cls, on, lk, name, full, price, badge, tip, lockLbl, scene) {
    if (/green/.test(k)) cls += ' gs'; // the green-screen card gets a chroma-green accent when picked
    return '<button class="ty vt' + cls + (on ? ' on' : '') + (lk ? ' lk' : '') + '" data-k="' + esc(k) + '" aria-pressed="' + on + '" title="' + esc(tip || full) + '"><span class="tsc">' + scene + (lk ? '<span class="ty-lock">' + I('lock', 11, 2.4) + esc(lockLbl) + '</span>' : '') + '</span>' +
      (!lk && badge ? '<span class="pill brand">' + esc(badge) + '</span>' : '') + '<span class="ty-ok">' + I('check', 13, 3) + '</span>' +
      '<b>' + esc(name) + '</b><small>' + esc(shortLine(k, full)) + '</small><span class="pr"><i></i>' + price + '</span></button>';
  };
  var lockLbl = function (t) { return t.min_plan ? t.min_plan.charAt(0).toUpperCase() + t.min_plan.slice(1) + ' plan' : ME.plan ? 'Upgrade' : 'Paid plan'; };
  var POSTER = { ugc_talking: 'ugc-serum', ugc_greenscreen: 'ugc-saas', ugc_podcast: 'sample-podcast', product_broll: 'style-product-headphones', image_to_video: 'ugc-sneakers', slideshow: 'ad-app-v2', dub_translate: 'ugc-serum-es', hook_remix: 'ugc-protein', motion_ad: 'ad-skincare-v2', motion_ad_ultra: 'ad-skincare-v2', bg_swap: 'life-creator-filming', auto_edit: 'life-phone-scroll', brand_music: 'promo-motion-sample' };
  var PIPE_POSTER = { ugc: 'ugc-serum', video: 'style-product-headphones', image_to_video: 'ugc-sneakers', slideshow: 'ad-app-v2', dub: 'ugc-serum-es', hook_remix: 'ugc-protein', motion_ad: 'ad-skincare-v2', bg_swap: 'life-creator-filming', auto_edit: 'life-phone-scroll', brand_music: 'promo-motion-sample' };
  var scene = function (t) { var n = POSTER[t.id] || PIPE_POSTER[t.pipeline]; return n ? '<img class="tposter" src="/samples/' + n + '.webp" alt="" loading="lazy">' : I(PIPE_IC[t.pipeline] || 'film', 28); };
  $('#tyGrid').innerHTML = VT.map(function (t) {
    if (isMotion(t)) {
      if (!firstMotion) return ''; firstMotion = false;
      var mon = mt.some(function (x) { return x.id === B.kind; }), allLk = mt.every(function (x) { return x.locked; });
      var cheap = Math.min.apply(null, mt.map(per15)), mfull = 'Footage, kinetic text, voiceover and music. Standard or ultra-realistic.';
      if (mon) more = ['Animated ad', mfull];
      return card((mt.find(function (x) { return !x.locked; }) || mt[0]).id, ' anim', mon, allLk, 'Animated ad', mfull, 'from ' + fmt(cheap) + ' credits / 15s', 'New', allLk ? mt[0].locked_reason : '', lockLbl(mt[0]), scene(mt[0]));
    }
    var on = B.kind === t.id;
    if (on) more = [t.name, t.description || ''];
    return card(t.id, '', on, t.locked, t.name, t.description || '', (t.pipeline === 'brand_music' ? 'from ' + fmt(t.credits_per_unit) + ' credits / track' : fmt(t.credits_per_unit) + ' credits / ' + (t.unit === 'item' ? 'hook' : 'sec')), t.badge, t.locked ? t.locked_reason : '', lockLbl(t), scene(t));
  }).join('') + (more && more[1] ? '<p class="ty-more">' + T('spark', 18) + '<span><b>' + esc(more[0]) + '.</b> ' + esc(more[1]) + '</span></p>' : '');
  $('#tlGrid').innerHTML = Object.keys(TOOLS).map(function (k) {
    var x = TOOLS[k], lk = x.pro && !(ME.plan && ME.plan.scripts), on = B.kind === k;
    return '<button class="ty tool' + (on ? ' on' : '') + (lk ? ' lk' : '') + '" data-k="' + k + '" aria-pressed="' + on + '"><span class="ic2">' + T(x.ic, 22) + '</span><b>' + x.name + '</b><small>' + x.d + '</small><span class="pr">' + fmt(x.cost()) + ' credits</span>' + (lk ? '<span class="pill ink">' + I('lock', 10, 2.4) + 'Pro</span>' : !ME.plan && k !== 'script' ? '<span class="pill good">Free trial</span>' : '') + '</button>';
  }).join('');
  if (TN && TN.watchScenes) TN.watchScenes($('#tyGrid'));
  paintLevels();
  $$('#tyGrid .ty, #tlGrid .ty').forEach(function (b) { b.onclick = function () {
    var k = b.dataset.k, t = vtById(k);
    if (t && t.locked) { upsell(t.locked_reason, t.name); return; }
    if (TOOLS[k] && TOOLS[k].pro && !(ME.plan && ME.plan.scripts)) { upsell('The AI script writer is on Pro and above.', 'Ad scripts'); return; }
    if (isMotion(t) && isMotion(curVT())) k = B.kind;
    B.kind = k; t = vtById(k); fixLevel(t); if (t) B.duration = Math.min(Math.max(B.duration, t.min_seconds || 5), maxSecs(t) || B.duration); if (t) B.voice_tier = includes(t, 'voice_ultra') ? 'ultra' : (t.voice_tier_default || B.voice_tier || 'standard');
    history.replaceState(null, '', '#create?type=' + k); paintTypes(); paintBase(); paintOpts(); quote(); closeCoach();
  }; });
  stepState();
}
/* Quality levels (SPEC §13): Standard / Pro realistic / Ultra cinematic, each a model with its own credits per second. */
function levelsOf(t) { return t && t.levels && t.levels.length > 1 ? t.levels : []; }
// "Auto (recommended)": Vooads picks the level for the format (the type's auto_level when the plan allows it, else the best
// level the plan allows up to it, else the first one). The customer can still pick a level; prices are always shown.
function autoLevel(t) {
  var ls = levelsOf(t).filter(function (l) { return !l.locked; }); if (!ls.length) return levelsOf(t)[0] || null;
  var want = t.auto_level || ls[0].id, R = { standard: 0, pro: 1, ultra: 2 };
  return ls.find(function (l) { return l.id === want; }) || ls.filter(function (l) { return R[l.id] <= R[want]; }).pop() || ls[0];
}
function curLevel(t) { var ls = levelsOf(t); if (B.level === 'auto') return autoLevel(t); return ls.find(function (l) { return l.id === B.level; }) || ls[0] || null; }
function fixLevel(t) { if (B.level === 'auto') return; var ls = levelsOf(t), l = ls.find(function (x) { return x.id === B.level; }); if (!l || l.locked) B.level = 'auto'; }
var LV_BADGE = {
  standard: '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="#FFEDE6"/><g class="lvb-bob"><rect x="10" y="15" width="18" height="15" rx="4" fill="#0B0B0A"/><path d="M28 20l6-3.5v12L28 25z" fill="#0B0B0A"/><circle class="lvb-rec" cx="15" cy="20" r="2.2" fill="#FF4A1C"/></g></svg>',
  pro: '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="#FFEDE6"/><g class="lvb-spin"><circle cx="22" cy="22" r="10.5" fill="#0B0B0A"/><path d="M22 11.5l4 8.2M32.3 20.2l-8.6 4.3M27.6 31.4l-6.9-6.6M14.4 29.3l6.2-7.6M14.1 15.6l8.8 3.1" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/><circle cx="22" cy="22" r="3.6" fill="#FF4A1C"/></g><path class="lvb-tw" d="M34 6l1.2 2.8L38 10l-2.8 1.2L34 14l-1.2-2.8L30 10l2.8-1.2z" fill="#FF4A1C"/></svg>',
  ultra: '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="#0B0B0A"/><g class="lvb-bob"><path d="M13 18l4.5-6h9l4.5 6-9 14z" fill="#FF4A1C"/><path d="M13 18h18M17.5 12l4.5 6 4.5-6M22 18v14" stroke="#0B0B0A" stroke-opacity=".35" stroke-width="1.2" fill="none"/><path d="M17.5 12l-4.5 6h9z" fill="#FFB59E"/></g><path class="lvb-tw" d="M33 7l1 2.4 2.4 1-2.4 1L33 13.8l-1-2.4-2.4-1 2.4-1z" fill="#fff"/><path class="lvb-tw d2" d="M10 29l.8 1.8 1.8.8-1.8.8L10 34.2l-.8-1.8-1.8-.8 1.8-.8z" fill="#FFB59E"/></svg>',
};
function lvUnit(t) { return t.unit === 'item' ? 'hook' : 's'; }
function lvTotal() {
  var t = curVT(), l = curLevel(t); if (!l) return '';
  var cr = lastQ && lastQ.credits != null && !lastQ.error ? fmt(lastQ.credits) + ' credits' : '\u2026';
  return (t.unit === 'item' ? B.hooks_n + ' hook' + (B.hooks_n > 1 ? 's' : '') : B.duration + ' sec') + ' \u00b7 ' + cr;
}
function paintLevels() {
  var box = $('#qPick'); if (!box) return;
  var t = curVT(), ls = levelsOf(t);
  if (!ls.length) { box.hidden = true; box.innerHTML = ''; return; }
  fixLevel(t);
  box.hidden = false;
  var al = autoLevel(t), isAuto = B.level === 'auto';
  box.innerHTML = '<div class="lvp-h"><span class="ml">' + (isMotion(t) ? 'scene quality' : 'quality') + '</span><span class="lvp-tot" id="lvTot" aria-live="polite">' + esc(lvTotal()) + '</span></div>' +
    '<div class="lvp-g" role="radiogroup" aria-label="Quality">' +
    '<button type="button" class="lv lv-auto' + (isAuto ? ' on' : '') + '" data-lv="auto" role="radio" aria-checked="' + isAuto + '"><span class="lv-b">' + I('spark', 14) + '</span><span class="lv-x"><b>Auto <em class="rec">recommended</em></b><small>Vooads picks the right quality for this format' + (al ? ': ' + esc(al.name) : '') + '</small></span><span class="lv-f"><span class="lv-cr">' + (al ? fmt(al.credits_per_unit) + ' cr/' + lvUnit(t) : '') + '</span><span class="lv-ok">' + I('check', 12, 3) + '</span></span></button>' +
    ls.map(function (l) {
      var on = !isAuto && l.id === B.level;
      return '<button type="button" class="lv lv-' + esc(l.id) + (on ? ' on' : '') + (l.locked ? ' lk' : '') + '" data-lv="' + esc(l.id) + '" role="radio" aria-checked="' + on + '"' + (l.locked ? ' title="' + esc(l.locked_reason || '') + '"' : '') + '>' +
        '<span class="lv-b">' + (LV_BADGE[l.id] || LV_BADGE.standard) + '</span>' +
        '<span class="lv-x"><b>' + esc(l.name) + '</b><small>' + esc(l.benefit || '') + '</small></span>' +
        '<span class="lv-f"><span class="lv-cr">' + fmt(l.credits_per_unit) + ' cr/' + lvUnit(t) + '</span>' + (l.locked ? '<span class="lv-lock">' + I('lock', 11, 2.4) + esc(l.min_plan_name || 'Upgrade') + '</span>' : '<span class="lv-ok">' + I('check', 12, 3) + '</span>') + '</span></button>';
    }).join('') + '</div>';
  $$('.lv', box).forEach(function (b) { b.onclick = function () {
    if (b.dataset.lv === 'auto') { if (B.level !== 'auto') { B.level = 'auto'; paintLevels(); quote(); } return; }
    var l = levelsOf(curVT()).find(function (x) { return x.id === b.dataset.lv; }); if (!l) return;
    if (l.locked) { upsell(l.locked_reason || (l.name + ' needs a bigger plan.'), l.name + ' quality'); return; }
    if (B.level === l.id) return;
    B.level = l.id; paintLevels(); quote();
  }; });
}
function paintLevelTotal() { var e = $('#lvTot'); if (e) e.textContent = lvTotal(); }
function upsell(reason, what) {
  modal('<div class="mbd" style="text-align:center;justify-items:center;padding:32px 24px"><span class="ml">' + esc(what || 'upgrade') + '</span><h3 class="hx2" style="max-width:14ch">Unlock it. <span class="g">Make it today.</span></h3><p class="muted" style="max-width:44ch">' + esc(reason || '') + ' Plans start at $' + CFG.plans[0].price_month + ' a month with ' + fmt(CFG.plans[0].credits_month) + ' credits and full commercial use.</p><a class="btn arrow lg" href="#wallet" data-close>See plans ' + ARR() + '</a><button class="btn ghost" data-close>Not now</button></div>', 'Upgrade');
}
// Hooks for the editing tools (public/assets/js/voo-edit-tools.js).
function editCtx() { return { repaint: function () { paintOpts(); }, repaintBase: function () { paintBase(); stepState(); paintSummary(); }, quote: quote, toast: toast, upsell: upsell, summary: paintSummary, stepState: stepState, uploadBlock: uploadBlock, maxSecs: maxSecs }; }
function isEdit(t) { return !!(window.VooEdit && VooEdit.is(t)); }
function stepState() {
  var tt = curVT();
  var s2 = isEdit(tt) ? VooEdit.step2(tt, B) : B.product.trim().length > 2;
  $('#st1').className = 'card stp ok'; $('#st2').className = 'card stp ' + (s2 ? 'ok' : 'cur'); $('#st3').className = 'card stp' + (s2 ? ' cur' : '');
}
function langSelect(id, val) { return '<select class="inp" id="' + id + '">' + Object.keys(CFG.languages).map(function (k) { return '<option value="' + k + '"' + (k === val ? ' selected' : '') + '>' + esc(CFG.languages[k]) + '</option>'; }).join('') + '</select>'; }
function paintBase() {
  var t = curVT(), pipe = t ? t.pipeline : B.kind;
  if (isEdit(t)) { VooEdit.draft(t, B, ME); $('#bBase').innerHTML = VooEdit.base(t, B); VooUI.media($('#bBase')); VooEdit.wireBase($('#bBase'), t, B, editCtx()); return; }
  var label = pipe === 'dub' ? 'What is the ad about?' : 'What are you advertising?';
  var h = '<div><h3>' + label + '</h3><p class="sub">One clear line works best. Example: “Vitamin C serum for women 25–40 with dull skin”.</p></div>' +
    '<div class="fld"><label for="bProd" class="sr">Product</label><textarea class="inp" id="bProd" rows="2" maxlength="800" placeholder="Your product or offer, and what makes it different"></textarea></div>' +
    '<div class="g2" style="gap:12px"><div class="fld"><label for="bAud">Who is it for? <small>optional</small></label><input class="inp" id="bAud" maxlength="200" placeholder="Busy mums, gym beginners, small shop owners…"></div><div class="fld"><label for="bLang">' + (pipe === 'dub' ? 'Dub into' : 'Language and geo') + '</label>' + langSelect('bLang', B.language) + '</div></div>';
  $('#bBase').innerHTML = h;
  $('#bProd').value = B.product; $('#bAud').value = B.audience;
  $('#bProd').oninput = function () { B.product = this.value; stepState(); paintSummary(); };
  $('#bAud').oninput = function () { B.audience = this.value; };
  $('#bLang').onchange = function () { B.language = this.value; paintSummary(); };
}
function presenterGrid() {
  var own = '<button type="button" class="ac add' + (B.presenter === 'custom' ? ' on' : '') + '" data-p="custom"><span class="ph">' + I('plus', 22) + '</span><span class="tx"><b>Describe your own</b><em>A new AI face</em></span></button>';
  return '<div class="fld"><span class="lbl">Creator <small>recommended for you</small></span>' + (window.VooActors ? VooActors.row(B.presenter, own) : '<div class="arow" id="prGrid">' + own + '</div>') + '</div>' +
    (B.presenter === 'custom' ? '<div class="fld"><label for="bPd">Describe the creator <small>a new AI face, +' + ((CFG.costs && CFG.costs.presenter_face) || 3) + ' credits</small></label><input class="inp" id="bPd" maxlength="300" placeholder="Woman in her 30s, short hair, cozy kitchen, friendly" value="' + esc(B.presenter_desc) + '"></div>' : '');
}
function durBlock(t) {
  var mx = maxSecs(t) || 15, mn = t.min_seconds || 5, st = t.seconds_step || 1;
  B.duration = Math.max(mn, Math.min(mx, Math.ceil(B.duration / st) * st));
  var segs = t.segment_seconds && ['ugc', 'video', 'image_to_video'].indexOf(t.pipeline) >= 0 && B.duration > t.segment_seconds ? Math.ceil(B.duration / t.segment_seconds) : 1;
  var top = t.max_seconds_by_plan ? Math.max.apply(null, Object.values(t.max_seconds_by_plan).concat([0])) : mx;
  return '<div class="dur"><div class="top"><span class="lbl" style="font-weight:700;font-size:13.5px">Length</span><span class="v" id="durV">' + B.duration + 's</span></div>' +
    '<input type="range" id="bDur" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + B.duration + '" aria-label="Video length in seconds">' +
    '<div class="segv" id="segV">' + Array.from({ length: segs }, function () { return '<i></i>'; }).join('') + '</div>' +
    '<div class="segnote" id="segN">' + segNote(t, segs) + '</div>' +
    (mx < top ? '<button class="cbtn" id="moreLen" style="justify-self:start">' + I('lock', 13) + 'Up to ' + top + 's on a bigger plan</button>' : '') + '</div>';
}
function segNote(t, segs) { if (t.pipeline === 'motion_ad') { var n = Math.max(4, Math.min(8, Math.round(B.duration / (t.segment_seconds || 6)))); return I('stitch', 15) + B.duration + 's ad \u2248 ' + n + ' scenes with headlines, cut together with transitions and an end card'; } return I('stitch', 15) + (segs > 1 ? B.duration + 's video = ' + segs + ' parts of ' + t.segment_seconds + 's, stitched automatically' : 'One render' + (t.segment_seconds && ['ugc', 'video', 'image_to_video'].indexOf(t.pipeline) >= 0 ? ' · over ' + t.segment_seconds + 's renders in parts and stitches' : '')); }
function paintOpts() {
  var o = $('#bOpts'), t = curVT(), p = ME.plan, h = '';
  if (t) {
    var pipe = t.pipeline;
    if (isEdit(t)) { VooEdit.draft(t, B, ME); h = VooEdit.opts(t, B, editCtx()); }
    else if (window.VooP2 && VooP2.isNew(t)) h = VooP2.opts(t, B) + durBlock(t);
    else if (pipe === 'motion_ad') {
      h = '<div><h3>Animated ad</h3><p class="sub">AI plans the scenes, adds footage, kinetic headlines, a voiceover and your end card with logo and call to action.</p></div>' + qualityCards() +
        '<div class="fld"><span class="lbl">Style</span><div class="stys" id="stys">' + [['bold', 'Bold'], ['clean', 'Clean'], ['luxury', 'Luxury'], ['playful', 'Playful'], ['tech', 'Tech']].map(function (x) { return '<button class="sty' + (B.mstyle === x[0] ? ' on' : '') + '" data-ms="' + x[0] + '"><span class="pv ' + x[0] + '" aria-hidden="true"><i></i><i></i><i></i></span><b>' + x[1] + '</b></button>'; }).join('') + '</div></div>' +
        '<div class="fld"><span class="lbl">Shape</span><div class="chips">' + [['9:16', '9:16 Reels/TikTok'], ['1:1', '1:1 Feed'], ['16:9', '16:9 YouTube']].map(function (a) { return '<button class="chip' + (B.aspect === a[0] ? ' on' : '') + '" data-a="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="g2" style="gap:12px"><div class="fld"><label for="bCol">Brand colour</label><div class="colrow"><input type="color" id="bCol" value="' + esc(B.brand_color) + '" aria-label="Brand colour"><input class="inp" id="bColT" maxlength="7" value="' + esc(B.brand_color) + '" style="font-family:var(--mono)"></div></div><div class="fld"><label for="bCta">Call to action <small>end card, up to 30 characters</small></label><input class="inp" id="bCta" maxlength="30" placeholder="Shop now · 20% off today" value="' + esc(B.cta) + '"></div></div>' +
        '<div class="g2" style="gap:12px">' + uploadBlock(false, 'upLogo', B.logo_prev, 'Add your logo', 'Logo added', 'Optional. Shown on the end card.') + uploadBlock(false) + '</div>' + durBlock(t) +
        '<div class="fld"><span class="lbl">Script</span><label class="sw"><input type="checkbox" id="bWs"' + (B.write_script ? ' checked' : '') + '><span class="k"></span><span><b>Write it for me</b> <span class="pill ink" style="margin-left:4px">Pro</span><small class="muted" style="display:block;font-size:12.5px">AI writes 4 to 8 scenes: headline, voiceover line and visuals, sized to your length.</small></span></label></div>' +
        (B.write_script ? '' : '<div class="fld"><label for="bScr">Your voiceover script</label><textarea class="inp" id="bScr" rows="4" maxlength="4000" placeholder="Tired of dull skin? Meet the serum that fits your morning. Brighter in two weeks, or your money back.">' + esc(B.script) + '</textarea><div class="shieldline" id="bSh">' + I('shield', 16) + 'Ban Shield checks your script as you type.</div></div>');
    } else if (pipe === 'ugc') {
      h = '<div><h3>Creator, length and script</h3><p class="sub">The creator holds the phone and talks about your product.</p></div>' + presenterGrid() + durBlock(t) +
        '<div class="fld"><span class="lbl">Script</span><label class="sw"><input type="checkbox" id="bWs"' + (B.write_script ? ' checked' : '') + '><span class="k"></span><span><b>Write it for me</b> <span class="pill ink" style="margin-left:4px">Pro</span><small class="muted" style="display:block;font-size:12.5px">Hook, problem, proof and call to action, sized to your length. +' + ((t.extras && t.extras.ai_script) || CFG.costs.script) + ' credits.</small></span></label></div>' +
        (B.write_script ? '' : '<div class="fld"><label for="bScr">Your script <small>(what the creator says)</small></label><textarea class="inp" id="bScr" rows="5" maxlength="4000" placeholder="I almost returned this serum… then week two happened. My skin looks brighter in daylight, no filter. Link below if you want to try it.">' + esc(B.script) + '</textarea><div class="shieldline" id="bSh">' + I('shield', 16) + 'Ban Shield checks your script as you type.</div></div>');
    } else if (pipe === 'video' || pipe === 'image_to_video') {
      h = '<div><h3>' + (pipe === 'image_to_video' ? 'Your photo, style and length' : 'Style, shape and length') + '</h3><p class="sub">' + (pipe === 'image_to_video' ? 'Upload a product photo. Vooads turns it into a moving shot.' : 'Great for b-roll, product shots and mixing into your edits.') + '</p></div>' +
        uploadBlock(pipe === 'image_to_video') +
        '<div class="chips">' + CFG.video_styles.map(function (s) { return '<button class="chip' + (B.style === s ? ' on' : '') + '" data-s="' + s + '">' + (STYLE_NAMES[s] || s) + '</button>'; }).join('') + '</div>' +
        '<div class="fld"><span class="lbl">Shape</span><div class="chips">' + [['9:16', '9:16 Reels/TikTok'], ['1:1', '1:1 Feed'], ['16:9', '16:9 YouTube']].map(function (a) { return '<button class="chip' + (B.aspect === a[0] ? ' on' : '') + '" data-a="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div></div>' + durBlock(t);
    } else if (pipe === 'slideshow') {
      h = '<div><h3>Slides and length</h3><p class="sub">AI writes the slides, makes an image for each, adds a voiceover and captions.</p></div>' +
        '<div class="fld"><span class="lbl">Slides</span><div class="chips">' + [4, 5, 6, 7, 8].map(function (n) { return '<button class="chip' + (B.slides === n ? ' on' : '') + '" data-sl="' + n + '">' + n + '</button>'; }).join('') + '</div></div>' + durBlock(t) +
        '<div class="fld"><label for="bLines">Your slide lines <small>optional, one per line (4 to 8)</small></label><textarea class="inp" id="bLines" rows="4" placeholder="Dull skin every morning?\nI tried 6 serums…\nThis one stuck\nTry it for 30 days">' + esc(B.lines) + '</textarea></div>';
    } else if (pipe === 'dub') {
      h = '<div><h3>The ad to dub</h3><p class="sub">Paste the link to your video and the script spoken in it. Vooads translates and re-voices it.</p></div>' +
        '<div class="fld"><label for="bVu">Video link</label><input class="inp" id="bVu" type="url" placeholder="https://…/my-ad.mp4" value="' + esc(B.video_url) + '"></div>' +
        '<div class="fld"><label for="bSl">Spoken in</label>' + langSelect('bSl', B.source_language) + '</div>' +
        '<div class="fld"><label for="bScr">Script spoken in the video</label><textarea class="inp" id="bScr" rows="4" maxlength="4000">' + esc(B.script) + '</textarea><div class="shieldline" id="bSh">' + I('shield', 16) + 'Ban Shield checks the script.</div></div>' + durBlock(t);
    } else if (pipe === 'hook_remix') {
      h = '<div><h3>Hook factory</h3><p class="sub">Up to 10 new 3–5 second openings for an ad that already works, each spliced onto your video. 5 or more cost less per hook.</p></div>' + presenterGrid() +
        '<div class="fld"><span class="lbl">How many hooks</span><div class="chips hookn">' + (window.VooP2 ? VooP2.hookCounts(t, B.hooks_n) : [1, 2, 3, 4, 5].map(function (n) { return '<button class="chip' + (B.hooks_n === n ? ' on' : '') + '" data-hn="' + n + '">' + n + '</button>'; }).join('')) + '</div></div>' +
        '<div class="fld"><label for="bVu">Link to your ad <small>optional · we splice each hook in front</small></label><input class="inp" id="bVu" type="url" placeholder="https://…/winner.mp4" value="' + esc(B.video_url) + '"></div>' +
        '<div class="fld"><label for="bHk">Your hooks <small>optional, one per line</small></label><textarea class="inp" id="bHk" rows="3">' + esc(B.hooks_text) + '</textarea></div>';
    }
  } else if (B.kind === 'image') {
    h = '<div><h3>How many sets?</h3><p class="sub">Each set is 3 images: 1:1, 4:5 and 9:16.</p></div><div class="chips">' + [1, 2, 3, 4].map(function (n) { return '<button class="chip' + (B.count === n ? ' on' : '') + '" data-c="' + n + '">' + n + ' set' + (n > 1 ? 's' : '') + '</button>'; }).join('') + '</div>' +
      '<div class="fld"><label for="bAng">Look and feel <small>optional</small></label><input class="inp" id="bAng" maxlength="300" placeholder="Bright bathroom shelf, morning light, premium" value="' + esc(B.angle) + '"></div>';
  } else if (B.kind === 'hooks') {
    h = '<div><h3>Any angle in mind?</h3><p class="sub">Leave it empty and we’ll mix question, POV, story and curiosity hooks.</p></div><div class="chips">' + ['', 'Problem/solution', 'Social proof', 'Curiosity', 'Price/value', 'Before I found this', 'Myth busting'].map(function (a) { return '<button class="chip' + (B.angle === a ? ' on' : '') + '" data-g="' + esc(a) + '">' + (a || 'Surprise me') + '</button>'; }).join('') + '</div>';
  } else if (B.kind === 'angles') {
    h = '<div><h3>Find your next angle</h3><p class="sub">10 angles for your product and niche, each with an opening hook and why it works. Turn any of them into a video in one tap.</p></div><div class="fld"><label for="bNi">Niche <small>helps the AI pick angles that work in your vertical</small></label><select class="inp" id="bNi"><option value="">Detect it for me</option>' + NICHES.map(function (n) { return '<option value="' + n[0] + '"' + (B.niche === n[0] ? ' selected' : '') + '>' + n[1] + '</option>'; }).join('') + '</select></div>';
  } else if (B.kind === 'script') {
    h = '<div><h3>Script settings</h3><p class="sub">A UGC script you can record yourself or turn into a video.</p></div><div class="fld"><span class="lbl">Length</span><div class="chips">' + [15, 30, 45, 60].map(function (s) { return '<button class="chip' + (B.duration === s ? ' on' : '') + '" data-d="' + s + '">' + s + 's</button>'; }).join('') + '</div></div><div class="fld"><label for="bAng">Angle <small>optional</small></label><input class="inp" id="bAng" maxlength="200" placeholder="Problem/solution, testimonial, unboxing…" value="' + esc(B.angle) + '"></div>';
  }
  if (t) h += audioBlock(t) + finishBlock(t);
  o.innerHTML = h;
  VooUI.media(o);
  var w = function (sel, ev, fn) { $$(sel, o).forEach(function (x) { x[ev] = fn; }); };
  var pickActor = function (id, own) { if (own) { B.actor_id = id; } else { B.presenter = id; delete B.actor_id; } B.presenter_desc = B.presenter === 'custom' ? B.presenter_desc : ''; paintOpts(); };
  if (window.VooActors && $('#prGrid', o)) { VooActors.wire(o, pickActor); if (!VooActors._reco.last) VooActors.load(o, (t && t.pipeline) || "", B.presenter, $('#prGrid [data-p="custom"]', o) ? $('#prGrid [data-p="custom"]', o).outerHTML : '', pickActor); }
  w('#prGrid [data-p="custom"]', 'onclick', function () { B.presenter = 'custom'; delete B.actor_id; paintOpts(); });
  w('[data-s]', 'onclick', function () { B.style = this.dataset.s; paintOpts(); });
  w('[data-a]', 'onclick', function () { B.aspect = this.dataset.a; paintOpts(); });
  w('[data-c]', 'onclick', function () { B.count = Number(this.dataset.c); paintOpts(); quote(); });
  w('[data-sl]', 'onclick', function () { B.slides = Number(this.dataset.sl); paintOpts(); quote(); });
  w('[data-hn]', 'onclick', function () { B.hooks_n = Number(this.dataset.hn); paintOpts(); quote(); });
  w('[data-g]', 'onclick', function () { B.angle = this.dataset.g; paintOpts(); });
  w('[data-d]', 'onclick', function () { B.duration = Number(this.dataset.d); paintOpts(); quote(); });
  if ($('#bDur')) $('#bDur').oninput = function () {
    B.duration = Number(this.value); var t2 = curVT();
    var segs = t2.segment_seconds && ['ugc', 'video', 'image_to_video'].indexOf(t2.pipeline) >= 0 && B.duration > t2.segment_seconds ? Math.ceil(B.duration / t2.segment_seconds) : 1;
    $('#durV').textContent = B.duration + 's';
    if ($$('#segV i').length !== segs) $('#segV').innerHTML = Array.from({ length: segs }, function () { return '<i></i>'; }).join('');
    $('#segN').innerHTML = segNote(t2, segs); quote();
  };
  if ($('#moreLen')) $('#moreLen').onclick = function () { var t3 = curVT(); upsell((t3.max_seconds_by_plan ? CFG.plans.filter(function (pl) { return t3.max_seconds_by_plan[pl.id]; }).map(function (pl) { return pl.name + ' makes up to ' + t3.max_seconds_by_plan[pl.id] + 's'; }).join(', ') + '.' : ''), 'longer videos'); };
  if ($('#bPd')) { $('#bPd').oninput = function () { B.presenter_desc = this.value; paintSummary(); }; $('#bPd').onchange = function () { quote(); }; }
  if ($('#bAng')) $('#bAng').oninput = function () { B.angle = this.value; };
  if ($('#bNi')) $('#bNi').onchange = function () { B.niche = this.value; };
  if ($('#bLines')) $('#bLines').oninput = function () { B.lines = this.value; };
  if ($('#bHk')) $('#bHk').oninput = function () { B.hooks_text = this.value; };
  if ($('#bVu')) $('#bVu').oninput = function () { B.video_url = this.value.trim(); paintSummary(); };
  if ($('#bSl')) $('#bSl').onchange = function () { B.source_language = this.value; };
  if ($('#bWs')) $('#bWs').onchange = function () { if (this.checked && !(p && p.scripts)) { this.checked = false; upsell('The AI script writer is on Pro and above.', 'AI script writer'); return; } B.write_script = this.checked; paintOpts(); quote(); };
  if ($('#bScr')) { $('#bScr').oninput = function () { B.script = this.value; liveShield(); paintSummary(); }; if (B.script) liveShield(); }
  if ($('#upf')) $('#upf').onchange = upload;
  if ($('#upLogo')) $('#upLogo').onchange = upload;
  w('[data-q]', 'onclick', function () { var nt = vtById(this.dataset.q); if (nt.locked) { upsell(nt.locked_reason, nt.name); return; } B.kind = nt.id; fixLevel(nt); B.voice_tier = includes(nt, 'voice_ultra') ? 'ultra' : (nt.voice_tier_default || 'standard'); B.duration = Math.min(Math.max(B.duration, nt.min_seconds || 5), maxSecs(nt) || B.duration); history.replaceState(null, '', '#create?type=' + nt.id); paintTypes(); paintOpts(); quote(); });
  w('[data-ms]', 'onclick', function () { B.mstyle = this.dataset.ms; $$('#stys .sty').forEach(function (x) { x.classList.toggle('on', x.dataset.ms === B.mstyle); }); });
  if ($('#bCol')) { $('#bCol').oninput = function () { B.brand_color = this.value; $('#bColT').value = this.value; }; $('#bColT').oninput = function () { if (/^#[0-9a-f]{6}$/i.test(this.value)) { B.brand_color = this.value; $('#bCol').value = this.value; } }; }
  if ($('#bCta')) $('#bCta').oninput = function () { B.cta = this.value; };
  if ($('#bMus')) $('#bMus').onchange = function () { B.music_on = this.checked; paintOpts(); quote(); };
  w('[data-mc]', 'onclick', function () { var c = this.dataset.mc; B.music_on = c !== 'none'; if (c !== 'none') B.music_src = c; paintOpts(); quote(); });
  w('[data-ae]', 'onchange', function () { B.auto_edit = this.checked; });
  w('[data-bf]', 'onchange', function () { if (this.checked && !(ME.brand && ME.brand.logo_url)) { this.checked = false; toast('Add your logo in Brand kit first'); go('#brand'); return; } B.brand_finish = this.checked; });
  w('[data-mood]', 'onclick', function () { B.mood = this.dataset.mood; paintOpts(); });
  w('[data-msrc]', 'onclick', function () { B.music_src = this.dataset.msrc; paintOpts(); quote(); });
  w('[data-vt]', 'onclick', function () { B.voice_tier = this.dataset.vt; paintOpts(); quote(); });
  if (isEdit(t)) VooEdit.wireOpts(o, t, B, editCtx());
  if (window.VooP2 && VooP2.isNew(t)) VooP2.wireOpts(o, t, B, editCtx());
  if (window.VooEdit) VooEdit.wireTracks(o, B, editCtx());
  paintSummary();
}
function qualityCards() {
  return '<div class="qual">' + motionTypes().map(function (q) {
    var ultra = q.quality === 'ultra', on = B.kind === q.id;
    return '<button class="qc' + (on ? ' on' : '') + (ultra ? ' ultra' : '') + (q.locked ? ' lk' : '') + '" data-q="' + esc(q.id) + '"><span class="qv" aria-hidden="true"><i></i><i></i><i></i></span><span class="ml">' + (ultra ? 'ultra-realistic' : 'standard') + '</span><b>' + esc(ultra ? 'Ultra-realistic' : 'Standard') + '</b><small>' + esc(q.description || (ultra ? 'AI-generated video scenes and an ultra-realistic voice.' : 'Stock footage, AI images, kinetic text and a standard voice.')) + '</small><span class="qp"><strong>' + fmt(per15(q)) + '</strong> credits / 15s</span><span class="ml">' + fmt(q.credits_per_unit) + ' cr per second' + (includes(q, 'voice_ultra') ? ' · ultra voice included' : '') + '</span>' + (q.locked ? '<span class="pill plain">' + I('lock', 11, 2.2) + (ME.plan ? 'Upgrade' : 'Plan') + '</span>' : on ? '<span class="pill ink">' + I('check', 11, 2.4) + 'Selected</span>' : '') + '</button>';
  }).join('') + '</div>';
}
var MOODS = { upbeat: 'Upbeat', chill: 'Chill', cinematic: 'Cinematic', corporate: 'Corporate', hiphop: 'Hip-hop', emotional: 'Emotional' };
function audioBlock(t) {
  var hm = hasAddon(t, 'music'), hv = hasAddon(t, 'voice_ultra'), inc = includes(t, 'voice_ultra');
  if (!hm && !hv && !inc) return '';
  var h = '<div class="audio"><span class="ml">sound</span>';
  if (hm) {
    var mu = ADDONS.music, minS = mu.min_seconds || 0, tooShort = t.pipeline !== 'hook_remix' && B.duration < minS;
    var lib = Number(mu.library_credits_per_second || 0), ai = Number(mu.credits_per_second || 0);
    var mc = !B.music_on ? 'none' : B.music_src;
    h += '<div class="fld"><span class="lbl">Music <small>ducked under the voice, loudness-matched for feeds</small></span><div class="seg mus">' +
      '<button data-mc="none"' + (mc === 'none' ? ' class="on"' : '') + '>None <em>free</em></button>' +
      '<button data-mc="library"' + (mc === 'library' ? ' class="on"' : '') + '>Library track <em>' + (lib ? '+' + lib + ' cr/s' : 'free') + '</em></button>' +
      (window.VooEdit ? '<button data-mc="brand"' + (mc === 'brand' ? ' class="on"' : '') + '>Brand music <em>free</em></button>' : '') +
      '<button data-mc="ai"' + (mc === 'ai' ? ' class="on"' : '') + '>New AI track <em>+' + ai + ' cr/s</em></button></div></div>';
    if (B.music_on) {
      h += (B.music_src !== 'brand' ? '<div class="moods">' + (mu.moods || Object.keys(MOODS)).map(function (m) { return '<button class="mood' + (B.mood === m ? ' on' : '') + '" data-mood="' + esc(m) + '"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' + esc(MOODS[m] || m) + '</button>'; }).join('') + '</div>' : '') +
        (B.music_src === 'brand' && window.VooEdit ? VooEdit.trackPicker(B) : '') +
        (tooShort ? '<p class="ml" style="color:var(--warn)">music needs a video of at least ' + minS + 's</p>' : '');
    }
  }
  if (inc) h += '<div class="shieldline">' + I('mic', 16) + '<b>' + esc((ADDONS && ADDONS.voice_tiers && ADDONS.voice_tiers.ultra && ADDONS.voice_tiers.ultra.label) || 'Ultra-realistic voice') + '</b> included in this quality</div>';
  else if (hv) {
    var vu = ADDONS.voice_ultra, tiers = ADDONS.voice_tiers || {};
    h += '<div class="fld"><span class="lbl">Voice</span><div class="seg"><button data-vt="standard"' + (B.voice_tier !== 'ultra' ? ' class="on"' : '') + '>' + esc((tiers.standard && tiers.standard.label) || 'Standard voice') + ' <em>included</em></button><button data-vt="ultra"' + (B.voice_tier === 'ultra' ? ' class="on"' : '') + '>' + esc((tiers.ultra && tiers.ultra.label) || vu.name || 'Ultra-realistic voice') + ' <em>+' + Number(vu.credits_per_second || 0) + ' cr/s</em></button></div></div>';
  }
  return h + '</div>';
}
// Auto-edit and Logo / Brand kit for generated videos (server: jobs.js finishStep, free local ffmpeg).
var AUTO_EDIT_PIPES = ['ugc', 'street', 'dub'], BRAND_PIPES = ['ugc', 'video', 'image_to_video', 'slideshow', 'street', 'mad_edit', 'dub'];
function finishBlock(t) {
  if (!t) return '';
  var ae = AUTO_EDIT_PIPES.indexOf(t.pipeline) >= 0, bf = BRAND_PIPES.indexOf(t.pipeline) >= 0;
  if (!ae && !bf) return '';
  var br = ME.brand || {}, hasLogo = !!br.logo_url;
  return '<div class="audio"><span class="ml">finish</span>' +
    (ae ? '<label class="sw"><input type="checkbox" data-ae' + (B.auto_edit !== false ? ' checked' : '') + '><span class="k"></span><span><b>Auto-edit <span class="pill ink" style="margin-left:4px">free</span></b><small class="muted" style="display:block;font-size:12.5px">Burnt-in captions timed to the script and music balanced under the voice. AI videos have no pauses to cut. Change anything later with chat edits.</small></span></label>' : '') +
    (bf ? '<label class="sw"><input type="checkbox" data-bf' + (B.brand_finish && hasLogo ? ' checked' : '') + '><span class="k"></span><span><b>Logo &amp; end card <span class="pill ink" style="margin-left:4px">free</span></b><small class="muted" style="display:block;font-size:12.5px">' + (hasLogo ? 'Your logo in the corner and a 2.5s end card in your brand colour' + (br.cta ? ' saying "' + esc(br.cta) + '"' : '') + '. <a href="#brand">Edit Brand kit</a>' : 'Add your logo and brand colour once in <a href="#brand">Brand kit</a>, then switch this on.') + '</small></span></label>' : '') +
    '</div>';
}
function uploadBlock(req, id, prev, t1, t2, note) { id = id || 'upf'; prev = id === 'upf' ? B.image_prev : prev; return '<label class="upl"><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="' + id + '">' + (prev ? '<img src="' + esc(prev) + '" alt="">' : '<span class="ph">' + I('upload', 22) + '</span>') + '<div><b style="font-size:14.5px">' + (prev ? (t2 || 'Product photo added') : (t1 || 'Add a product photo')) + '</b><small class="muted" style="display:block;font-size:12.5px">' + (note || (req ? 'Required. PNG, JPG or WebP under 8 MB.' : 'Optional. Makes the video look like your real product.')) + '</small></div></label>'; }
var shT;
function liveShield() {
  clearTimeout(shT);
  shT = setTimeout(async function () {
    var el = $('#bSh'); if (!el || !B.script.trim()) return;
    try {
      var d = await api('POST', '/api/shield', { text: B.script, niche: B.niche });
      var c = d.level === 'low' ? ['var(--good-bg)', 'var(--good)', 'Safe'] : d.level === 'review' ? ['var(--warn-bg)', 'var(--warn)', 'Needs a tweak'] : ['var(--bad-bg)', 'var(--bad)', 'High risk'];
      el.innerHTML = '<span class="sc" style="background:' + c[0] + ';color:' + c[1] + '">' + d.score + '/100 · ' + c[2] + '</span>' + (d.flags.length ? '<span style="flex:1;min-width:0">' + esc(d.flags[0].phrase) + ' → ' + esc(d.flags[0].fix) + '</span><button class="cbtn" id="fixIt">' + I('check', 13) + 'Fix all</button>' : '<span>Looks good.</span>');
      if ($('#fixIt')) $('#fixIt').onclick = function () { B.script = d.rewrite; $('#bScr').value = d.rewrite; liveShield(); toast('Risky lines rewritten'); };
    } catch (e) {}
  }, 500);
}
async function upload() {
  var f = this.files[0]; if (!f) return;
  if (f.size > 8e6) { toast('Use a photo under 8 MB', true); return; }
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f, credentials: 'same-origin' });
    var d = await r.json(); if (!r.ok) throw new Error(d.error);
    if (this.id === 'upLogo') { B.logo_url = d.url; B.logo_prev = d.url; toast('Logo added'); } else { B.image_url = d.url; B.image_prev = d.url; toast('Photo added'); } paintOpts();
  } catch (e) { toast(e.message || 'Upload failed', true); }
}
var qT, lastQ = null;
function quote() {
  clearTimeout(qT); lastQ = null; paintSummary();
  qT = setTimeout(async function () {
    var req = jobReq();
    try { var d = await api('POST', '/api/quote', { type: req.type, input: req }); lastQ = d; if (d.balance) ME.balance = d.balance; paintSummary(); } catch (e) { lastQ = { credits: null, error: e.message }; paintSummary(); }
  }, 180);
}
function lines(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
function jobReq() {
  var t = curVT();
  var i = { product: B.product.trim(), audience: B.audience.trim() || undefined, language: B.language, niche: B.niche || undefined };
  if (B.details) i.details = String(B.details).slice(0, 600);
  if (t) {
    i.type = VT_FALLBACK ? t.pipeline : 'video_type'; if (!VT_FALLBACK) i.video_type = t.id;
    var pipe = t.pipeline;
    if (levelsOf(t).length) i.level = (curLevel(t) || {}).id || 'standard';
    if (AUTO_EDIT_PIPES.indexOf(t.pipeline) >= 0) i.auto_edit = B.auto_edit !== false;
    if (BRAND_PIPES.indexOf(t.pipeline) >= 0 && B.brand_finish && ME.brand && ME.brand.logo_url) i.brand_finish = true;
    if (pipe !== 'hook_remix') i.duration = B.duration;
    if (pipe === 'motion_ad') { i.aspect = B.aspect; i.style = B.mstyle; i.brand_color = B.brand_color; if (B.logo_url) i.logo_url = B.logo_url; if (B.image_url) i.image_url = B.image_url; i.write_script = B.write_script; if (!B.write_script) i.script = B.script; if (B.cta.trim()) i.cta = B.cta.trim().slice(0, 30); }
    if (hasAddon(t, 'music')) { i.music = { enabled: !!B.music_on, mood: B.mood, source: B.music_src }; if (B.music_src === 'brand') { if (B.music_track) i.music.track_id = B.music_track; else i.music.source = 'library'; } }
    if (hasAddon(t, 'voice_ultra') || includes(t, 'voice_ultra')) i.voice_tier = includes(t, 'voice_ultra') ? 'ultra' : B.voice_tier;
    if (pipe === 'ugc') { i.write_script = B.write_script; if (!B.write_script) i.script = B.script; if (B.presenter === 'custom') i.presenter_desc = B.presenter_desc; else i.presenter = B.presenter; if (B.angle) i.angle = B.angle; i.captions = true; }
    if (pipe === 'video' || pipe === 'image_to_video') { i.style = B.style; i.aspect = B.aspect; if (B.image_url) i.image_url = B.image_url; }
    if (pipe === 'slideshow') { i.slides = B.slides; var l = lines(B.lines); if (l.length) i.lines = l; }
    if (pipe === 'dub') { i.video_url = B.video_url; i.script = B.script; i.source_language = B.source_language; }
    if (isEdit(t)) VooEdit.req(t, B, i);
    if (window.VooP2 && VooP2.isNew(t)) VooP2.req(t, B, i);
    if (B.actor_id && ['ugc', 'hook_remix', 'street'].indexOf(pipe) >= 0) { i.actor_id = B.actor_id; delete i.presenter_desc; }
    if (pipe === 'hook_remix') { i.count = B.hooks_n; var hk = lines(B.hooks_text); if (hk.length) i.hooks = hk; if (B.video_url) i.video_url = B.video_url; if (B.presenter === 'custom') i.presenter_desc = B.presenter_desc; else i.presenter = B.presenter; }
    return i;
  }
  i.type = B.kind;
  if (B.kind === 'image') { i.count = B.count; if (B.angle) i.style = B.angle; }
  if (B.kind === 'hooks' && B.angle) i.angle = B.angle;
  if (B.kind === 'script') { i.duration = B.duration; if (B.angle) i.angle = B.angle; }
  return i;
}
function readyMsg() {
  var t = curVT();
  if (isEdit(t)) return VooEdit.ready(t, B);
  if (B.product.trim().length <= 2) return 'Tell us what you’re advertising first.';
  if (!t) return '';
  if (t.pipeline === 'motion_ad' && !B.write_script && !B.script.trim()) return 'Add your voiceover script, or turn on \u201cWrite it for me\u201d.';
  if (t.pipeline === 'ugc' && !B.write_script && !B.script.trim()) return 'Add your script, or turn on “Write it for me”.';
  if ((t.pipeline === 'ugc' || t.pipeline === 'hook_remix') && B.presenter === 'custom' && !B.presenter_desc.trim()) return 'Describe your creator.';
  if (t.pipeline === 'image_to_video' && !B.image_url) return 'Upload a product photo.';
  if (t.pipeline === 'dub' && (!/^https?:\/\//.test(B.video_url) || !B.script.trim())) return 'Add the video link and its script.';
  return '';
}
function addonRows() {
  var t = curVT(); if (!t) return '';
  var a = (lastQ && lastQ.addons) || [], h = '';
  if (a.length) h = a.map(function (x) { return '<div class="row addon"><span>+ ' + esc(x.name) + (x.source ? ' \u00b7 ' + esc(x.source) : '') + (x.units ? ' \u00b7 ' + x.units + 's' : '') + '</span><b>' + (x.credits ? '+' + fmt(x.credits) + ' cr' : 'free') + '</b></div>'; }).join('');
  else {
    if (hasAddon(t, 'music') && B.music_on) h += '<div class="row addon"><span>+ Background music \u00b7 ' + (B.music_src === 'ai' ? 'AI' : 'library') + '</span><b>\u2026</b></div>';
    if (hasAddon(t, 'voice_ultra') && B.voice_tier === 'ultra' && !includes(t, 'voice_ultra')) h += '<div class="row addon"><span>+ Ultra-realistic voice</span><b>\u2026</b></div>';
  }
  if (includes(t, 'voice_ultra')) h += '<div class="row addon"><span>Ultra-realistic voice</span><b>included</b></div>';
  return h;
}
function paintSummary() {
  if (!$('#sumD')) return;
  var t = curVT(), name = t ? t.name : TOOLS[B.kind].name;
  var cost = lastQ && lastQ.credits, bal = ME.balance.total;
  var isVid = !!t, usable = isVid ? ME.balance.plan + ME.balance.topup : bal;
  var short = cost != null && cost > usable;
  var nr = readyMsg();
  var pres = CFG.presenters.find(function (p) { return p.id === B.presenter; });
  var rows = [['Making', name], ['Language', langName(B.language)]];
  if (isEdit(t)) rows = [['Making', name]].concat(VooEdit.rows(t, B));
  else if (t) {
    if (t.pipeline === 'ugc' || t.pipeline === 'hook_remix') rows.push(['Creator', B.presenter === 'custom' ? 'Your description' : pres ? pres.name : '']);
    if (t.pipeline !== 'hook_remix') { var segs = (lastQ && lastQ.segments) || 1; rows.push(['Length', B.duration + 's' + (segs > 1 ? ' · ' + segs + (t.pipeline === 'motion_ad' ? ' scenes' : ' parts') : '')]); }
    else rows.push(['Hooks', B.hooks_n]);
    if (t.pipeline === 'ugc' || t.pipeline === 'motion_ad') rows.push(['Script', B.write_script ? 'Written by AI' : 'Yours']);
    var lvc = curLevel(t); if (lvc) rows.push(['Quality', (B.level === 'auto' ? 'Auto · ' : '') + lvc.name]);
    if (t.pipeline === 'motion_ad') rows.push([lvc ? 'Animated ad' : 'Quality', t.quality === 'ultra' ? 'Ultra-realistic' : 'Standard'], ['Style', B.mstyle.charAt(0).toUpperCase() + B.mstyle.slice(1) + ' \u00b7 ' + B.aspect]);
  }
  if (B.kind === 'image') rows.push(['Images', B.count * 3 + ' (' + B.count + ' set' + (B.count > 1 ? 's' : '') + ')']);
  var adj = lastQ && lastQ.adjusted ? '<div class="adj">Price set to ' + fmt(lastQ.credits) + ' (list ' + fmt(lastQ.base_credits) + ') to cover the render cost for these settings.</div>' : '';
  var btn = short ? '<a class="btn arrow lt" href="#wallet">' + (ME.plan ? 'Top up credits' : 'Pick a plan') + ' ' + ARR() + '</a>' : '<button class="btn arrow lt" id="goBtn"' + (nr || cost == null ? ' disabled' : '') + '>Generate ' + ARR('arrow') + '</button>';
  $('#sumD').innerHTML = '<span class="ml">this will cost</span><div class="cost">' + COIN + '<span class="num">' + (cost == null ? '…' : fmt(cost)) + '</span><small>credits</small></div>' +
    rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('') +
    addonRows() +
    '<div class="row"><span>You have</span><b>' + fmt(bal) + ' credits</b></div>' + adj +
    (short ? '<div class="warn">' + (isVid && ME.balance.trial && !ME.plan ? 'Free trial credits can’t be used for video.' : 'Not enough credits for this one.') + '</div>' : '') +
    (lastQ && lastQ.error ? '<div class="warn">' + esc(lastQ.error) + '</div>' : '') +
    (nr && !short ? '<div class="warn soft">' + esc(nr) + '</div>' : '') + btn +
    '<p style="font:500 11.5px var(--mono);color:#6E6B63">failed renders refund automatically</p>';
  $('#sumM').innerHTML = '<div class="c">' + COIN + '<div><span class="num">' + (cost == null ? '…' : fmt(cost)) + ' cr</span><small>' + (nr ? esc(nr) : 'you have ' + fmt(bal)) + '</small></div></div>' + (short ? '<a class="btn hot sm" href="#wallet">' + (ME.plan ? 'Top up' : 'Unlock') + '</a>' : '<button class="btn arrow lt sm" id="goBtnM"' + (nr || cost == null ? ' disabled' : '') + '>Generate ' + ARR() + '</button>');
  [$('#goBtn'), $('#goBtnM')].forEach(function (b) { if (b) b.onclick = generate; });
  paintLevelTotal();
}
var generating = false;
async function generate() {
  if (generating) return; generating = true;
  $$('#goBtn,#goBtnM').forEach(function (b) { b.disabled = true; b.innerHTML = 'Starting <span class="spinner"></span>'; });
  try {
    var d = await api('POST', '/api/jobs', jobReq());
    ME.balance = d.balance; paintWallet();
    JOBS.unshift(d.job);
    if (B.kind === 'hooks') saveOb({ hooks: true });
    openJob(d.job);
  } catch (e) {
    if (e.status === 402 || (e.status === 403 && e.data && e.data.upgrade)) upsell(e.message, 'upgrade'); else toast(e.message, true);
  }
  generating = false; paintSummary();
}

/* ================= JOB VIEWER ================= */
function modal(html, title) {
  var m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = '<div class="mbox"><div class="mhd"><h3>' + esc(title || '') + '</h3><button class="x" aria-label="Close" data-close>' + I('x', 18) + '</button></div>' + html + '</div>';
  document.body.appendChild(m);
  var close = function () { m.remove(); removeEventListener('keydown', key); if (m._onclose) m._onclose(); };
  var key = function (e) { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) close(); });
  m._close = close;
  return m;
}
function jobName(j) { if (j.type === 'tool') return (j.input && j.input.tool_name) || 'AI tool'; var t = j.video_type && vtById(j.video_type); return t ? t.name : JOB_NAMES[j.type] || j.type; }
function openJob(job) {
  var m = modal('<div class="mbd" id="jb"></div>', jobName(job) + ' · ' + (job.input.product || '').slice(0, 40));
  var stop = false; m._onclose = function () { stop = true; if (route === 'library' || route === 'home') onRoute(); };
  var lastKey = '';
  var paint = function (j) { if (stop) return; var k = j.status + '|' + j.step + '|' + j.progress; if (k === lastKey && j.status === 'done') return; lastKey = k; $('#jb', m).innerHTML = jobBody(j); wireJob(m, j); VooUI.media(m); };
  paint(job);
  (async function loop() {
    var j = job;
    while (!stop && j.status !== 'done' && j.status !== 'failed') {
      await sleep(j.status === 'attention' ? 4000 : 1500);
      try { j = (await api('GET', '/api/jobs/' + job.id)).job; } catch (e) { continue; }
      paint(j);
    }
    if (stop) return;
    var i = JOBS.findIndex(function (x) { return x.id === j.id; }); if (i >= 0) JOBS[i] = j;
    if (j.status === 'done') toast(jobName(j) + ' ready'); else if (/^You cancelled/.test(j.error || '')) toast('Cancelled. Your credits are back.'); else toast('That one failed. Your credits are back.', true);
    refreshMe();
  })();
}
function jobBody(j) {
  if (j.status === 'failed') return '<div class="empty"><span class="ml" style="color:var(--bad)">render failed</span><b style="font-size:24px">That one didn’t work.</b><p>' + esc(j.error || 'The AI provider had a problem.') + '</p><p class="muted">Your <b>' + fmt(j.credits) + '</b> credits were returned. <b>Try again</b> reuses anything already made, so you only pay for the parts that are redone.</p><div class="chips"><button class="btn solid" data-retry>Try again</button><button class="btn ghost" data-again>Change settings</button><a class="btn ghost" href="#support" data-close>Tell support</a></div></div>';
  if (j.status === 'attention') {
    var at = (j.attention || {}), pn = (at.part != null ? at.part + 1 : '?');
    return '<div class="empty attn"><span class="ml" style="color:#FFD27A">needs your choice</span><b style="font-size:22px">Part ' + pn + ' of ' + (j.segments || '?') + ' could not be made.</b><p>' + esc(j.error || '') + '</p><p class="muted">Every other part and its voice are saved. Pick what to do:</p>' +
      '<div class="attn-b"><button class="btn blue" data-attn="retry">' + I('arrow', 15) + 'Try that part again</button><button class="btn ghost" data-attn="still">' + I('image', 15) + 'Use a still shot for that part <em>free</em></button><button class="btn ghost" data-attn="cancel">Cancel and refund all ' + fmt(j.credits) + ' credits</button></div></div>';
  }
  if (j.status !== 'done') {
    var steps = j.steps && j.steps.length ? j.steps : ['Starting'];
    var base = String(j.step || '').split(' · ')[0].replace(/ \(\d+\/\d+\)$/, '');
    var cur = Math.max(0, steps.indexOf(base));
    var pct = Math.max(5, Math.round((j.progress || (cur / steps.length)) * 100));
    var part = partOf(j), n = j.segments || (part && part.n) || 1, isVid = VIDEO_JOB.indexOf(j.type) >= 0;
    var k = part ? part.k : /stitch/i.test(j.step || '') ? n + 1 : 0;
    var segs = n > 1 ? '<div class="jsegs" style="--n:' + n + '">' + Array.from({ length: n }, function (_, x) { return '<div class="' + (x < k - 1 ? 'done' : x === k - 1 ? 'now' : '') + '"><span>' + pad(x + 1) + '</span></div>'; }).join('') + '</div>' : '';
    return '<div class="wait"><div><span class="ml"><span class="dot-live"></span>' + (isVid ? 'rendering' : 'working') + (n > 1 ? ' · ' + (j.input.duration || '') + 's in ' + n + ' parts' : '') + '</span><h4 style="margin-top:6px">' + esc(j.step && j.step !== 'start' ? j.step : 'Getting started') + '…</h4><p class="muted" style="font-size:14px;margin-top:6px">' + (isVid ? 'Videos take 1 to 4 minutes' + (n > 1 ? ', a little longer for long ones' : '') + '. You can close this; it keeps going and lands in My ads.' : 'This takes a few seconds.') + '</p></div></div>' +
      '<div class="render"><div class="rs"><span>' + (part ? 'Part <b>' + part.k + ' of ' + part.n + '</b>' : /stitch/i.test(j.step || '') ? '<b>Stitching ' + n + ' parts</b>' : esc(steps[cur] || '')) + '</span><span><b>' + pct + '%</b></span></div>' + segs + '<div class="bigprog"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="pipe">' + steps.map(function (s, i) { return '<div class="ps ' + (i < cur ? 'done' : i === cur ? 'now' : '') + '"><i>' + (i < cur ? I('check', 13, 3) : '') + '</i>' + esc(s) + '</div>'; }).join('') + '</div>';
  }
  var o = j.output || {}, h = '';
  if (j.demo) h += '<div class="demo-note">Demo mode: no AI keys are set up yet, so this is a sample result. Ask your admin to add keys in Admin → AI providers.</div>';
  if (j.adjusted) h += '<p class="ml">price was adjusted to cover the render cost for these settings</p>';
  if (o.note) h += '<div class="shieldline">' + I('stitch', 16) + esc(o.note) + '</div>';
  if (o.music_note) h += '<div class="shieldline">' + I('sound', 16) + esc(o.music_note) + '</div>';
  if (j.type === 'motion_ad') {
    var sc = o.scenes || [], ar = (j.input.aspect || '9:16').replace(':', '/');
    h += '<div class="res"><div style="display:grid;gap:8px">' + (o.url ? '<div class="player" style="aspect-ratio:' + ar + '"><video id="jv" src="' + esc(o.url) + '" controls autoplay playsinline loop></video></div>' :
      '<div class="player scn" id="scn" style="aspect-ratio:' + ar + ';--bc:' + esc(j.input.brand_color || '#FF4A1C') + '"><div class="scv" id="scv"></div><div class="sch" id="sch"></div><button class="scp" id="scp" aria-label="Play">' + I('play', 24) + '</button><div class="scb"><i id="scbar"></i></div></div>' +
      (o.audio_url ? '<audio id="sca" src="' + esc(o.audio_url) + '" preload="auto"></audio>' : '') + (o.music_url ? '<audio id="scm" src="' + esc(o.music_url) + '" preload="auto" loop></audio>' : '')) +
      (sc.length ? '<span class="ml">' + sc.length + ' scenes' + (o.url ? '' : ' \u00b7 plays as a playlist') + '</span><div class="plist" id="scl">' + sc.map(function (s, i) { return '<button data-sc="' + i + '"' + (i ? '' : ' class="on"') + '><span>' + esc(s.headline || 'Scene ' + (i + 1)) + '</span><span>' + Math.round(s.start || 0) + '\u2013' + Math.round(s.end || 0) + 's</span></button>'; }).join('') + (o.endcard ? '<button data-sc="end"><span>End card' + (o.endcard.cta ? ' \u00b7 ' + esc(o.endcard.cta) : '') + '</span><span>cta</span></button>' : '') + '</div>' : '') + '</div>' +
      '<div style="display:grid;gap:12px;align-content:start"><div class="chips">' + (o.url ? '<a class="btn arrow" href="' + esc(o.url) + '" download>Download video <span class="arr">' + I('download', 16) + '</span></a>' : '') + (o.captions_url ? '<a class="btn ghost" href="' + esc(o.captions_url) + '" download>Captions (.srt)</a>' : '') + (o.audio_url ? '<a class="chip" href="' + esc(o.audio_url) + '" download>' + I('mic', 13) + 'Voiceover</a>' : '') + (o.music_url ? '<a class="chip" href="' + esc(o.music_url) + '" download>' + I('sound', 13) + 'Music</a>' : '') + '</div>' +
      (sc.length ? '<div class="scr"><b>scenes</b>' + sc.map(function (s, i) { return '<span><b style="color:var(--ink);font:700 14px var(--sans)">' + pad(i + 1) + ' \u00b7 ' + esc(s.headline || '') + '</b><br>' + esc(s.vo || '') + (s.source ? ' <span class="ml">\u00b7 ' + esc(s.source) + '</span>' : '') + '</span>'; }).join('') + '</div>' : '') +
      '<div class="chips"><button class="chip" data-again>' + I('plus', 13) + 'Make another</button></div>' + (j.watermark ? '<p class="muted" style="font-size:13px">Trial outputs are for testing only. Pick a plan to use them in paid ads.</p>' : '') + '</div></div>';
  } else if (j.type === 'brand_music' && window.VooEdit) {
    h += VooEdit.musicResult(j);
  } else if (VIDEO_JOB.indexOf(j.type) >= 0 && j.type !== 'hook_remix') {
    var segs2 = o.playlist && o.segments && o.segments.length ? o.segments : null;
    var par = isEdit({ pipeline: j.type }) ? (o.aspect || j.input.aspect || '9:16') : '';
    par = par === 'original' ? 'auto' : par.replace(':', '/');
    var scr = o.script_obj ? scriptHTML(o.script_obj) : o.script ? '<div class="scr"><b>script</b>' + esc(o.script) + '</div>' : o.script_translated ? '<div class="scr"><b>translated script</b>' + esc(o.script_translated) + '</div>' : '';
    h += '<div class="res"><div style="display:grid;gap:8px"><div class="player"' + (par ? ' style="aspect-ratio:' + par + '"' : '') + '><video id="jv" src="' + esc(segs2 ? segs2[0].url : o.url) + '" controls autoplay playsinline' + (segs2 ? '' : ' loop') + '></video></div>' +
      (segs2 ? '<span class="ml">' + segs2.length + ' parts · plays in order</span><div class="plist" id="plist">' + segs2.map(function (s, i) { return '<button data-seg="' + i + '"' + (i ? '' : ' class="on"') + '><span>Part ' + (i + 1) + '</span><span>' + Math.round(s.start) + '–' + Math.round(s.end) + 's</span></button>'; }).join('') + '</div>' : '') + '</div>' +
      '<div style="display:grid;gap:12px;align-content:start"><div class="chips"><a class="btn arrow" href="' + esc(o.url) + '" download>Download video <span class="arr">' + I('download', 16) + '</span></a>' + (o.captions_url ? '<a class="btn ghost" href="' + esc(o.captions_url) + '" download>Captions (.srt)</a>' : '') + '</div>' +
      (segs2 ? '<div class="chips">' + segs2.map(function (s, i) { return '<a class="chip" href="' + esc(s.url) + '" download>' + I('download', 13) + 'Part ' + (i + 1) + '</a>'; }).join('') + '</div>' : '') +
      (window.VooEdit ? VooEdit.extra(j) : '') +
      (o.shield ? '<div class="shieldline">' + I('shield', 16) + 'Ban Shield <span class="sc" style="background:var(--good-bg);color:var(--good)">' + o.shield.score + '/100</span></div>' : '') + scr +
      (o.slides && o.slides.length ? '<div class="scr"><b>slides</b>' + o.slides.map(function (s, i) { return '<span>' + (i + 1) + '. ' + esc(typeof s === 'string' ? s : s.text || s.line || '') + '</span>'; }).join('') + '</div>' : '') +
      (o.lines && o.lines.length ? '<div class="scr"><b>interview</b>' + o.lines.map(function (l) { return '<span><b style="color:var(--ink);font:700 13px var(--sans)">' + (l.who === 'host' ? 'Presenter' : 'Passer-by') + '</b> ' + esc(l.text) + '</span>'; }).join('') + '</div>' : '') +
      (o.hits && o.hits.length ? '<div class="scr"><b>text hits</b><span>' + o.hits.map(esc).join(' · ') + '</span>' + (o.sfx ? '<span class="muted">' + esc(o.sfx) + '</span>' : '') + '</div>' : '') +
      (j.type === 'edit' && o.summary ? '<div class="scr"><b>version ' + (o.version || '') + '</b><span>' + esc(o.summary) + '</span></div>' : '') +
      (window.VooP2 ? VooP2.exportNote(j) : '') +
      '<div class="chips">' + (j.type !== 'edit' ? '<button class="chip" data-again>' + I('plus', 13) + 'Make another</button>' : '') + (j.type === 'ugc' ? '<button class="chip" data-lang>' + I('globe', 13) + 'Same ad, new language</button>' : '') + '</div>' + (j.watermark ? '<p class="muted" style="font-size:13px">Trial outputs are for testing only. Pick a plan to use them in paid ads.</p>' : '') + '</div></div>' +
      (window.VooP2 ? VooP2.chatPanel(j) : '');
  } else if (j.type === 'hook_remix' && window.VooP2) {
    h += VooP2.hookGrid(j) + VooP2.exportNote(j);
  } else if (j.type === 'actor') {
    h += '<div class="faces">' + ((o.faces) || []).map(function (f) { return '<img src="' + esc(f) + '" alt="">'; }).join('') + '</div><div class="chips"><a class="btn blue" href="#actors" data-close>Pick a face in Actors</a></div>';
  } else if (j.type === 'hook_remix') {
    h += '<div style="display:grid;gap:8px">' + (o.hooks || []).map(function (x, i) { return '<div class="clip"><div class="media"><video muted loop playsinline preload="metadata" data-src="' + esc(x.url) + '"></video></div><div style="display:grid;gap:8px"><b>' + esc(x.text) + '</b><div class="chips"><a class="chip" href="' + esc(x.url) + '" download>' + I('download', 13) + 'Hook clip</a>' + (x.remix_url ? '<a class="chip on" href="' + esc(x.remix_url) + '" download>' + I('download', 13) + 'Full ad with this hook</a>' : '') + '</div></div></div>'; }).join('') + '</div>';
  } else if (j.type === 'image') {
    h += '<div class="imgs">' + (o.images || []).map(function (im) { return '<a href="' + esc(im.url) + '" download target="_blank"><img src="' + esc(im.url) + '" alt="' + esc(im.ratio) + ' ad image">' + esc(im.ratio) + '</a>'; }).join('') + '</div><div class="chips"><button class="chip" data-again>Make more</button></div>';
  } else if (j.type === 'hooks') {
    h += '<div class="ch"><b>' + hookList(o).length + ' hooks</b><button class="btn ghost sm" data-copyall>' + I('copy', 14) + ' Copy all</button></div><div class="hk">' + hookList(o).map(function (x, i) { return '<div><span class="n">' + pad(i + 1) + '</span><span>' + esc(x) + '</span><button class="cbtn" data-copy="' + esc(x) + '">' + I('copy', 13) + 'Copy</button></div>'; }).join('') + '</div><div class="chips"><button class="chip" data-again>20 more</button>' + (ME.plan ? '<button class="chip" data-tougc>Turn a hook into a UGC video</button>' : '') + '</div>';
  } else if (j.type === 'angles') {
    h += '<div class="ang">' + (o.angles || []).map(function (a, i) { return '<div><span class="ml">' + pad(i + 1) + ' · ' + esc(a.angle || 'angle') + '</span><b>“' + esc(a.hook) + '”</b><small>' + esc(a.why || '') + '</small><div class="chips" style="margin-top:6px"><button class="cbtn" data-copy="' + esc(a.hook) + '">' + I('copy', 13) + 'Copy hook</button>' + (ME.plan ? '<button class="cbtn" data-useangle="' + i + '">' + I('ugc', 13) + 'Make it a UGC video</button>' : '') + '</div></div>'; }).join('') + '</div>';
  } else if (j.type === 'script') {
    h += scriptHTML(o.script || {}) + (o.shield ? '<div class="shieldline">' + I('shield', 16) + 'Ban Shield <span class="sc" style="background:var(--good-bg);color:var(--good)">' + o.shield.score + '/100</span></div>' : '') + '<div class="chips"><button class="btn ghost sm" data-copyscript>' + I('copy', 14) + ' Copy script</button>' + (ME.plan ? '<button class="btn solid sm" data-scripttougc>Make it a UGC video</button>' : '') + '</div>';
  } else if (j.type === 'tool' && window.VooStudioX) {
    h += VooStudioX.result(j);
  }
  return h;
}
function sceneDriver(m, j) {
  var o = j.output || {}, sc = o.scenes || [], v = $('#jv', m), list = $$('#scl button', m);
  var mark = function (i) { list.forEach(function (b) { b.classList.toggle('on', b.dataset.sc === String(i)); }); };
  if (v) { list.forEach(function (b) { b.onclick = function () { var s = sc[Number(b.dataset.sc)]; v.currentTime = s ? (s.start || 0) : Math.max(0, (v.duration || 0) - 3); v.play().catch(function () {}); }; }); v.ontimeupdate = function () { var t = v.currentTime, k = sc.findIndex(function (s) { return t >= (s.start || 0) && t < (s.end || 0); }); mark(k < 0 ? 'end' : k); }; return; }
  var box = $('#scn', m); if (!box) return;
  var a = $('#sca', m), mu = $('#scm', m), total = sc.length ? sc[sc.length - 1].end || sc.length * 4 : 0, endLen = o.endcard ? 3 : 0, t0 = 0, t = 0, playing = false, raf = 0, last = -2;
  if (mu) mu.volume = .22;
  var show = function (i) {
    if (i === last) return; last = i; mark(i);
    var s = sc[i];
    if (s) { $('#scv', m).innerHTML = s.visual_url ? (s.visual_type === 'video' ? '<video src="' + esc(s.visual_url) + '" muted autoplay loop playsinline></video>' : '<img class="kb" src="' + esc(s.visual_url) + '" alt="">') : ''; $('#sch', m).innerHTML = '<span>' + esc(s.headline || '') + '</span>'; }
    else if (o.endcard) { var e = o.endcard; $('#scv', m).innerHTML = '<div class="endc">' + (e.logo_url ? '<img src="' + esc(e.logo_url) + '" alt="">' : '') + (e.image_url ? '<img class="prod" src="' + esc(e.image_url) + '" alt="">' : '') + '<b>' + esc(e.headline || e.product || '') + '</b>' + (e.cta ? '<span class="cta">' + esc(e.cta) + '</span>' : '') + '</div>'; $('#sch', m).innerHTML = ''; }
  };
  var at = function (x) { var k = sc.findIndex(function (s) { return x >= (s.start || 0) && x < (s.end || 0); }); return k >= 0 ? k : x >= total ? 'end' : 0; };
  var tick = function (now) {
    if (!document.body.contains(box)) { if (a) a.pause(); if (mu) mu.pause(); return; }
    if (playing) { t = a && !a.paused && isFinite(a.currentTime) && a.currentTime > 0 ? a.currentTime : (now - t0) / 1000; if (t >= total + endLen) { playing = false; box.classList.remove('on'); if (mu) mu.pause(); } }
    show(at(t)); $('#scbar', m).style.width = Math.min(100, t / Math.max(1, total + endLen) * 100) + '%';
    raf = requestAnimationFrame(tick);
  };
  var start = function (from) { t = from || 0; t0 = performance.now() - t * 1000; playing = true; box.classList.add('on'); if (a) { try { a.currentTime = t; } catch (e) {} a.play().catch(function () {}); } if (mu) mu.play().catch(function () {}); };
  $('#scp', m).onclick = function () { if (playing) { playing = false; box.classList.remove('on'); if (a) a.pause(); if (mu) mu.pause(); } else start(t >= total + endLen ? 0 : t); };
  list.forEach(function (b) { b.onclick = function () { var s = sc[Number(b.dataset.sc)]; start(s ? s.start || 0 : total); }; });
  show(0); raf = requestAnimationFrame(tick);
}
function hookList(o) { return (o.hooks || []).map(function (x) { return typeof x === 'string' ? x : (x && x.text) || ''; }); }
function scriptHTML(s) { return '<div class="scr">' + (s.angle ? '<b>angle</b><span>' + esc(s.angle) + '</span>' : '') + (s.hook ? '<b>hook</b><span>' + esc(s.hook) + '</span>' : '') + (s.lines ? '<b>script</b>' + s.lines.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') : '') + (s.cta ? '<b>call to action</b><span>' + esc(s.cta) + '</span>' : '') + '</div>'; }
function ugcId() { var u = VT.find(function (t) { return t.pipeline === 'ugc'; }); return u ? u.id : 'hooks'; }
function wireJob(m, j) {
  var o = j.output || {};
  $$('[data-copy]', m).forEach(function (b) { b.onclick = function () { copy(b.dataset.copy); }; });
  var w = function (sel, fn) { var b = $(sel, m); if (b) b.onclick = fn; };
  var v = $('#jv', m), segs = o.playlist && o.segments;
  if (v && segs && segs.length) {
    var play = function (i) { v.src = segs[i].url; v.dataset.i = i; v.play().catch(function () {}); $$('#plist button', m).forEach(function (b, k) { b.classList.toggle('on', k === i); }); };
    v.dataset.i = 0; v.onended = function () { var n = Number(v.dataset.i) + 1; if (n < segs.length) play(n); };
    $$('#plist button', m).forEach(function (b) { b.onclick = function () { play(Number(b.dataset.seg)); }; });
  }
  if (j.type === 'motion_ad' && j.status === 'done') sceneDriver(m, j);
  if (window.VooP2 && j.status === 'done') { VooP2.wireChat(m, j, function (url) { var pv = $('#jv', m); if (pv && url) { pv.src = url; pv.play().catch(function () {}); } }); VooP2.wireExport(m); }
  w('[data-copyall]', function () { copy(hookList(o).join('\n')); });
  w('[data-copyscript]', function () { var s = o.script || {}; copy([s.hook].concat(s.lines || []).concat([s.cta]).filter(Boolean).join('\n')); });
  var kindOf = function () { return j.video_type && vtById(j.video_type) ? j.video_type : TOOLS[j.type] ? j.type : (VT.find(function (t) { return t.pipeline === j.type; }) || {}).id || 'hooks'; };
  var reuse = function (kind, extra) { B = newDraft(kind); B.product = j.input.product || ''; B.audience = j.input.audience || ''; B.language = j.input.language || 'en'; Object.assign(B, extra || {}); m._onclose = null; m._close(); go('#create?type=' + kind); };
  w('[data-again]', function () { reuse(kindOf(), { presenter: j.input.presenter || B.presenter, duration: j.input.duration || 15, style: j.input.style || 'product' }); });
  w('[data-retry]', async function () {
    var b = this; b.disabled = true; b.textContent = 'Starting…';
    try { var r = await api('POST', '/api/jobs/' + j.id + '/retry'); toast(r.credits_saved ? 'Started again. ' + r.credits_saved + ' credits saved by reusing what was made.' : 'Started again'); m._onclose = null; m._close(); JOBS.unshift(r.job); refreshMe(); openJob(r.job); }
    catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Try again'; }
  });
  $$('[data-attn]', m).forEach(function (b) { b.onclick = async function () {
    if (b.dataset.attn === 'cancel' && !confirm('Cancel this video? All its credits come back.')) return;
    $$('[data-attn]', m).forEach(function (x) { x.disabled = true; });
    try { await api('POST', '/api/jobs/' + j.id + '/attention', { action: b.dataset.attn }); toast(b.dataset.attn === 'cancel' ? 'Cancelled. Your credits are back.' : 'On it'); if (b.dataset.attn === 'cancel') refreshMe(); }
    catch (e) { toast(e.message, true); $$('[data-attn]', m).forEach(function (x) { x.disabled = false; }); }
  }; });
  w('[data-lang]', function () { reuse(kindOf(), { script: '', write_script: !!(ME.plan && ME.plan.scripts), duration: j.input.duration || 15, language: j.input.language === 'es' ? 'pt' : 'es' }); toast('Pick the new language, then Generate'); });
  w('[data-tougc]', function () { reuse(ugcId(), { angle: hookList(o)[0] || '' }); });
  w('[data-usetrack]', function () { var id = Number(this.dataset.usetrack); reuse(ugcId(), { music_on: true, music_src: 'brand', music_track: id }); toast('Your brand track is set as the music'); });
  w('[data-scripttougc]', function () { var s = o.script || {}; reuse(ugcId(), { write_script: false, script: [s.hook].concat(s.lines || []).concat([s.cta]).filter(Boolean).join(' ') }); });
  $$('[data-useangle]', m).forEach(function (b) { b.onclick = function () { var a = (o.angles || [])[Number(b.dataset.useangle)] || {}; reuse(ugcId(), { angle: [a.angle, a.hook].filter(Boolean).join(': ') }); }; });
}

/* ================= LIBRARY ================= */
function libItem(j) {
  var o = j.output || {}, th = '', txt = false;
  if (j.status === 'done' && o.url) th = '<video muted playsinline preload="metadata" src="' + esc(o.url) + '#t=0.5"></video>';
  else if (j.status === 'done' && j.type === 'hook_remix' && o.hooks && o.hooks[0]) th = '<video muted playsinline preload="metadata" src="' + esc(o.hooks[0].url) + '#t=0.5"></video>';
  else if (j.status === 'done' && j.type === 'image' && o.images && o.images[0]) th = '<img src="' + esc((o.images[1] || o.images[0]).url) + '" alt="" loading="lazy">';
  else if (j.status === 'done' && j.type === 'hooks') { txt = true; th = '<div class="tx">“' + esc(hookList(o)[0] || '') + '”<br><br><span class="ml">+' + Math.max(0, hookList(o).length - 1) + ' more</span></div>'; }
  else if (j.status === 'done' && j.type === 'angles') { txt = true; th = '<div class="tx">“' + esc(((o.angles || [])[0] || {}).hook || '') + '”<br><br><span class="ml">10 angles</span></div>'; }
  else if (j.status === 'done' && j.type === 'script') { txt = true; th = '<div class="tx">“' + esc((o.script || {}).hook || '') + '”</div>'; }
  else if (j.status === 'done' && j.type === 'tool' && window.VooStudioX && VooStudioX.libText(j)) { txt = true; th = '<div class="tx">' + VooStudioX.libText(j) + '</div>'; }
  else if (window.VooEdit && VooEdit.libThumb(j)) { txt = true; th = VooEdit.libThumb(j); }
  else th = '<span class="li-ic">' + T(PIPE_IC[j.type] || (TOOLS[j.type] || {}).ic || 'film', 40) + '</span>';
  var p = partOf(j);
  var st = j.status === 'done' ? '' : j.status === 'failed' ? '<span class="pill bad">Failed</span>' : '<span class="pill warn"><span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' + (p ? 'Part ' + p.k + '/' + p.n : esc((j.step || 'Working').slice(0, 18))) + '</span>';
  return '<button class="li" data-id="' + j.id + '"><div class="th ' + (txt ? 'txt' : 'media') + '">' + th + (st || '<span class="pill plain">' + esc(jobName(j)) + '</span>') + '</div><div class="mt"><b>' + esc(j.input.product || j.input.prompt || 'Untitled') + '</b>' + (j.level ? '<span class="lvtag lv-' + esc(j.level) + '" title="' + esc(j.model || '') + '">' + esc(j.level_name || j.level) + '</span>' : '') + '<small>' + esc((j.input.language || 'en').toUpperCase()) + ' · ' + new Date(j.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + fmt(j.credits) + ' cr' + (j.input.duration && VIDEO_JOB.indexOf(j.type) >= 0 ? ' · ' + j.input.duration + 's' : '') + '</small></div></button>';
}
function wireLib(el) {
  $$('.li', el).forEach(function (b) {
    b.onclick = function () { var j = JOBS.find(function (x) { return x.id === Number(b.dataset.id); }); if (j) openJob(j); };
    var v = $('video', b); if (v) { v.addEventListener('loadeddata', function () { v.parentElement.classList.add('ok'); }); b.onmouseenter = function () { v.play().catch(function () {}); }; b.onmouseleave = function () { v.pause(); }; }
  });
}
async function pLibrary(el) {
  var f = 'all';
  el.innerHTML = '<div class="ch"><div class="seg" id="lf">' + [['all', 'All'], ['ugc', 'UGC'], ['video', 'Videos'], ['slideshow', 'Slideshows'], ['image', 'Images'], ['music', 'Music'], ['hooks', 'Hooks & angles'], ['script', 'Scripts']].map(function (x, i) { return '<button data-f="' + x[0] + '"' + (i ? '' : ' class="on"') + '>' + x[1] + '</button>'; }).join('') + '</div><a class="btn arrow" href="#create">New ad ' + ARR('plus') + '</a></div><div class="lib" id="libG"><div class="empty" style="grid-column:1/-1"><span class="spinner"></span></div></div>';
  await loadJobs();
  if (route !== 'library') return;
  var match = function (j) { if (f === 'all') return true; if (f === 'video') return ['video', 'image_to_video', 'dub', 'hook_remix', 'bg_swap', 'auto_edit'].indexOf(j.type) >= 0; if (f === 'music') return j.type === 'brand_music'; if (f === 'hooks') return j.type === 'hooks' || j.type === 'angles'; return j.type === f; };
  var paint = function () {
    var list = JOBS.filter(match);
    $('#libG').innerHTML = list.length ? list.map(libItem).join('') : '<div class="empty" style="grid-column:1/-1"><b>Nothing here yet</b><a class="btn arrow" href="#create">Create an ad ' + ARR() + '</a></div>';
    wireLib($('#libG'));
  };
  $('#lf').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; f = b.dataset.f; $$('#lf button').forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); };
  paint();
  if (JOBS.some(function (j) { return j.status !== 'done' && j.status !== 'failed'; })) setTimeout(function () { if (route === 'library') pLibrary(el); }, 5000);
}

/* ================= BAN SHIELD ================= */
function pShield(el) {
  el.innerHTML = '<div class="g2"><div class="card"><span class="ml">free · unlimited</span><h2 class="hx2">Check any ad copy. <span class="g">Before Meta does.</span></h2><p class="muted" style="font-size:14.5px">Scripts, captions, headlines. Ban Shield flags lines ad platforms often reject and rewrites them.</p>' +
    '<div class="fld"><label for="shText" class="sr">Ad copy</label><textarea class="inp" id="shText" rows="8" placeholder="Paste your ad copy here"></textarea></div><div style="display:flex;gap:10px;flex-wrap:wrap"><select class="inp" id="shN" style="flex:1;min-width:160px">' + NICHES.map(function (n) { return '<option value="' + n[0] + '"' + (ME.brand && ME.brand.niche === n[0] ? ' selected' : '') + '>' + n[1] + '</option>'; }).join('') + '</select><button class="btn arrow" id="shGo">Check it <span class="arr">' + I('shield', 16) + '</span></button></div></div>' +
    '<div class="card" id="shR"><div class="empty">' + (TN ? TN.empty('shield') : '') + '<span class="ml">Score out of 100</span><b>Your score shows here</b><p>100 is safest. Under 50 is likely to be rejected.</p></div></div></div>';
  $('#shGo').onclick = async function () {
    var t = $('#shText').value.trim(); if (!t) { $('#shText').focus(); return; }
    var b = this; b.disabled = true;
    try {
      var d = await api('POST', '/api/shield', { text: t, niche: $('#shN').value });
      saveOb({ shield: true });
      var c = d.level === 'low' ? ['var(--good)', 'Safe to run'] : d.level === 'review' ? ['var(--warn)', 'Needs a tweak'] : ['var(--bad)', 'High ban risk'];
      $('#shR').innerHTML = '<div style="display:flex;align-items:center;gap:16px"><div style="width:100px;height:100px;border-radius:50%;background:conic-gradient(' + c[0] + ' ' + d.score + '%,var(--soft) 0);display:grid;place-items:center;flex:none"><b style="width:80px;height:80px;border-radius:50%;background:#fff;display:grid;place-items:center;font:600 28px var(--mono);letter-spacing:-.06em">' + d.score + '</b></div><div><span class="ml">ban shield</span><h2 style="color:' + c[0] + '">' + c[1] + '</h2><p class="muted">' + (d.flags.length ? d.flags.length + ' line' + (d.flags.length > 1 ? 's' : '') + ' to fix' : 'Nothing risky found.') + '</p></div></div>' +
        d.flags.map(function (f) { return '<div class="shieldline" style="display:grid;gap:3px;align-items:start"><b style="color:var(--bad)">“' + esc(f.phrase) + '”</b><span class="muted" style="font-weight:500">' + esc(f.why) + ' Try: “' + esc(f.fix) + '”</span></div>'; }).join('') +
        (d.rewrite && d.rewrite !== t ? '<div class="fld"><span class="lbl">Safer version</span><div class="scr" style="background:var(--good-bg)">' + esc(d.rewrite) + '</div><div class="chips"><button class="btn solid sm" id="shCp">Copy</button><button class="btn ghost sm" id="shUse">Use in a UGC video</button></div></div>' : '') +
        '<p class="ml">Ban Shield lowers risk. It can’t guarantee approval.</p>';
      if ($('#shCp')) $('#shCp').onclick = function () { copy(d.rewrite); };
      if ($('#shUse')) $('#shUse').onclick = function () { B = newDraft(ugcId()); B.write_script = false; B.script = d.rewrite; go('#create?type=' + ugcId()); };
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  };
}

/* ================= LEARN ================= */
function lessonIcon(l) {
  var t = (l.title + ' ' + (l.id || '')).toLowerCase();
  return /getting started|tour|basics/.test(t) ? 'home' : /hook/.test(t) ? 'hooks' : /shield|ban/.test(t) ? 'shield' : /credit|plan|pay|wallet/.test(t) ? 'credits' : /animat|motion/.test(t) ? 'spark' : /image|photo/.test(t) ? 'image' : /support|help|ticket/.test(t) ? 'support' : /slide/.test(t) ? 'slides' : /dub|language|translat|voice/.test(t) ? 'mic' : /ugc|creator/.test(t) ? 'ugc' : /long|part|video/.test(t) ? 'video' : /script/.test(t) ? 'script' : /scal|winner/.test(t) ? 'trend' : /referr|brand|earn/.test(t) ? 'gift' : 'play';
}
async function pLearn(el, r) {
  if (window.VooP2) return VooP2.learn(el, r);
  el.innerHTML = '<section class="lhero"><div class="lh-txt"><span class="lh-k" id="lCount">' + (TN ? TN.coachFace(24) : '') + 'Short lessons with Coach Vee</span><h2>Learn Vooads, <em>two minutes</em> at a time.</h2><p>Coach Vee walks you through the real studio while the cursor does it. Captions on, pause any time, replay any step.</p><button class="btn arrow" id="lPlay">Start with the basics ' + ARR('play') + '</button></div><div class="lh-scene">' + (TN ? TN.classroom() : '') + '</div></section><div class="lgrid" id="lGrid"><div class="empty" style="grid-column:1/-1"><span class="spinner"></span></div></div>';
  $('#lPlay').onclick = function () { VooTrainer.open({ match: 'getting started' }); };
  var ls = await VooTrainer.lessons();
  if (route !== 'learn') return;
  if (ls.length) $('#lCount').innerHTML = (TN ? TN.coachFace(24) : '') + ls.length + ' short lessons with Coach Vee';
  var tints = ['#FFEDE6', '#F3EEE4', '#FFE3D6', '#EFEDE6'];
  $('#lGrid').innerHTML = ls.map(function (l, i) {
    var lvl = String(l.level || 'Beginner'); lvl = lvl.charAt(0).toUpperCase() + lvl.slice(1).toLowerCase();
    return '<button class="lc' + (i ? '' : ' first') + '" data-id="' + esc(l.id) + '"><span class="lc-th" style="--th:' + tints[i % 4] + '">' + (TN ? TN.lesson(lessonIcon(l)) : T(lessonIcon(l), 36)) + '<span class="pl">' + I('play', 16) + '</span></span><span class="lc-pill' + (i ? '' : ' start') + '">' + (i ? 'Lesson ' + (i + 1) + ' · ' + esc(lvl) : 'Start here · ' + esc(lvl)) + '</span><h3>' + esc(l.title) + '</h3><p>' + esc(l.summary || '') + '</p><span class="lc-meta">' + (l.minutes || 2) + ' min · ' + (l.scenes || []).length + ' steps</span></button>';
  }).join('');
  $$('#lGrid .lc').forEach(function (b) { b.onclick = function () { VooTrainer.open({ id: b.dataset.id }); }; });
  if (r && r.sub) { var id = r.sub.replace(/^lesson-/, ''); VooTrainer.open({ id: id, match: id.replace(/-/g, ' ') }); history.replaceState(null, '', '#learn'); }
}

/* ================= WALLET ================= */
var period = 'month';
async function pWallet(el) {
  el.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  var d; try { d = await api('GET', '/api/billing'); } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; return; }
  if (route !== 'wallet') return;
  ME = d.user; paintWallet();
  if (wantPlan) period = wantPlan.period;
  var b = ME.balance, p = ME.plan;
  var capW = p ? p.credits_month : ((CFG.free_trial && CFG.free_trial.credits) || Math.max(1, b.total));
  el.innerHTML = '<div class="balcard"><div class="bc-l"><div class="wc-top" style="justify-content:flex-start"><b>' + T('credits', 22) + 'Your credits</b><span class="wc-plan' + (p ? ' paid' : '') + '">' + (p ? esc(p.name) + ' · ' + (p.period === 'year' ? 'yearly' : 'monthly') : 'Free trial') + '</span></div>' +
    '<div class="big"><span class="num" id="bcNum">' + fmt(b.total) + '</span><small>credits</small></div>' +
    '<div class="bk"><span>Plan <b>' + fmt(b.plan) + '</b></span><span>Top-up <b>' + fmt(b.topup) + '</b></span><span>Trial <b>' + fmt(b.trial) + '</b> · no video</span></div>' +
    (p ? '<p class="bc-note">' + (p.auto_renew ? 'Renews' : 'Ends') + ' on <b>' + esc((p.expires_at || '').slice(0, 10)) + '</b>. ' + fmt(p.credits_month) + ' credits every month' + (p.scripts ? ', AI scripts included' : '') + '.</p>' + (d.subscription ? subNote(d.subscription) : '') + (p.auto_renew || (d.subscription && !d.subscription.cancel_at_period_end) ? '<button class="btn xs ghost" id="cancelB">' + (d.subscription ? 'Cancel auto-renew' : 'Turn off auto-renew') + '</button>' : '') : '<p class="bc-note">Trial credits work for hooks, angles, images and Ban Shield. Pick a plan below to make videos.</p>') +
    (b.total < u15() ? '<p class="bc-low">' + I('credits', 14) + 'Low balance: less than one 15-second UGC video left.</p>' : '') +
    '<div class="bc-act"><button class="btn blue' + (b.total < u15() ? ' hi' : '') + '" id="bcBuy">' + I('plus', 15) + 'Buy credits</button><button class="btn ghost" id="bcPlan">' + (p ? 'Change plan' : 'Pick a plan') + '</button></div>' +
    '</div>' + creditGets() + '<div class="bc-jar">' + (TN ? TN.jar(b.total / Math.max(1, capW)) : '') + '</div></div>' +
    '<div class="card" id="planS"><div class="ch"><div><h2>' + (p ? 'Change plan' : 'Pick a plan') + '</h2><p class="muted" style="font-size:14px">Cancel anytime. Credits refresh every month.</p></div><div class="seg" id="perS"><button data-p="month"' + (period === 'month' ? ' class="on"' : '') + '>Monthly</button><button data-p="year"' + (period === 'year' ? ' class="on"' : '') + '>Yearly <em>2 months free</em></button></div></div><div class="plans" id="plansGrid"></div></div>' +
    '<div class="card" id="topS"><div class="ch"><div><h2>Top up</h2><p class="muted" style="font-size:14px">' + (p ? 'Extra credits that never expire.' : 'Top-ups unlock after you pick a plan.') + '</p></div></div><div class="tops">' + d.topups.map(function (t) { return '<button class="tp" data-t="' + t.id + '"' + (p ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '><b>' + fmt(t.credits) + ' credits</b><small>$' + (function (r) { return r % 1 ? r.toFixed(2) : fmt(r); })(Math.round(t.price * ((d.methods[0] && d.methods[0].price_factor) || 1) * 100) / 100) + ' · ≈ ' + Math.floor(t.credits / u15()) + ' UGC videos</small></button>'; }).join('') + '</div></div>' +
    '<div class="g2"><div class="card"><h2>Payments</h2><div class="tblw"><table class="tbl"><thead><tr><th>date</th><th>what</th><th>amount</th><th>status</th></tr></thead><tbody>' + (d.payments.length ? d.payments.map(function (x) { return '<tr><td>' + esc((x.paid_at || x.created_at || '').slice(0, 10)) + '</td><td>' + (x.kind === 'plan' ? esc(x.plan_id) + ' plan' : fmt(x.credits) + ' credits') + '</td><td>$' + fmt(x.amount_usd) + '</td><td><span class="pill ' + (x.status === 'paid' ? 'good' : x.status === 'refunded' ? 'plain' : 'warn') + '">' + esc(x.status) + '</span></td></tr>'; }).join('') : '<tr><td colspan="4" class="muted">No payments yet.</td></tr>') + '</tbody></table></div></div>' +
    '<div class="card"><h2>Credit history</h2><div class="tblw"><table class="tbl"><tbody>' + d.ledger.map(function (x) { return '<tr><td>' + esc(x.reason) + '<br><small class="ml">' + esc((x.created_at || '').slice(0, 16)) + '</small></td><td style="text-align:right;font:600 14px var(--mono);color:' + (x.delta > 0 ? 'var(--good)' : 'var(--ink)') + '">' + (x.delta > 0 ? '+' : '') + fmt(x.delta) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
  // Prices include the default payment method's price (the first one offered); the checkout updates them per method.
  var pf = (d.methods[0] && d.methods[0].price_factor) || 1, px = function (v) { var r = Math.round(v * pf * 100) / 100; return r % 1 ? r.toFixed(2) : fmt(r); };
  var paintPlans = function () {
    $('#plansGrid').innerHTML = d.plans.map(function (x) {
      var cur = p && p.id === x.id, price = period === 'year' ? Math.round(x.price_year / 12) : x.price_month;
      return '<div class="plc' + (x.popular ? ' pop' : '') + (cur ? ' cur' : '') + '"><div class="ch"><h3>' + esc(x.name) + '</h3>' + (cur ? '<span class="pill good">Current</span>' : x.popular ? '<span class="pill brand">Most popular</span>' : '') + '</div><div class="pr3">$' + px(price) + '<span>/mo</span></div><span class="ml">' + (period === 'year' ? '$' + px(x.price_year) + ' billed yearly' : 'billed monthly') + '</span><div class="crd">' + COIN + fmt(x.credits_month) + ' credits/mo</div><ul>' + (x.features || []).slice(1, 6).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><button class="btn arrow ' + (x.popular ? 'lt' : '') + '" data-plan="' + x.id + '">' + (cur ? 'Renew ' : 'Choose ') + esc(x.name) + ' ' + ARR() + '</button></div>';
    }).join('');
    $$('[data-plan]').forEach(function (bt) { bt.onclick = function () { checkout({ kind: 'plan', plan_id: bt.dataset.plan, period: period }, d); }; });
  };
  paintPlans();
  if (TN) TN.countUp($('#bcNum'), b.total, 1300);
  $('#perS').onclick = function (e) { var bt = e.target.closest('button'); if (!bt) return; period = bt.dataset.p; $$('#perS button').forEach(function (x) { x.classList.toggle('on', x === bt); }); paintPlans(); };
  $$('.tp').forEach(function (bt) { bt.onclick = function () { if (!p) return; checkout({ kind: 'topup', topup_id: bt.dataset.t }, d); }; });
  var jump = function (id) { var e = $(id); if (!e) return; e.scrollIntoView({ behavior: 'smooth', block: 'start' }); e.classList.add('flash'); setTimeout(function () { e.classList.remove('flash'); }, 1600); };
  $('#bcPlan').onclick = function () { jump('#planS'); };
  // Buy credits: the smallest pack that covers at least two 15s videos opens the checkout sheet straight away (plans first on a trial).
  $('#bcBuy').onclick = function () {
    if (!p) { toast('Pick a plan first. Top-ups work on any plan.'); jump('#planS'); return; }
    var need = u15() * 2, t = d.topups.slice().sort(function (a, b) { return a.credits - b.credits; }).find(function (x) { return x.credits >= need; }) || d.topups[d.topups.length - 1];
    if (t) checkout({ kind: 'topup', topup_id: t.id }, d); else jump('#topS');
  };
  if ($('#cardB')) $('#cardB').onclick = async function () { var bt = this; bt.disabled = true; try { var r = await api('POST', '/api/billing/card'); location.href = r.url; } catch (e) { bt.disabled = false; toast(e.message, true); } };
  if ($('#cancelB')) $('#cancelB').onclick = async function () { if (!d.subscription && !confirm('Turn off auto-renew? Your plan stays active until the end of the period.')) return; this.disabled = true; try { var r = await api('POST', '/api/billing/cancel'); toast(r.message); pWallet(el); } catch (e) { toast(e.message, true); } };
  if (window.VooStudioX) VooStudioX.walletBanner(el, d.payments);
  if (wantPlan) { var wp = wantPlan; wantPlan = null; setTimeout(function () { checkout({ kind: 'plan', plan_id: wp.id, period: wp.period }, d); }, 300); }
}
// Bachs card auto-renew in the wallet: next charge date and amount, or a calm "update your card" notice.
function subNote(s) {
  var when = esc((s.next_charge_at || '').slice(0, 10));
  if (s.payment_failed) return '<div class="bc-low" role="status" style="display:block">' + I('wallet', 14) + '<b>Card payment did not go through.</b> ' + esc(s.payment_failed.message) + (s.payment_failed.grace_until ? ' Your plan stays active until ' + esc(s.payment_failed.grace_until.slice(0, 10)) + '.' : '') + ' <button class="btn xs blue" id="cardB">Update card</button></div>';
  if (s.cancel_at_period_end) return '<p class="bc-note">Auto-renew is off. Nothing more will be charged.</p>';
  return when ? '<p class="bc-note">Next charge: <b>' + esc(s.next_amount_label) + '</b> on <b>' + when + '</b>' + (s.price_changed ? ' (new price with the exchange rate)' : '') + '. We email you before it.</p>' : '';
}
function checkout(sel, d) {
  var item = sel.kind === 'plan' ? d.plans.find(function (x) { return x.id === sel.plan_id; }) : d.topups.find(function (x) { return x.id === sel.topup_id; });
  if (!item) return;
  var amount = sel.kind === 'plan' ? (sel.period === 'year' ? item.price_year : item.price_month) : item.price;
  var label = sel.kind === 'plan' ? item.name + ' plan · ' + (sel.period === 'year' ? 'yearly' : 'monthly') : fmt(item.credits) + ' credits';
  if (!d.methods.length) { toast('No payment methods are set up yet. Contact support.', true); return; }
  var isPlan = sel.kind === 'plan', yr = sel.period === 'year';
  var credits = isPlan ? fmt(item.credits_month) + ' credits every month' : fmt(item.credits) + ' credits, added now';
  var inc = isPlan ? ['AI creator videos up to ' + (item.max_ugc_seconds || 15) + 's', item.scripts ? 'AI script writer included' : 'Images, hooks and ad copy', 'No watermark, full commercial use'] : ['Credits never expire', 'Use them on any video or image', 'Added the moment you pay'];
  var money = function (v) { return v % 1 ? v.toFixed(2) : fmt(v); };
  // Each method has its own price (some include their processing cost); the total follows the chosen method.
  var base = amount, factorOf = function (id) { var x = d.methods.find(function (y) { return String(y.id) === String(id); }); return (x && x.price_factor) || 1; };
  var priceFor = function (id, b) { return Math.round((b === undefined ? base : b) * factorOf(id) * 100) / 100; };
  // Bachs payment cap: over max_usd (final total with its fee; naira counted back at the same rate) Bachs is disabled for
  // this amount, one plain line says why, and the other methods stay. The server refuses it too.
  var overCap = function (x, b) {
    if (!x || !(x.max_usd > 0)) return false;
    var t = priceFor(x.id, b), usd = t;
    if (x.local && x.local.currency === 'NGN' && x.local.rate > 0) usd = Math.round(Math.round(t * x.local.rate * 100) / 100 / x.local.rate * 100) / 100;
    return usd > x.max_usd + 1e-9;
  };
  var first = d.methods.find(function (x) { return !overCap(x); }) || d.methods[0], firstIdx = d.methods.indexOf(first);
  var capped = d.methods.find(function (x) { return x.max_usd > 0; });
  amount = priceFor(first.id);
  // Payment option card: "Crypto (Gatevoo: USDT, BTC)" → title Crypto, via Gatevoo, coin chips.
  var pmCard = function (x, i) {
    var mm = /^(.*?)\s*\((.*)\)\s*$/.exec(x.name || ''), title = mm ? mm[1] : x.name, inner = mm ? mm[2].split(':') : [], via = inner[0] ? inner[0].trim() : '', coins = inner[1] ? inner[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var kind = /gatevoo|nowpay|crypto|coin/i.test((x.adapter || '') + ' ' + x.name) ? 'crypto' : /stripe|paystack|flutter|card/i.test((x.adapter || '') + ' ' + x.name) ? 'card' : 'other';
    // Bachs: Nigeria pays in naira at the admin's rate; the amount is shown here, before leaving Vooads.
    if (x.local && x.local.currency === 'NGN' && x.local.rate > 0) return '<label class="pmeth co-m"><input type="radio" name="pm" value="' + x.id + '"' + (i !== firstIdx ? '' : ' checked') + '><span class="pm-ic">' + I('wallet', 18) + '</span><span><b>' + esc(title) + '</b><small>You pay <span data-ngn="' + x.id + '">₦' + fmt(Math.round(priceFor(x.id) * x.local.rate * 100) / 100) + '</span> (cards, bank transfer, USSD).</small></span><span class="pm-tick">' + I('check', 12, 3.2) + '</span></label>';
    var note = x.save_pct > 0 ? '<span class="pm-save">Pay with ' + (kind === 'crypto' ? 'crypto' : esc(title)) + ' and save ' + x.save_pct + '%</span>' : x.manual ? 'Pay from your bank, then upload the receipt. We confirm it quickly.' : x.recurring && isPlan ? 'Renews automatically. Cancel anytime.' : isPlan ? 'One payment for this ' + (yr ? 'year' : 'month') + '. We remind you before it ends.' : 'One-off payment';
    return '<label class="pmeth co-m"><input type="radio" name="pm" value="' + x.id + '"' + (i !== firstIdx ? '' : ' checked') + '><span class="pm-ic">' + ((window.VooStudioX && VooStudioX.payMark(x)) || (TN && TN.payMark ? TN.payMark(kind) : I('wallet', 18))) + '</span><span><b>' + esc(title) + '<span class="pm-chips">' + (via ? '<em class="v">' + esc(via) + '</em>' : '') + coins.map(function (c) { return '<em>' + esc(c) + '</em>'; }).join('') + '</span></b><small>' + note + '</small></span><span class="pm-tick">' + I('check', 12, 3.2) + '</span></label>';
  };
  var m = modal('<div class="mbd co"><div class="co-l"><div class="co-sum" id="coSum"><div class="co-top"><span class="co-plan"><i>' + I(isPlan ? 'spark' : 'plus', 12, 2.4) + '</i>' + esc(label) + '</span>' + (isPlan && item.popular ? '<span class="pill brand">Most popular</span>' : '') + '</div>' +
    '<div class="co-price"><span class="co-old" id="coOld" hidden>$' + fmt(amount) + '</span><span class="cur">$</span><span class="big" id="coAmt">' + fmt(amount) + '</span><span class="per">' + (isPlan ? (yr ? '/ year' : '/ month') : 'one-off') + '</span></div><span id="coDisc"></span>' +
    '<div class="co-mid"><ul class="co-inc">' + inc.map(function (t, i) { return '<li><span class="ic">' + T((isPlan ? ['ugc', 'script', 'shield'] : ['credits', 'ads', 'spark'])[i], 18) + '</span>' + esc(t) + '</li>'; }).join('') + '</ul><span class="co-stack">' + (TN && TN.payMark ? TN.payMark('crypto') : '') + '</span></div>' +
    '<div class="co-cred">' + COIN + '<span><b>' + credits + '</b></span></div></div>' +
    '<div class="co-who">' + I('headset', 18) + '<span>Questions? Ask in Support and the team replies there.</span></div></div>' +
    '<div class="co-r"><div class="fld"><span class="co-lbl">Pay with</span><div class="co-pm" id="coM">' + d.methods.map(pmCard).join('') + '</div>' + (capped ? '<p class="co-cap" id="coCap" role="status" hidden style="margin:8px 0 0;font-size:13px;opacity:.8">' + esc(capped.cap_note || 'Bachs takes up to $5,000 per payment. Pay in parts, or choose another method.') + '</p>' : '') + '</div>' +
    // Bachs card auto-renew: on by default for plans; off = one payment (bank transfer, mobile money, crypto stay one-off).
    (isPlan && d.methods.some(function (x) { return x.card_auto_renew; }) ? '<label class="co-ar" id="coAr" style="display:flex;gap:10px;align-items:flex-start;margin:4px 0 14px;cursor:pointer"><input type="checkbox" id="coArIn" checked style="margin-top:3px"><span><b>Renew automatically</b><small style="display:block;opacity:.75">Your card is charged each ' + (yr ? 'year' : 'month') + ' and we email you before every charge. Cancel in one click. Turn it off to pay once by bank transfer, mobile money or crypto.</small></span></label>' : '') +
    (isPlan && !yr ? '<div class="co-code"><label class="lbl" for="coCode">Discount code <small>optional</small></label><div class="co-crow"><span class="co-in"><input class="inp" id="coCode" placeholder="WELCOME30" autocomplete="off" style="text-transform:uppercase"><span class="tk">' + I('check', 12, 3.2) + '</span></span><button class="btn ghost" id="coApply">Apply</button></div><span class="co-msg" aria-live="polite"></span></div>' : '') +
    '<button class="btn arrow lg co-go" id="coGo" style="justify-content:space-between">Continue to secure checkout ' + ARR('lock') + '</button>' +
    '<div class="co-trust"><span>' + I('lock', 13, 2.4) + 'Secure checkout</span><span>' + I('check', 13, 2.6) + (isPlan && d.methods.some(function (x) { return x.recurring; }) ? 'Cancel anytime' : 'No hidden fees') + '</span></div>' +
    '<p class="co-terms">By paying you agree to the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/refunds" target="_blank">Refund Policy</a>. Accounts banned for misuse are not refunded.</p></div></div>', 'Checkout');
  $('.mbox', m).classList.add('co-box');
  // Price counts in, and glides to the discounted price.
  var shown = amount, tween = function (to, ms) {
    var el = $('#coAmt', m), from = shown; shown = to;
    if (!el || (TN && TN.reduce)) { if (el) el.textContent = money(to); return; }
    var t0 = performance.now(), dur = ms || 900;
    (function f(t) { var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e; el.textContent = k < 1 ? fmt(Math.round(v)) : money(to); if (k < 1 && el.isConnected) requestAnimationFrame(f); })(t0);
  };
  shown = 0; tween(amount, 1000);
  var disc = 0, pmId = function () { var r = $('input[name=pm]:checked', m); return r ? r.value : first.id; };
  var capSync = function () {
    if (!capped) return;
    var b = disc ? Math.round(base * (100 - disc)) / 100 : base, any = false;
    $$('input[name=pm]', m).forEach(function (r) {
      var x = d.methods.find(function (y) { return String(y.id) === r.value; }), over = overCap(x, b);
      if (over) any = true;
      r.disabled = over; r.closest('label').style.opacity = over ? '.5' : ''; r.closest('label').style.cursor = over ? 'not-allowed' : '';
      if (over && r.checked) r.checked = false;
    });
    if (!$('input[name=pm]:checked', m)) { var ok = $$('input[name=pm]', m).find(function (r) { return !r.disabled; }); if (ok) ok.checked = true; }
    $('#coCap', m).hidden = !any;
    $('#coGo', m).disabled = !$('input[name=pm]:checked', m);
  };
  var retotal = function () { capSync(); if (typeof arSync === 'function') arSync(); var b = disc ? Math.round(base * (100 - disc)) / 100 : base; tween(priceFor(pmId(), b), 450); $$('[data-ngn]', m).forEach(function (n) { var x = d.methods.find(function (y) { return String(y.id) === n.dataset.ngn; }); if (x && x.local) n.textContent = '₦' + fmt(Math.round(priceFor(x.id, b) * x.local.rate * 100) / 100); }); if ($('#coOld', m)) $('#coOld', m).textContent = '$' + money(priceFor(pmId())); };
  $$('input[name=pm]', m).forEach(function (r) { r.addEventListener('change', retotal); });
  var arSync = function () { var ar = $('#coAr', m); if (!ar) return; var x = d.methods.find(function (y) { return String(y.id) === String(pmId()); }); ar.style.display = x && x.card_auto_renew ? 'flex' : 'none'; };
  $$('input[name=pm]', m).forEach(function (r) { r.addEventListener('change', arSync); }); capSync(); arSync();
  var code = '', cw = $('.co-code', m), msg = $('.co-msg', m);
  var codeState = function (st, text) { if (!cw) return; cw.classList.remove('ok', 'bad'); void cw.offsetWidth; if (st) cw.classList.add(st); msg.textContent = text || ''; };
  if ($('#coApply', m)) $('#coApply', m).onclick = async function () {
    var c = $('#coCode', m).value.trim(); if (!c) { $('#coCode', m).focus(); return; }
    var bt = this; bt.disabled = true;
    try {
      var r = await api('POST', '/api/billing/discount', { code: c }); code = r.code; disc = r.percent;
      var now = priceFor(pmId(), Math.round(base * (100 - r.percent)) / 100);
      $('#coOld', m).hidden = false; $('#coOld', m).textContent = '$' + money(priceFor(pmId())); tween(now, 700);
      $('#coDisc', m).innerHTML = I('check', 12, 3) + esc(r.percent + '% off with ' + r.code + ' (first payment)');
      if (capped) { var was = pmId(); capSync(); if (pmId() !== was) { arSync(); now = priceFor(pmId(), Math.round(base * (100 - r.percent)) / 100); tween(now, 300); } }
      codeState('ok', 'Code applied. You save $' + money(Math.round((priceFor(pmId()) - now) * 100) / 100) + '.');
    } catch (e) {
      code = ''; disc = 0; $('#coOld', m).hidden = true; $('#coDisc', m).textContent = ''; retotal();
      codeState('bad', e.message || 'That code is not valid.');
    }
    bt.disabled = false;
  };
  if ($('#coCode', m)) $('#coCode', m).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#coApply', m).click(); } else if (cw.classList.contains('bad')) codeState('', ''); };
  $('#coGo', m).onclick = async function () {
    var bt = this; bt.disabled = true; bt.innerHTML = 'Opening checkout <span class="spinner"></span>';
    try {
      var r = await api('POST', '/api/billing/checkout', Object.assign({}, sel, { method_id: Number($('input[name=pm]:checked', m).value), code: code || undefined, auto_renew: $('#coArIn', m) ? $('#coArIn', m).checked : undefined }));
      // Paid on the spot (comes straight back to us): cheer first, then go.
      var back = /[?&]paid=/.test(r.url || '') && (!/^https?:/i.test(r.url) || r.url.indexOf(location.origin) === 0);
      if (back && TN && TN.cheer) {
        var co = $('.co', m); co.innerHTML = '<div class="co-ok">' + TN.cheer('maya') + '<span class="ml"><span class="dot-live ok"></span>Payment received</span><h3>You are in.</h3><p>' + esc(credits.replace(', added now', '')) + ' ' + (isPlan ? 'are yours. Your first ads are a tap away.' : 'are in your wallet.') + '</p></div>';
        TN.burst($('.co-ok', m), 36); setTimeout(function () { location.href = r.url; }, 1100);
      } else location.href = r.url;
    }
    catch (e) { toast(e.message, true); bt.disabled = false; bt.innerHTML = 'Continue to secure checkout ' + ARR('lock'); }
  };
}

/* ================= REFER ================= */
async function pRefer(el) {
  el.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  var d; try { d = await api('GET', '/api/referral'); } catch (e) { el.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; return; }
  if (route !== 'refer') return;
  var tiers = d.settings.tiers || [];
  el.innerHTML = '<div class="card dk"><span class="ml">refer & earn</span><h2 class="hx2" style="color:#fff">Share Vooads. <span class="g">Earn every month.</span></h2><p style="color:#A19E95">You get <b style="color:#fff">' + d.pct + '%</b> of what your referrals pay right now. Bring more paying buyers to earn up to <b style="color:#fff">' + (tiers.length ? tiers[tiers.length - 1].pct : 30) + '%</b>.</p></div>' +
    '<div class="card"><h2>Your link</h2><div class="copyrow"><input class="inp" readonly value="' + esc(d.link) + '" id="rl" style="font-family:var(--mono);font-size:14px"><button class="btn solid" id="rc">' + I('copy', 15) + ' Copy</button></div><div class="chips"><a class="chip" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('I make my UGC ads with Vooads, try it free: ' + d.link) + '">WhatsApp</a><a class="chip" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(d.link) + '&text=' + encodeURIComponent('Make UGC ads with AI') + '">Telegram</a><a class="chip" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=' + encodeURIComponent('I make 50+ ad creatives a week with Vooads ' + d.link) + '">X</a></div></div>' +
    '<div class="stats"><div class="stat"><small>signed up</small><b>' + fmt(d.referred) + '</b></div><div class="stat"><small>paying</small><b>' + fmt(d.paying) + '</b></div><div class="stat"><small>estimated earnings</small><b>$' + fmt(d.est_earned_usd) + '</b></div></div>' +
    '<div class="card"><h2>How it pays</h2><div class="g3">' + tiers.map(function (t) { return '<div class="stat" style="background:' + (d.pct === t.pct ? 'var(--brand-soft)' : '#fff') + '"><small>' + (t.min <= 1 ? 'from your first paying referral' : t.min + '+ paying referrals') + '</small><b>' + t.pct + '%</b></div>'; }).join('') + '</div><p class="muted" style="font-size:13.5px">Earnings settle after ' + (d.settings.settle_days || 30) + ' days. Minimum payout is $' + (d.settings.min_withdraw_usd || 300) + '. Contact support to withdraw. Self-referrals and fake accounts are not paid.</p></div>';
  $('#rc').onclick = function () { copy(d.link); };
}

/* ================= APPS ================= */
function pApps(el) {
  if (window.VooP2 && window.VooApps) return VooP2.apps(el);
  el.innerHTML = '<div class="card"><span class="ml">the voo family by zedapex</span><h2 class="hx2">Vooads makes the ad. <span class="g">These apps close the loop.</span></h2><p class="muted" style="font-size:14.5px">Track it, answer the chats it brings in and turn them into sales. One Voo ID opens all of them.</p></div><div style="display:grid;gap:16px">' + (window.VooApps ? VooApps.appsBlock() : '') + '</div>';
}

/* ================= SUPPORT ================= */
var TICKETS_API = true, lastSup = Number(store.get('va_sup') || 0);
async function pollSupport() {
  var b = $('#supB'); if (!b) return;
  try {
    if (TICKETS_API) { var d = await api('GET', '/api/tickets'); var un = d.tickets.reduce(function (s, t) { return s + (t.unread || 0); }, 0); b.hidden = !un || route === 'support'; b.textContent = un; return; }
  } catch (e) { if (e.status === 404) TICKETS_API = false; else return; }
  try { var o = await api('GET', '/api/support'); var staff = o.messages.filter(function (x) { return x.from_staff; }).length; b.hidden = !(staff > lastSup) || route === 'support'; b.textContent = staff - lastSup; if (route === 'support') { lastSup = staff; store.set('va_sup', staff); } } catch (e) {}
}
function agentIdx(name) { var h = 0; String(name || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) | 0; }); return Math.abs(h) % 3; }
function supHead() {
  return '<div class="suph"><div class="who"><span class="sup-ic">' + I('headset', 26) + '</span><div><span class="ml">Vooads support</span><h2 class="hx2" style="color:#fff;font-size:clamp(24px,3vw,34px)">Ask anything. <span class="g">The team answers here.</span></h2><span class="status">Open a ticket and you get an email when we reply.</span></div></div><div class="chips"><button class="btn arrow lt" id="newT">New ticket ' + ARR('plus') + '</button><button class="btn sm" style="background:#1A1917;color:#fff" id="callT">' + I('phone', 15) + ' Request a call</button></div></div>';
}
async function pSupport(el, r) {
  $('#supB') && ($('#supB').hidden = true);
  el.innerHTML = supHead() + '<div class="supg"><div class="card"><div class="ch"><h2>Your tickets</h2><span class="ml" id="tCount"></span></div><div class="tlist" id="tList"><div class="empty"><span class="spinner"></span></div></div></div><div class="card" id="tPane"></div></div>';
  $('#newT').onclick = function () { newTicket(null, true); };
  $('#callT').onclick = function () { newTicket('call', true); };
  $$('.suph .agents', el).forEach(function (a) { a.setAttribute('role', 'button'); a.setAttribute('tabindex', '0'); a.setAttribute('aria-label', 'Message the support team'); a.onclick = function () { newTicket(null, true); }; });
  var list;
  try { list = (await api('GET', '/api/tickets')).tickets; TICKETS_API = true; }
  catch (e) { if (e.status === 404) { TICKETS_API = false; return legacyChat(el); } list = []; toast(e.message, true); }
  if (route !== 'support') return;
  var paintList = function (activeId) {
    $('#tCount').textContent = list.length ? list.length + ' total' : '';
    $('#tList').innerHTML = list.length ? list.map(function (t) { return '<button class="trow' + (String(t.id) === String(activeId) ? ' on' : '') + '" data-id="' + t.id + '"><b>' + esc(t.subject || 'Ticket #' + t.id) + '</b>' + (t.unread ? '<span class="un">' + t.unread + ' new</span>' : '<span class="pill ' + (t.status === 'solved' || t.status === 'closed' ? 'good' : t.status === 'pending' ? 'warn' : 'plain') + '">' + esc(t.status) + '</span>') + '<small>#' + t.id + ' · ' + esc(t.category) + ' · ' + when(t.updated_at) + '</small></button>'; }).join('') : '<div class="empty">' + (TN ? TN.empty('tickets') : '') + '<b>No tickets yet</b><p>Ask anything. A person on the team answers, and you get instant help articles while you wait.</p></div>';
    $$('#tList .trow').forEach(function (b) { b.onclick = function () { go('#support/' + b.dataset.id); }; });
  };
  paintList(r && r.sub);
  if (r && r.sub && r.sub !== 'new') openTicket(r.sub, function () { var t = list.find(function (x) { return String(x.id) === r.sub; }); if (t) t.unread = 0; paintList(r.sub); });
  else newTicket(r && r.q.get('cat'));
}
function newTicket(cat, focus) {
  var pane = $('#tPane'); if (!pane) return;
  clearInterval(openTicket._iv);
  var c = cat || 'video';
  pane.innerHTML = '<div><span class="ml">new ticket</span><h2 style="margin-top:4px">How can we help?</h2></div>' +
    '<div class="fld"><span class="lbl">Topic</span><div class="cats" id="tCats">' + CATS.map(function (x) { return '<button class="chip' + (x[0] === c ? ' on' : '') + '" data-c="' + x[0] + '">' + (x[0] === 'call' ? I('phone', 13) : '') + x[1] + '</button>'; }).join('') + '</div></div>' +
    '<div class="fld"><label for="tSub">Subject</label><input class="inp" id="tSub" maxlength="140" placeholder="My 60s video is stuck on part 4"></div>' +
    '<div class="g2" id="tCall" style="gap:12px"' + (c === 'call' ? '' : ' hidden') + '><div class="fld"><label for="tPh">Phone <small>with country code</small></label><input class="inp" id="tPh" type="tel" placeholder="+234 801 234 5678"></div><div class="fld"><label for="tTm">Best time to call</label><input class="inp" id="tTm" maxlength="80" placeholder="Tomorrow 10:00–12:00 WAT"></div></div>' +
    '<div class="fld"><label for="tBody">Message</label><textarea class="inp" id="tBody" rows="5" maxlength="4000" placeholder="Tell us what happened. Job numbers or links help."></textarea></div>' +
    '<div class="ch"><span class="ml" style="display:inline-flex;align-items:center;gap:8px"><span class="dot-live ok"></span>Instant help articles arrive with your ticket</span><button class="btn arrow" id="tSend">Send ' + ARR('send') + '</button></div>';
  var cur = c;
  $$('#tCats .chip').forEach(function (b) { b.onclick = function () { cur = b.dataset.c; $$('#tCats .chip').forEach(function (x) { x.classList.toggle('on', x === b); }); $('#tCall').hidden = cur !== 'call'; if (cur === 'call' && !$('#tSub').value) $('#tSub').value = 'Please call me'; }; });
  if (c === 'call') $('#tSub').value = 'Please call me';
  // On phones the form sits below the header: bring it into view so the tap visibly does something.
  if (focus) { pane.scrollIntoView({ block: 'start', behavior: 'smooth' }); setTimeout(function () { var f = cur === 'call' ? $('#tPh') : $('#tBody'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 350); }
  $('#tSend').onclick = async function () {
    var body = $('#tBody').value.trim(), subj = $('#tSub').value.trim();
    if (!body && cur !== 'call') { $('#tBody').focus(); toast('Write a message first.', true); return; }
    if (cur === 'call' && !/^\+?[0-9 ()-]{6,30}$/.test($('#tPh').value.trim())) { $('#tPh').focus(); toast('Add a phone number with the country code, for example +234 801 234 5678.', true); return; }
    var bt = this; bt.disabled = true; bt.innerHTML = 'Sending <span class="spinner"></span>';
    try {
      var d = await api('POST', '/api/tickets', { subject: subj, body: body || 'Please call me.', category: cur, phone: cur === 'call' ? $('#tPh').value.trim() : undefined, call_time: cur === 'call' ? $('#tTm').value.trim() : undefined });
      toast(cur === 'call' ? 'Callback requested' : 'Ticket sent'); go('#support/' + d.ticket.id);
    } catch (e) { toast(e.message, true); bt.disabled = false; bt.innerHTML = 'Send ' + ARR('send'); }
  };
}
function msgHTML(m) {
  var t = m.author_type;
  if (t === 'system') return '<div class="tm sys"><span class="bub">' + esc(m.body) + ' · ' + when(m.created_at) + '</span></div>';
  var me = t === 'customer', bot = t === 'bot';
  var av = me ? '' : bot ? '<span class="botav"><i class="eye"><b></b></i><i class="eye"><b></b></i></span>' : VooUI.agent(agentIdx(m.author_name), 32);
  var arts = (m.attachments || []).filter(function (a) { return a && a.type === 'article' && a.title; });
  var body = bot && arts.length ? String(m.body || '').split('\n\nWhile you wait')[0] : m.body;
  return '<div class="tm' + (me ? ' me' : bot ? ' bot' : '') + '">' + av + '<div class="bub"><span class="who">' + (me ? 'You' : bot ? 'Vooads assistant · instant' : esc(m.author_name || 'Vooads support')) + ' · ' + when(m.created_at) + '</span>' + esc(body) +
    (arts.length ? '<div class="arts">' + arts.map(function (a) { return '<a href="' + esc(a.url || '#learn') + '" data-art="' + esc(a.url || '') + '">' + I(a.kind === 'lesson' ? 'play' : 'learn', 16) + '<span>' + esc(a.title) + '<small>' + esc(a.summary || '') + '</small></span></a>'; }).join('') + '</div>' : '') + '</div></div>';
}
async function openTicket(id, onSeen) {
  var pane = $('#tPane'); if (!pane) return;
  // Refreshes (new replies arriving) keep what the customer is typing.
  var prevIn = $('#tMsg', pane), draft = prevIn ? prevIn.value : '', hadFocus = !!prevIn && document.activeElement === prevIn;
  if (!prevIn) pane.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  var d; try { d = await api('GET', '/api/tickets/' + encodeURIComponent(id)); } catch (e) { pane.innerHTML = '<div class="empty"><b>' + esc(e.message) + '</b><a class="btn ghost" href="#support">Back</a></div>'; return; }
  if (!document.body.contains(pane) || route !== 'support') return;
  if (onSeen) onSeen(); pollSupport();
  var t = d.ticket, closed = t.status === 'closed';
  var waiting = !d.messages.some(function (m) { return m.author_type === 'staff' || m.author_type === 'voosquare'; });
  pane.innerHTML = '<div class="ch"><div style="min-width:0"><span class="ml">#' + t.id + ' · ' + esc(t.category) + (t.phone ? ' · callback ' + esc(t.phone) + (t.call_time ? ' · ' + esc(t.call_time) : '') : '') + '</span><h2 style="margin-top:4px">' + esc(t.subject) + '</h2></div><div class="chips"><span class="pill ' + (t.status === 'solved' || closed ? 'good' : 'plain') + '">' + esc(t.status) + '</span>' + (closed ? '' : '<button class="cbtn" id="tClose">' + I('check', 13) + 'Close</button>') + '</div></div>' +
    '<div class="thread" id="thr">' + d.messages.map(msgHTML).join('') + (waiting && !closed ? '<div class="tm">' + VooUI.agentsStack(26) + '<div class="bub" style="background:none;padding:4px"><span class="status" style="color:var(--mut)"><span class="dot-live ok"></span>A person from the team will reply here <span class="typing"><i style="background:var(--mut)"></i><i style="background:var(--mut)"></i><i style="background:var(--mut)"></i></span></span></div></div>' : '') + '</div>' +
    (closed ? '<p class="ml">This ticket is closed. Open a new one any time.</p>' : '<form class="cform" id="tRep"><label for="tMsg" class="sr">Reply</label><textarea class="inp" id="tMsg" rows="1" placeholder="Write a reply…"></textarea><button class="btn solid" aria-label="Send">' + I('send', 16) + '</button></form>');
  var thr = $('#thr'); thr.scrollTop = thr.scrollHeight;
  if ($('#tMsg') && draft) $('#tMsg').value = draft;
  if ($('#tMsg') && hadFocus) try { $('#tMsg').focus({ preventScroll: true }); } catch (e) {}
  $$('[data-art]', pane).forEach(function (a) { a.onclick = function (e) { var u = a.dataset.art, m = /#learn\/(.+)$/.exec(u); if (m) { e.preventDefault(); VooTrainer.open({ id: decodeURIComponent(m[1]) }); } }; });
  if ($('#tClose')) $('#tClose').onclick = async function () { try { await api('POST', '/api/tickets/' + t.id + '/close'); toast('Ticket closed'); onRoute(); } catch (e) { toast(e.message, true); } };
  if ($('#tRep')) {
    var inp = $('#tMsg');
    var sending = false, sendReply = async function () {
      var v = inp.value.trim(); if (!v || sending) return;
      sending = true; inp.value = ''; var sb = $('#tRep button'); if (sb) sb.disabled = true;
      try { await api('POST', '/api/tickets/' + t.id + '/messages', { body: v }); openTicket(t.id); } catch (er) { toast(er.message, true); inp.value = v; if (sb) sb.disabled = false; }
      sending = false;
    };
    // Enter sends on a keyboard; on phones Return adds a new line and the send button sends.
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) { e.preventDefault(); sendReply(); } });
    $('#tRep').onsubmit = function (e) { e.preventDefault(); sendReply(); };
  }
  clearInterval(openTicket._iv);
  openTicket._iv = setInterval(async function () { if (route !== 'support' || sub !== String(id)) return clearInterval(openTicket._iv); try { var n = await api('GET', '/api/tickets/' + t.id); if (n.messages.length !== d.messages.length) openTicket(t.id); } catch (e) {} }, 10000);
}
async function legacyChat(el) {
  el.innerHTML = supHead() + '<div class="card"><div class="thread" id="thr"></div><form class="cform" id="cf"><label for="cin" class="sr">Message</label><textarea class="inp" id="cin" rows="1" placeholder="Type your question…"></textarea><button class="btn solid">' + I('send', 16) + '</button></form></div>';
  $('#newT').onclick = function () { $('#cin').focus(); }; $('#callT').onclick = function () { $('#cin').value = 'Please call me on: '; $('#cin').focus(); };
  var paint = async function () { try { var d = await api('GET', '/api/support'); if (route !== 'support') return; $('#thr').innerHTML = '<div class="tm bot"><span class="botav"><i class="eye"><b></b></i><i class="eye"><b></b></i></span><div class="bub">Hi' + (ME.name ? ' ' + esc(ME.name) : '') + '. Ask us anything about Vooads. We reply here and by email.</div></div>' + d.messages.map(function (m) { return msgHTML({ author_type: m.from_staff ? 'staff' : 'customer', author_name: m.author_name || 'Vooads support', body: m.body, created_at: m.created_at }); }).join(''); $('#thr').scrollTop = 1e6; } catch (e) {} };
  paint(); var iv = setInterval(function () { if (route !== 'support') return clearInterval(iv); paint(); }, 8000);
  $('#cf').onsubmit = async function (e) { e.preventDefault(); var v = $('#cin').value.trim(); if (!v) return; $('#cin').value = ''; try { await api('POST', '/api/support', { body: v }); paint(); } catch (er) { toast(er.message, true); $('#cin').value = v; } };
}

/* ================= SETTINGS ================= */
function pSettings(el) {
  var br = ME.brand || {};
  el.innerHTML = '<div class="g2"><div class="card" id="brandCard"><h2>Your brand</h2><p class="muted" style="font-size:14px">Used to write hooks and scripts that sound like you.</p><div class="fld"><label for="sBn">Brand name</label><input class="inp" id="sBn" maxlength="40" value="' + esc(br.name || '') + '" placeholder="Glowlab"></div><div class="fld"><label for="sBni">Niche</label><select class="inp" id="sBni"><option value="">Choose…</option>' + NICHES.map(function (n) { return '<option value="' + n[0] + '"' + (br.niche === n[0] ? ' selected' : '') + '>' + n[1] + '</option>'; }).join('') + '</select></div><div class="fld"><label for="sBc">Brand colour</label><input class="inp" id="sBc" type="color" value="' + esc(br.color || '#FF4A1C') + '" style="height:52px;padding:6px"></div><button class="btn solid" id="sBs" style="justify-self:start">Save brand</button></div>' +
    '<div class="card"><h2>Account</h2><div class="fld"><label for="sNm">Name</label><input class="inp" id="sNm" maxlength="60" value="' + esc(ME.name || '') + '"></div><div class="fld"><label for="sCt">Country</label><select class="inp" id="sCt">' + COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (ME.country === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></div><div class="fld"><span class="lbl">Email</span><input class="inp" value="' + esc(ME.email) + '" disabled></div>' +
    '<label class="sw"><input type="checkbox" id="sMk"' + (ME.marketing_opt_in ? ' checked' : '') + '><span class="k"></span><span>Send me tips and offers</span></label>' +
    '<label class="sw"><input type="checkbox" id="sFl"' + ((ME.onboarding || {}).hide_flow ? '' : ' checked') + '><span class="k"></span><span>Show the live guide on Home</span></label>' +
    '<div class="chips"><button class="btn solid" id="sAs">Save</button><button class="btn ghost" id="sLo">' + I('logout', 15) + ' Log out</button></div></div></div>' +
    (VOO().enabled ? '<div class="card" id="vooCard"><h2>VooSquare</h2>' + (ME.voo_id ? '<p class="muted">Connected. One Voo account opens Vooads and every other Voo app.</p><a class="btn ghost" href="' + esc(VOO().apps_url || '#') + '" rel="noopener">Open VooSquare</a>' : '<p class="muted">Connect your Voo account to open Vooads from VooSquare without logging in again.</p><button class="btn blue" id="sVoo">Connect VooSquare</button>') + '</div>' : '') +
    '<div class="card" id="sessCard"><h2>Devices</h2><p class="muted" style="font-size:14.5px" id="sessTxt">Lost a phone or used a shared computer? Sign out everywhere. You can log back in with a code we email you.</p><button class="btn ghost" id="sLoAll" style="justify-self:start">' + I('logout', 15) + ' Sign out of all devices</button></div>' +
    '<div class="card"><h2>Rules</h2><p class="muted" style="font-size:14.5px">Don’t use Vooads for scams, anything illegal, fake reviews or pretending to be a real person or brand. We ban accounts for misuse, and banned accounts lose their credits with no refund. Read the <a href="/legal/acceptable-use" target="_blank">Acceptable Use Policy</a> and <a href="/legal/terms" target="_blank">Terms</a>.</p></div>';
  $('#sBs').onclick = async function () { try { var d = await api('PUT', '/api/me', { brand: { name: $('#sBn').value, niche: $('#sBni').value, color: $('#sBc').value }, onboarding: { brand: true } }); ME = d.user; toast('Brand saved'); } catch (e) { toast(e.message, true); } };
  $('#sAs').onclick = async function () { try { var d = await api('PUT', '/api/me', { name: $('#sNm').value, country: $('#sCt').value === 'ZZ' ? '' : $('#sCt').value, marketing_opt_in: $('#sMk').checked, onboarding: { hide_flow: !$('#sFl').checked } }); ME = d.user; paintWallet(); toast('Saved'); } catch (e) { toast(e.message, true); } };
  $('#sLo').onclick = async function () { if (ME.voo_id && VOO().enabled) { location.href = '/auth/voosquare/logout'; return; } await api('POST', '/api/auth/logout').catch(function () {}); location.href = '/'; };
  if ($('#sVoo')) $('#sVoo').onclick = async function () { try { var d = await api('POST', '/api/auth/voosquare/link', {}); location.href = d.url; } catch (e) { toast(e.message, true); } };
  api('GET', '/api/auth/sessions').then(function (d) { if (d.count > 1 && $('#sessTxt')) $('#sessTxt').textContent = 'You are signed in on ' + d.count + ' devices or browsers. Lost a phone or used a shared computer? Sign out everywhere, then log back in with a code we email you.'; }).catch(function () {});
  $('#sLoAll').onclick = async function () {
    if (!confirm('Sign out of Vooads on every device, including this one?')) return;
    try { await api('POST', '/api/auth/logout-all'); toast('Signed out everywhere'); setTimeout(function () { location.href = '/'; }, 600); } catch (e) { toast(e.message, true); }
  };
}
// Bridge for voo-phase2.js (chat editing, actors, hook grid, learn): the studio helpers it needs, nothing else.
window.VA_STUDIO = { api: api, toast: toast, modal: modal, I: I, startDraft: startDraft, refreshMe: refreshMe, openJob: openJob,
  get B() { return B; }, get CFG() { return CFG; }, get JOBS() { return JOBS; }, get VooTrainer() { return window.VooTrainer; } };
})();
