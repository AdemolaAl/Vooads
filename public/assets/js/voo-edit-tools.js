/* Vooads studio: the editing tools in Create (SPEC §14).
   Change background (bg_swap) and Auto-edit my video (auto_edit) work on the customer's own upload; Brand music (brand_music)
   makes a track saved to "My brand tracks". app.html calls these hooks from paintBase / paintOpts / jobReq / the job viewer.
   Uploads go straight to /api/uploads/video with a progress bar; the server checks the file again (bytes, length, plan). */
(function () {
  'use strict';
  var PIPES = ['bg_swap', 'auto_edit', 'brand_music'];
  var LIMITS = { bg_swap: { secs: 120, mb: 200 }, auto_edit: { secs: 300, mb: 500 } };
  var EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
  var BG = [['color', 'Colour', 'A clean solid colour'], ['image', 'Picture', 'Your own photo'], ['ai', 'AI scene', 'Describe it, AI makes it'], ['stock', 'Stock video', 'A moving background']];
  var SWATCH = ['#FF4A1C', '#0B0B0A', '#F7F6F2', '#2F6BFF', '#FF3EA5', '#1DB954', '#C8A24A', '#6B6860'];
  var AI_IDEAS = ['Bright modern kitchen', 'Luxury hotel lobby', 'Sunny beach at golden hour', 'Neon city street at night', 'Minimal white studio'];
  var STOCK_IDEAS = ['city skyline', 'ocean waves', 'cozy cafe', 'modern office', 'abstract gradient'];
  var CAPS = [['bold', 'Bold pop', 'Big, bold words that pop'], ['clean', 'Clean', 'Calm sentence case'], ['boxed', 'Boxed', 'Words on a dark box']];
  var GENRES = ['Afrobeats', 'Amapiano', 'Pop', 'Lo-fi', 'Hip-hop', 'Cinematic', 'Corporate', 'Rock'];
  var LENGTHS = [15, 30, 60, 120];
  var tracks = [], tracksLoaded = false;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var clock = function (s) { s = Math.round(Number(s) || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  var mb = function (b) { return (Number(b || 0) / 1e6).toFixed(b > 1e7 ? 0 : 1) + ' MB'; };
  var I = function (n, s, w) { return window.VooUI ? VooUI.icon(n, s, w) : ''; };
  var TI = function (n, s) { return window.VooToolIcons ? VooToolIcons.svg(n, s) : ''; };

  function is(t) { return !!(t && PIPES.indexOf(t.pipeline) >= 0); }
  function upOf(B, t) { B.uploads = B.uploads || {}; return t ? B.uploads[t.pipeline] || null : null; }
  function limits(t) { var u = t && t.upload; var d = LIMITS[t && t.pipeline] || LIMITS.bg_swap; return { secs: (u && u.max_seconds) || d.secs, mb: (u && u.max_mb) || d.mb }; }
  // Defaults when the customer opens a tool (kept when they come back to it).
  function draft(t, B, ME) {
    if (!is(t)) return;
    var brand = (ME && ME.brand) || {};
    if (B._toolInit !== t.pipeline) {
      B._toolInit = t.pipeline;
      if (t.pipeline === 'bg_swap' && ['original', '9:16', '4:5', '1:1', '16:9'].indexOf(B.aspect) < 0) B.aspect = 'original';
      if (t.pipeline === 'bg_swap' && B._fromOther) B.aspect = 'original';
      if (t.pipeline === 'auto_edit' && ['9:16', '4:5', '1:1'].indexOf(B.aspect) < 0) B.aspect = '9:16';
    }
    if (B.bg_kind == null) B.bg_kind = 'color';
    if (!B.bg_color) B.bg_color = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#FF4A1C';
    if (B.bg_prompt == null) B.bg_prompt = '';
    if (B.bg_query == null) B.bg_query = '';
    if (B.caption_style == null) B.caption_style = 'bold';
    if (B.remove_silences == null) B.remove_silences = true;
    if (B.hook_first == null) B.hook_first = true;
    if (B.captions_on == null) B.captions_on = true;
    if (B.end_card == null) B.end_card = false;
    if (B.vocals == null) B.vocals = false;
    if (B.brand_name == null) B.brand_name = brand.name || '';
    if (B.lyrics == null) B.lyrics = '';
    if (B.genre == null) B.genre = '';
    if (B.tempo == null) B.tempo = 'medium';
    if (B.mlen == null) B.mlen = 30;
  }

  // ---------- Step 2: the upload (or the brand for Brand music) ----------
  function base(t, B) {
    if (t.pipeline === 'brand_music') {
      return '<div><h3>Your brand</h3><p class="sub">Tell us what the music is for. One clear line works best.</p></div>' +
        '<div class="g2" style="gap:12px"><div class="fld"><label for="bmName">Brand name <small>sung in a jingle</small></label><input class="inp" id="bmName" maxlength="40" placeholder="Glowlab" value="' + esc(B.brand_name) + '"></div>' +
        '<div class="fld"><label for="bProd">What is it for?</label><input class="inp" id="bProd" maxlength="300" placeholder="Launch of our vitamin C serum, fresh and confident" value="' + esc(B.product) + '"></div></div>';
    }
    var L = limits(t), up = upOf(B, t);
    var title = t.pipeline === 'bg_swap' ? 'Your video' : 'Your raw video';
    var sub = t.pipeline === 'bg_swap' ? 'One person, filmed in good light, works best. Your sound and timing stay exactly the same.' : 'Talk to the camera like you normally would. Mistakes, pauses and retakes are fine: we cut them.';
    return '<div><h3>' + title + '</h3><p class="sub">' + sub + '</p></div>' + dropzone(t, up, L);
  }
  function dropzone(t, up, L) {
    if (up && up.state === 'uploading') {
      var pct = Math.round((up.loaded / Math.max(1, up.total)) * 100);
      return '<div class="vup busy" id="vup" aria-live="polite"><div class="vup-ring" style="--p:' + pct + '"><b>' + pct + '%</b></div><div class="vup-tx"><b>Uploading ' + esc(up.name) + '</b><small>' + mb(up.loaded) + ' of ' + mb(up.total) + '</small><div class="vup-bar"><i style="width:' + pct + '%"></i></div></div><button class="cbtn" id="vupX" type="button">' + I('x', 13) + 'Cancel</button></div>';
    }
    if (up && up.id) {
      return '<div class="vup done" id="vup"><div class="vup-pv"><video src="' + esc(up.preview_url) + '#t=0.3" muted playsinline loop preload="metadata" aria-label="Your uploaded video"></video><span class="vup-ok">' + I('check', 14, 3) + '</span></div>' +
        '<div class="vup-tx"><b>' + esc(up.name || 'Your video') + '</b><small>' + clock(up.duration) + (up.width ? ' · ' + up.width + '×' + up.height : '') + (up.fps ? ' · ' + Math.round(up.fps) + ' fps' : '') + (up.has_audio ? '' : ' · no sound') + '</small>' +
        '<span class="vup-meta">' + I('lock', 11, 2.4) + 'Private. Deleted after 7 days.</span></div>' +
        '<label class="cbtn vup-re">' + I('upload', 13) + 'Replace<input type="file" id="vupF" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" hidden></label></div>';
    }
    return '<label class="vup empty" id="vup"><input type="file" id="vupF" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" hidden>' +
      '<span class="vup-art" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="8" y="14" width="40" height="36" rx="8" fill="#0B0B0A"/><path d="M48 26l10-6v24l-10-6z" fill="#0B0B0A"/><circle cx="17" cy="23" r="3" fill="#FF4A1C" class="vup-rec"/><g class="vup-up"><circle cx="40" cy="40" r="13" fill="#FF4A1C"/><path d="M40 46V34M35 38.5l5-5 5 5" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg></span>' +
      '<span class="vup-tx"><b>Tap to upload a video</b><small class="hide-sm">or drop it here</small><span class="vup-chips"><em>MP4 · MOV · WebM</em><em>up to ' + (L.secs >= 120 ? L.secs / 60 + ' min' : L.secs + 's') + '</em><em>' + L.mb + ' MB</em></span></span></label>' +
      (up && up.error ? '<p class="vup-err" role="alert">' + I('x', 13, 2.6) + esc(up.error) + '</p>' : '');
  }

  // Quick checks in the browser (the server checks again): type, size and length.
  function localDuration(file) {
    return new Promise(function (res) {
      try {
        var v = document.createElement('video'), url = URL.createObjectURL(file), done = function (d) { URL.revokeObjectURL(url); res(d); };
        v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = function () { done(isFinite(v.duration) ? v.duration : null); };
        v.onerror = function () { done(null); };
        setTimeout(function () { done(null); }, 4000);
        v.src = url;
      } catch (e) { res(null); }
    });
  }
  var xhr = null;
  async function pick(file, t, B, ctx) {
    if (!file) return;
    var L = limits(t), ext = String(file.name.split('.').pop() || '').toLowerCase();
    var type = /^video\/(mp4|quicktime|webm)$/.test(file.type) ? file.type : EXT[ext];
    var fail = function (msg) { B.uploads[t.pipeline] = { error: msg }; ctx.repaintBase(); ctx.toast(msg, true); };
    B.uploads = B.uploads || {};
    if (!type) return fail('Upload an MP4, MOV or WebM video.');
    if (file.size > L.mb * 1e6) return fail('That file is ' + mb(file.size) + '. The limit is ' + L.mb + ' MB.');
    var d = await localDuration(file);
    if (d && d > L.secs + 0.5) return fail('That video is ' + clock(d) + ' long. ' + t.name + ' takes up to ' + clock(L.secs) + '.');
    var st = { state: 'uploading', name: file.name, loaded: 0, total: file.size };
    B.uploads[t.pipeline] = st; ctx.repaintBase(); ctx.summary();
    if (window.VOOADS_DEMO) { // the click-through demo answers fetch() in the browser (no XHR, no real upload)
      st.loaded = file.size;
      fetch('/api/uploads/video?for=' + t.pipeline + '&name=' + encodeURIComponent(file.name.slice(0, 120)), { method: 'POST', headers: { 'Content-Type': type }, body: file }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); }).then(function (x) {
        if (x.ok && x.d.upload) { B.uploads[t.pipeline] = x.d.upload; B.duration = Math.ceil(x.d.upload.duration); ctx.toast('Video uploaded'); }
        else { B.uploads[t.pipeline] = { error: x.d.error || 'Upload failed. Try again.' }; if (x.status === 402) ctx.upsell(x.d.error, t.name); else ctx.toast(x.d.error || 'Upload failed', true); }
        ctx.repaintBase(); ctx.stepState(); ctx.quote();
      });
      return;
    }
    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads/video?for=' + t.pipeline + '&name=' + encodeURIComponent(file.name.slice(0, 120)));
    xhr.setRequestHeader('Content-Type', type);
    var last = 0;
    xhr.upload.onprogress = function (e) { if (!e.lengthComputable) return; st.loaded = e.loaded; st.total = e.total; var now = Date.now(); if (now - last > 120) { last = now; var r = $('#vup .vup-ring'); if (r) { var p = Math.round(e.loaded / e.total * 100); r.style.setProperty('--p', p); r.querySelector('b').textContent = p + '%'; $('#vup .vup-bar i').style.width = p + '%'; $('#vup small').textContent = mb(e.loaded) + ' of ' + mb(e.total); } } };
    xhr.onload = function () {
      var data = {}; try { data = JSON.parse(xhr.responseText); } catch (e) {}
      xhr = null;
      if (this.status >= 200 && this.status < 300 && data.upload) { B.uploads[t.pipeline] = data.upload; ctx.toast('Video uploaded'); if (t.pipeline === 'bg_swap' || t.pipeline === 'auto_edit') B.duration = Math.ceil(data.upload.duration); }
      else { B.uploads[t.pipeline] = { error: data.error || 'Upload failed. Try again.' }; if (this.status === 402) ctx.upsell(data.error, t.name); else ctx.toast(data.error || 'Upload failed', true); }
      ctx.repaintBase(); ctx.stepState(); ctx.quote();
    };
    xhr.onerror = function () { xhr = null; B.uploads[t.pipeline] = { error: 'The connection dropped. Try again.' }; ctx.repaintBase(); ctx.summary(); };
    xhr.send(file);
  }

  function wireBase(root, t, B, ctx) {
    if (t.pipeline === 'brand_music') {
      var n = $('#bmName', root), p = $('#bProd', root);
      if (n) n.oninput = function () { B.brand_name = this.value; ctx.summary(); };
      if (p) p.oninput = function () { B.product = this.value; ctx.stepState(); ctx.summary(); };
      return;
    }
    var f = $('#vupF', root);
    if (f) f.onchange = function () { pick(this.files[0], t, B, ctx); this.value = ''; };
    var x = $('#vupX', root);
    if (x) x.onclick = function () { if (xhr) xhr.abort(); xhr = null; B.uploads[t.pipeline] = null; ctx.repaintBase(); ctx.summary(); };
    var z = $('#vup.empty', root);
    if (z) {
      ['dragenter', 'dragover'].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { z.addEventListener(ev, function (e) { e.preventDefault(); z.classList.remove('over'); }); });
      z.addEventListener('drop', function (e) { var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (file) pick(file, t, B, ctx); });
    }
    var v = $('#vup video', root);
    if (v) { v.onmouseenter = function () { v.play().catch(function () {}); }; v.onmouseleave = function () { v.pause(); }; }
  }

  // ---------- Step 3: options ----------
  function shapeChips(list, B) {
    var names = { original: 'Keep original', '9:16': '9:16 Reels/TikTok', '4:5': '4:5 Feed', '1:1': '1:1 Square', '16:9': '16:9 YouTube' };
    return '<div class="fld"><span class="lbl">Shape</span><div class="chips">' + list.map(function (a) { return '<button class="chip' + (B.aspect === a ? ' on' : '') + '" data-a="' + a + '">' + names[a] + '</button>'; }).join('') + '</div></div>';
  }
  var BG_ART = {
    color: '<svg viewBox="0 0 40 28"><rect width="40" height="28" rx="6" fill="var(--sw,#FF4A1C)"/><circle cx="20" cy="12" r="5" fill="#fff" opacity=".9"/><path d="M11 28c1-7 5-9 9-9s8 2 9 9z" fill="#fff" opacity=".9"/></svg>',
    image: '<svg viewBox="0 0 40 28"><rect width="40" height="28" rx="6" fill="#BDE7FF"/><circle cx="31" cy="8" r="4" fill="#FFD25C"/><path d="M0 22l12-10 9 8 7-5 12 9v4H0z" fill="#3FA9F5"/><circle cx="20" cy="12" r="5" fill="#0B0B0A"/><path d="M11 28c1-7 5-9 9-9s8 2 9 9z" fill="#0B0B0A"/></svg>',
    ai: '<svg viewBox="0 0 40 28"><rect width="40" height="28" rx="6" fill="#FFEDE6"/><rect x="4" y="5" width="14" height="12" rx="2" fill="#FFB59E"/><path class="bgt-tw" d="M31 4l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#FF4A1C"/><circle cx="20" cy="12" r="5" fill="#0B0B0A"/><path d="M11 28c1-7 5-9 9-9s8 2 9 9z" fill="#0B0B0A"/></svg>',
    stock: '<svg viewBox="0 0 40 28"><rect width="40" height="28" rx="6" fill="#0B0B0A"/><path class="bgt-wave" d="M-10 20q7-5 14 0t14 0 14 0 14 0 14 0" stroke="#FF4A1C" stroke-width="3" fill="none"/><circle cx="20" cy="12" r="5" fill="#fff"/><path d="M11 28c1-7 5-9 9-9s8 2 9 9z" fill="#fff"/></svg>',
  };
  function opts(t, B, ctx) {
    var h = '';
    if (t.pipeline === 'bg_swap') {
      var ex = (t.extras && t.extras.ai_background) || 4;
      h = '<div><h3>New background</h3><p class="sub">We cut you out with AI and put you on the background you pick.</p></div>' +
        '<div class="bgt" role="radiogroup" aria-label="Background">' + BG.map(function (b) { var on = B.bg_kind === b[0]; return '<button type="button" class="bgt-c' + (on ? ' on' : '') + '" data-bgk="' + b[0] + '" role="radio" aria-checked="' + on + '" style="--sw:' + esc(B.bg_color) + '"><span class="bgt-a">' + BG_ART[b[0]] + '</span><b>' + b[1] + '</b><small>' + (b[0] === 'ai' ? '+' + ex + ' credits' : b[2]) + '</small></button>'; }).join('') + '</div>';
      if (B.bg_kind === 'color') h += '<div class="fld"><label for="bgCol">Colour</label><div class="colrow"><input type="color" id="bgCol" value="' + esc(B.bg_color) + '" aria-label="Background colour"><input class="inp" id="bgColT" maxlength="7" value="' + esc(B.bg_color) + '" aria-label="Colour code"><div class="sws">' + SWATCH.map(function (c) { return '<button type="button" class="swt' + (c.toLowerCase() === String(B.bg_color).toLowerCase() ? ' on' : '') + '" data-swt="' + c + '" style="--c:' + c + '" aria-label="' + c + '"></button>'; }).join('') + '</div></div></div>';
      if (B.bg_kind === 'image') h += '<label class="upl"><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="bgImg">' + (B.bg_image_prev ? '<img src="' + esc(B.bg_image_prev) + '" alt="">' : '<span class="ph">' + I('upload', 22) + '</span>') + '<div><b style="font-size:14.5px">' + (B.bg_image_prev ? 'Background picture added' : 'Add your background picture') + '</b><small class="muted" style="display:block;font-size:12.5px">PNG, JPG or WebP under 8 MB. It fills the frame behind you.</small></div></label>';
      if (B.bg_kind === 'ai') h += '<div class="fld"><label for="bgP">Describe the scene</label><textarea class="inp" id="bgP" rows="2" maxlength="400" placeholder="A bright modern kitchen with plants, morning light">' + esc(B.bg_prompt) + '</textarea><div class="chips">' + AI_IDEAS.map(function (x) { return '<button type="button" class="chip sm" data-bgidea="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>';
      if (B.bg_kind === 'stock') h += '<div class="fld"><label for="bgQ">What should move behind you?</label><input class="inp" id="bgQ" maxlength="100" placeholder="city skyline" value="' + esc(B.bg_query) + '"><div class="chips">' + STOCK_IDEAS.map(function (x) { return '<button type="button" class="chip sm" data-bgq="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>';
      h += shapeChips(['original', '9:16', '4:5', '1:1', '16:9'], B);
    } else if (t.pipeline === 'auto_edit') {
      h = '<div><h3>How should we edit it?</h3><p class="sub">We transcribe every word, cut what slows it down and finish it for the feed.</p></div>' +
        toggle('aeSil', B.remove_silences, 'Cut silences and filler words', 'Pauses over 0.6s, "um", "uh" and repeated takes go.') +
        toggle('aeHook', B.hook_first, 'Put your best line first', 'AI picks the strongest line and opens the video with it.') +
        toggle('aeCap', B.captions_on, 'Animated captions', 'Word by word, the word being said lights up in your brand colour.') +
        (B.captions_on ? '<div class="capt" role="radiogroup" aria-label="Caption style">' + CAPS.map(function (c) { var on = B.caption_style === c[0]; return '<button type="button" class="capt-c capt-' + c[0] + (on ? ' on' : '') + '" data-cap="' + c[0] + '" role="radio" aria-checked="' + on + '" style="--bc:' + esc(B.brand_color || '#FF4A1C') + '"><span class="capt-pv"><span class="capt-l">' + (c[0] === 'bold' ? 'THIS <i>WORKS</i>' : c[0] === 'clean' ? 'This <i>works</i>' : '<span>This <i>works</i></span>') + '</span></span><b>' + c[1] + '</b><small>' + c[2] + '</small></button>'; }).join('') + '</div>' : '') +
        '<div class="g2" style="gap:12px"><div class="fld"><label for="bCol">Brand colour</label><div class="colrow"><input type="color" id="bCol" value="' + esc(B.brand_color) + '" aria-label="Brand colour"><input class="inp" id="bColT" maxlength="7" value="' + esc(B.brand_color) + '" aria-label="Colour code"></div></div>' + shapeChips(['9:16', '4:5', '1:1'], B) + '</div>' +
        toggle('aeEnd', B.end_card, 'End card with your logo', 'A 2.5 second closing card with your call to action.') +
        (B.end_card ? '<div class="g2" style="gap:12px"><div class="fld"><label for="bCta">Call to action <small>up to 30 characters</small></label><input class="inp" id="bCta" maxlength="30" placeholder="Shop now · 20% off today" value="' + esc(B.cta) + '"></div>' + ctx.uploadBlock(false, 'upLogo', B.logo_prev, 'Add your logo', 'Logo added', 'Optional. PNG with a clear background looks best.') + '</div>' : '');
    } else if (t.pipeline === 'brand_music') {
      var maxS = ctx.maxSecs(t) || 60;
      h = '<div><h3>Sound and length</h3><p class="sub">An original track for your brand. Saved to My brand tracks and free to reuse in every video.</p></div>' +
        '<div class="vox" role="radiogroup" aria-label="Vocals">' +
          '<button type="button" class="vox-c' + (!B.vocals ? ' on' : '') + '" data-vox="0" role="radio" aria-checked="' + !B.vocals + '"><span class="vox-a">' + TI('music', 22) + '</span><b>Instrumental</b><small>Background music, no singing</small></button>' +
          '<button type="button" class="vox-c' + (B.vocals ? ' on' : '') + '" data-vox="1" role="radio" aria-checked="' + !!B.vocals + '"><span class="vox-a">' + TI('mic', 22) + '</span><b>Jingle</b><small>A singer sings your brand name</small></button></div>' +
        (B.vocals ? '<div class="fld"><label for="bmLy">Lyrics <small>optional, we write them if empty</small></label><textarea class="inp" id="bmLy" rows="2" maxlength="600" placeholder="Glow up, glow up, Glowlab!">' + esc(B.lyrics) + '</textarea></div>' : '') +
        '<div class="fld"><span class="lbl">Mood</span><div class="moods">' + ['upbeat', 'chill', 'cinematic', 'corporate', 'hiphop', 'emotional'].map(function (m) { return '<button class="mood' + (B.mood === m ? ' on' : '') + '" data-mood="' + m + '"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' + ({ hiphop: 'Hip-hop' }[m] || m.charAt(0).toUpperCase() + m.slice(1)) + '</button>'; }).join('') + '</div></div>' +
        '<div class="g2" style="gap:12px"><div class="fld"><label for="bmGenre">Genre <small>optional</small></label><input class="inp" id="bmGenre" maxlength="60" placeholder="Afrobeats pop" value="' + esc(B.genre) + '"><div class="chips">' + GENRES.map(function (g) { return '<button type="button" class="chip sm' + (B.genre === g ? ' on' : '') + '" data-genre="' + g + '">' + g + '</button>'; }).join('') + '</div></div>' +
        '<div class="fld"><span class="lbl">Tempo</span><div class="seg">' + [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']].map(function (x) { return '<button type="button" data-tempo="' + x[0] + '"' + (B.tempo === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div></div></div>' +
        '<div class="fld"><span class="lbl">Length</span><div class="mlen">' + LENGTHS.map(function (s) { var lk = s > maxS, pr = priceFor(t, s); return '<button type="button" class="mlen-c' + (B.mlen === s ? ' on' : '') + (lk ? ' lk' : '') + '" data-mlen="' + s + '"><b>' + s + 's</b><small>' + (lk ? I('lock', 10, 2.4) + 'Bigger plan' : fmt(pr) + ' credits') + '</small></button>'; }).join('') + '</div></div>' +
        '<div class="lic">' + I('shield', 16) + '<span><b>Yours to use in ads, including paid ads.</b> Reusing it in any Vooads video is free. Describe a mood and genre, never an artist or a song: prompts that imitate real artists are refused.</span></div>';
    }
    return h;
  }
  function priceFor(t, s) {
    var tbl = t.price_by_seconds || { 15: 60, 30: 60, 60: 60, 120: 110 };
    var keys = Object.keys(tbl).map(Number).sort(function (a, b) { return a - b; });
    var k = keys.find(function (x) { return x >= s; }) || keys[keys.length - 1];
    return tbl[k] || t.credits_per_unit;
  }
  function toggle(id, on, title, sub) { return '<label class="sw"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span class="k"></span><span><b>' + title + '</b><small class="muted" style="display:block;font-size:12.5px">' + sub + '</small></span></label>'; }

  function wireOpts(root, t, B, ctx) {
    var on = function (sel, ev, fn) { $$(sel, root).forEach(function (x) { x[ev] = fn; }); };
    on('[data-bgk]', 'onclick', function () { B.bg_kind = this.dataset.bgk; ctx.repaint(); ctx.quote(); });
    on('[data-swt]', 'onclick', function () { B.bg_color = this.dataset.swt; ctx.repaint(); ctx.summary(); });
    var bc = $('#bgCol', root); if (bc) { bc.oninput = function () { B.bg_color = this.value; $('#bgColT', root).value = this.value; $$('.bgt-c', root).forEach(function (x) { x.style.setProperty('--sw', B.bg_color); }); }; $('#bgColT', root).oninput = function () { if (/^#[0-9a-f]{6}$/i.test(this.value)) { B.bg_color = this.value; bc.value = this.value; } }; }
    var bp = $('#bgP', root); if (bp) bp.oninput = function () { B.bg_prompt = this.value; ctx.summary(); };
    on('[data-bgidea]', 'onclick', function () { B.bg_prompt = this.dataset.bgidea; $('#bgP', root).value = B.bg_prompt; ctx.summary(); });
    var bq = $('#bgQ', root); if (bq) bq.oninput = function () { B.bg_query = this.value; };
    on('[data-bgq]', 'onclick', function () { B.bg_query = this.dataset.bgq; $('#bgQ', root).value = B.bg_query; });
    var bi = $('#bgImg', root);
    if (bi) bi.onchange = async function () {
      var f = this.files[0]; if (!f) return;
      if (f.size > 8e6) { ctx.toast('Use a picture under 8 MB', true); return; }
      try { var r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f, credentials: 'same-origin' }); var d = await r.json(); if (!r.ok) throw new Error(d.error); B.bg_image_url = d.url; B.bg_image_prev = d.url; ctx.toast('Background picture added'); ctx.repaint(); }
      catch (e) { ctx.toast(e.message || 'Upload failed', true); }
    };
    var sw = function (id, key, repaint) { var el = $('#' + id, root); if (el) el.onchange = function () { B[key] = this.checked; if (repaint) ctx.repaint(); ctx.summary(); }; };
    sw('aeSil', 'remove_silences'); sw('aeHook', 'hook_first'); sw('aeCap', 'captions_on', true); sw('aeEnd', 'end_card', true);
    on('[data-cap]', 'onclick', function () { B.caption_style = this.dataset.cap; $$('[data-cap]', root).forEach(function (x) { var y = x.dataset.cap === B.caption_style; x.classList.toggle('on', y); x.setAttribute('aria-checked', y); }); ctx.summary(); });
    var col = $('#bCol', root); if (col) col.addEventListener('input', function () { $$('.capt-c', root).forEach(function (x) { x.style.setProperty('--bc', col.value); }); });
    on('[data-vox]', 'onclick', function () { B.vocals = this.dataset.vox === '1'; ctx.repaint(); ctx.summary(); });
    var ly = $('#bmLy', root); if (ly) ly.oninput = function () { B.lyrics = this.value; };
    var gn = $('#bmGenre', root); if (gn) gn.oninput = function () { B.genre = this.value; $$('[data-genre]', root).forEach(function (x) { x.classList.toggle('on', x.dataset.genre === B.genre); }); };
    on('[data-genre]', 'onclick', function () { B.genre = this.dataset.genre; $('#bmGenre', root).value = B.genre; $$('[data-genre]', root).forEach(function (x) { x.classList.toggle('on', x.dataset.genre === B.genre); }); });
    on('[data-tempo]', 'onclick', function () { B.tempo = this.dataset.tempo; $$('[data-tempo]', root).forEach(function (x) { x.classList.toggle('on', x.dataset.tempo === B.tempo); }); });
    on('[data-mlen]', 'onclick', function () { var s = Number(this.dataset.mlen); if (this.classList.contains('lk')) { ctx.upsell('Longer brand tracks (up to 120s) are on Pro and above.', 'longer tracks'); return; } B.mlen = s; B.duration = s; ctx.repaint(); ctx.quote(); });
  }

  // ---------- Request, readiness, summary ----------
  function req(t, B, i) {
    if (t.pipeline === 'bg_swap' || t.pipeline === 'auto_edit') {
      var up = upOf(B, t);
      if (up && up.id) { i.upload_id = up.id; i.duration = Math.ceil(up.duration); } else i.duration = t.min_seconds || 10;
      delete i.product; // the server names the job after the upload
    }
    if (t.pipeline === 'bg_swap') { i.bg_kind = B.bg_kind; i.bg_color = B.bg_color; i.aspect = B.aspect; if (B.bg_kind === 'image' && B.bg_image_url) i.bg_image_url = B.bg_image_url; if (B.bg_kind === 'ai') i.bg_prompt = B.bg_prompt.trim(); if (B.bg_kind === 'stock') i.bg_query = B.bg_query.trim(); }
    if (t.pipeline === 'auto_edit') { i.aspect = B.aspect; i.caption_style = B.caption_style; i.captions = !!B.captions_on; i.remove_silences = !!B.remove_silences; i.hook_first = !!B.hook_first; i.end_card = !!B.end_card; i.brand_color = B.brand_color; if (B.end_card) { if (B.cta.trim()) i.cta = B.cta.trim().slice(0, 30); if (B.logo_url) i.logo_url = B.logo_url; } }
    if (t.pipeline === 'brand_music') { i.duration = B.mlen; i.vocals = !!B.vocals; i.brand_name = B.brand_name.trim(); i.mood = B.mood; i.tempo = B.tempo; if (B.genre.trim()) i.genre = B.genre.trim(); if (B.vocals && B.lyrics.trim()) i.lyrics = B.lyrics.trim(); }
    return i;
  }
  function ready(t, B) {
    if (t.pipeline === 'brand_music') {
      if (B.product.trim().length < 3) return 'Tell us what the music is for.';
      if (B.vocals && !B.brand_name.trim()) return 'Add the brand name the jingle sings.';
      return '';
    }
    var up = upOf(B, t);
    if (up && up.state === 'uploading') return 'Uploading your video…';
    if (!up || !up.id) return 'Upload your video first.';
    if (t.pipeline === 'bg_swap' && B.bg_kind === 'image' && !B.bg_image_url) return 'Add the background picture.';
    if (t.pipeline === 'bg_swap' && B.bg_kind === 'ai' && B.bg_prompt.trim().length < 3) return 'Describe the background scene.';
    return '';
  }
  function step2(t, B) { if (t.pipeline === 'brand_music') return B.product.trim().length > 2; var up = upOf(B, t); return !!(up && up.id); }
  function rows(t, B) {
    var up = upOf(B, t), r = [];
    if (t.pipeline === 'brand_music') return [['Length', B.mlen + 's'], ['Sound', B.vocals ? 'Jingle with vocals' : 'Instrumental'], ['Mood', B.mood.charAt(0).toUpperCase() + B.mood.slice(1) + (B.genre ? ' · ' + B.genre : '')]];
    r.push(['Video', up && up.id ? (up.name || 'Your video').slice(0, 22) : up && up.state === 'uploading' ? 'Uploading…' : 'Not uploaded yet']);
    if (up && up.id) r.push(['Length', clock(up.duration) + (t.pipeline === 'auto_edit' ? ' raw' : '')]);
    if (t.pipeline === 'bg_swap') r.push(['Background', { color: 'Colour ' + B.bg_color, image: 'Your picture', ai: 'AI scene', stock: 'Stock video' }[B.bg_kind]], ['Shape', B.aspect === 'original' ? 'Original' : B.aspect]);
    if (t.pipeline === 'auto_edit') r.push(['Captions', B.captions_on ? (CAPS.find(function (c) { return c[0] === B.caption_style; }) || CAPS[0])[1] : 'Off'], ['Shape', B.aspect], ['Hook first', B.hook_first ? 'Yes' : 'No']);
    return r;
  }

  // ---------- Brand tracks (music source "brand") ----------
  function loadTracks(api) {
    return api('GET', '/api/brand-tracks').then(function (d) { tracks = d.tracks || []; tracksLoaded = true; return tracks; }).catch(function () { tracks = []; return tracks; });
  }
  function trackPicker(B) {
    if (!tracks.length) return '<p class="muted" style="font-size:13px">No brand tracks yet. <a href="#create?type=brand_music">Make one with Brand music</a>, then pick it here for free.</p>';
    if (!tracks.some(function (x) { return x.id === B.music_track; })) B.music_track = tracks[0].id;
    return '<div class="trk" role="radiogroup" aria-label="Your brand tracks">' + tracks.slice(0, 6).map(function (x) {
      var on = x.id === B.music_track;
      return '<div class="trk-r' + (on ? ' on' : '') + '"><button type="button" class="trk-p" data-tplay="' + esc(x.url) + '" aria-label="Play ' + esc(x.name) + '">' + I('play', 13) + '</button><button type="button" class="trk-b" data-mtrack="' + x.id + '" role="radio" aria-checked="' + on + '"><b>' + esc(x.name) + '</b><small>' + x.seconds + 's · ' + (x.vocals ? 'jingle' : 'instrumental') + ' · free</small></button></div>';
    }).join('') + '</div>';
  }
  var player = null;
  function wireTracks(root, B, ctx) {
    $$('[data-mtrack]', root).forEach(function (b) { b.onclick = function () { B.music_track = Number(b.dataset.mtrack); ctx.repaint(); ctx.quote(); }; });
    $$('[data-tplay]', root).forEach(function (b) { b.onclick = function () { if (player && player.src.indexOf(b.dataset.tplay) >= 0 && !player.paused) { player.pause(); b.classList.remove('on'); return; } if (player) player.pause(); $$('[data-tplay]', root).forEach(function (x) { x.classList.remove('on'); }); player = new Audio(b.dataset.tplay); player.play().catch(function () {}); b.classList.add('on'); player.onended = function () { b.classList.remove('on'); }; }; });
  }

  // ---------- Results ----------
  function extra(j) {
    var o = j.output || {}, i = j.input || {}, chips = [];
    if (j.type === 'auto_edit') {
      if (o.raw_seconds) chips.push(clock(o.raw_seconds) + ' raw → ' + clock(o.duration || 0));
      if (o.removed_seconds) chips.push('−' + Math.round(o.removed_seconds) + 's cut');
      if (o.pieces) chips.push(o.pieces + ' pieces');
      if (o.hook_first) chips.push('Hook first');
      if (o.captioned) chips.push('Captions burnt in');
    }
    if (j.type === 'bg_swap') {
      var b = o.background || {};
      chips.push(b.kind === 'color' ? 'Colour ' + (b.color || '') : b.ai ? 'AI scene' : b.kind === 'video' ? 'Stock video' : 'Your picture');
      chips.push(o.aspect === 'original' ? 'Original shape' : o.aspect);
      if (b.credit) chips.push(b.credit);
    }
    return chips.length ? '<div class="edx">' + chips.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' : '';
  }
  function musicResult(j) {
    var o = j.output || {};
    return '<div class="trkres"><div class="trkres-art">' + (window.VooToons && VooToons.typeScene ? VooToons.typeScene('jingle') : '') + '</div>' +
      '<div class="trkres-b"><span class="ml">saved to my brand tracks</span><h3 class="hx2" style="margin:2px 0 4px">' + esc(o.track_name || 'Your brand track') + '</h3><p class="muted" style="font-size:14px">' + (o.seconds || '') + 's · ' + (o.vocals ? 'jingle with vocals' : 'instrumental') + (o.mood ? ' · ' + esc(o.mood) : '') + (o.genre ? ' · ' + esc(o.genre) : '') + '</p>' +
      '<audio controls preload="metadata" src="' + esc(o.audio_url) + '" style="width:100%;margin:12px 0"></audio>' +
      '<div class="chips"><a class="btn arrow" href="' + esc(o.audio_url) + '" download>Download <span class="arr">' + I('download', 16) + '</span></a><button class="btn ghost" data-usetrack="' + (o.track_id || '') + '">' + I('film', 15) + ' Use in a video</button><button class="chip" data-again>' + I('plus', 13) + 'Make another</button></div>' +
      '<div class="lic" style="margin-top:12px">' + I('shield', 16) + '<span>' + esc(o.licence || '') + '</span></div></div></div>';
  }
  function libThumb(j) {
    var o = j.output || {};
    if (j.type !== 'brand_music' || j.status !== 'done') return null;
    return '<div class="tx trk-th"><span class="eqb" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>' + esc(o.track_name || 'Brand track') + '</b><span class="ml">' + (o.seconds || '') + 's · ' + (o.vocals ? 'jingle' : 'instrumental') + '</span></div>';
  }

  window.VooEdit = { PIPES: PIPES, is: is, draft: draft, base: base, wireBase: wireBase, opts: opts, wireOpts: wireOpts, req: req, ready: ready, step2: step2, rows: rows, extra: extra, musicResult: musicResult, libThumb: libThumb, loadTracks: loadTracks, trackPicker: trackPicker, wireTracks: wireTracks, tracks: function () { return tracks; }, tracksLoaded: function () { return tracksLoaded; }, priceFor: priceFor };
})();
