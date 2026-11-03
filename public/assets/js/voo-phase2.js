/* Vooads studio, Phase 2: chat editing (plan → exact credits → one-tap confirm → new version, compare, undo), the hook
   factory grid with "Export all", the actor library (house actors, describe → pick a face → voice, your own face with
   consent), and the Street interview and Viral edit (mad_edit) forms. Needs the helpers the studio defines (api, esc, I, toast, modal).
   No inline handlers: everything is wired with addEventListener after render. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var H = function () { return window.VA_STUDIO || window; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var ic = function (n, s) { return H().I ? H().I(n, s || 14) : ''; };
  var call = function (m, u, b) { return H().api(m, u, b); };
  var say = function (m, bad) { if (H().toast) H().toast(m, bad); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var EDITABLE = ['ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'motion_ad', 'bg_swap', 'auto_edit', 'street', 'mad_edit', 'edit'];
  var AI_LABEL_TYPES = ['ugc', 'street', 'dub', 'hook_remix', 'edit'];
  var SUGGEST = ['Cut the first 2 seconds', 'Captions bigger at the top', 'Add an end card "Shop now"', 'Make 5 new hooks', 'Add the AI label'];

  /* ================= Chat editing ================= */
  function canEdit(j) { return j && j.status === 'done' && EDITABLE.indexOf(j.type) >= 0 && j.output && j.output.url; }
  function chatPanel(j) {
    if (!canEdit(j)) return '';
    return '<section class="ce" id="ce" aria-label="Edit with chat"><div class="ce-h"><div><b>Edit with chat</b><small>Say what to change. You see the exact price before anything runs.</small></div><span class="ce-allow" id="ceAllow"></span></div>' +
      '<div class="ce-vers" id="ceV"></div>' +
      '<div class="ce-thread" id="ceT" aria-live="polite"></div>' +
      '<form class="ce-in" id="ceF"><label class="sr" for="ceI">What should change?</label><input id="ceI" class="inp" maxlength="600" autocomplete="off" placeholder="Cut the first 2 seconds, captions bigger…"><button class="btn blue" type="submit">' + ic('arrow', 16) + '<span>Send</span></button></form>' +
      '<div class="ce-sugg">' + SUGGEST.map(function (s) { return '<button type="button" class="chip" data-sg="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div></section>';
  }
  function planCard(m) {
    var p = m.plan || {}, items = p.items || [];
    var live = m.status === 'proposed';
    return '<div class="ce-plan' + (live ? '' : ' done') + '"><ul>' + items.map(function (x) {
      return '<li class="' + (x.error ? 'bad' : '') + '"><span>' + esc(x.label) + (x.kind === 'separate' ? ' <em>separate result</em>' : '') + (x.bulk_pct ? ' <em>−' + x.bulk_pct + '% bulk</em>' : '') + '</span><b>' + (x.error ? 'not available' : x.credits ? fmt(x.credits) + ' credits' : 'free') + '</b></li>';
    }).join('') + '</ul><div class="ce-tot"><span>Total</span><b>' + (p.total ? fmt(p.total) + ' credits' : '0 credits') + '</b></div>' +
      (live ? '<div class="ce-act"><button class="btn blue" data-ok="' + m.id + '">' + ic('check', 15) + 'Confirm' + (p.total ? ' · ' + fmt(p.total) + ' credits' : '') + '</button></div>' :
        '<p class="ce-st">' + (m.status === 'confirmed' ? ic('check', 13) + ' Confirmed' + (m.edit_job_id ? ' · version in progress or ready below' : '') : m.status === 'blocked' ? 'Part of this cannot be done yet.' : esc(m.status || '')) + '</p>') + '</div>';
  }
  function bubble(m) {
    if (m.role === 'user') return '<div class="ce-m me"><p>' + esc(m.text) + '</p>' + (m.credits ? '<small>' + m.credits + ' credit message</small>' : '') + '</div>';
    var body = m.kind === 'plan' ? '<p>' + esc(m.text || 'Here is the plan.') + '</p>' + planCard(m) : '<p>' + esc(m.text) + '</p>';
    return '<div class="ce-m ai' + (m.kind === 'unsupported' ? ' no' : m.kind === 'question' ? ' q' : '') + '">' + body + '</div>';
  }
  function versionsHTML(d) {
    var vs = d.versions || [];
    var done = vs.filter(function (v) { return v.version; });
    return '<div class="ce-vl">' + vs.map(function (v) {
      if (!v.version) return '<span class="vchip ' + (v.pending ? 'wait' : 'fail') + '" title="' + esc(v.summary || '') + '">' + (v.pending ? 'Editing…' : 'Edit failed') + '</span>';
      return '<button type="button" class="vchip' + (v.current ? ' on' : '') + '" data-v="' + v.job_id + '" title="' + esc(v.summary || '') + '"><b>v' + v.version + '</b><span>' + esc(v.version === 1 ? 'Original' : (v.summary || '').slice(0, 38)) + '</span></button>';
    }).join('') + '</div>' + (done.length > 1 ? '<div class="ce-va"><button type="button" class="chip" data-cmp>' + ic('copy', 13) + 'Compare</button><button type="button" class="chip" data-undo>' + ic('arrow', 13) + 'Undo</button></div>' : '');
  }
  function wireChat(m, j, onVersion) {
    var box = $('#ce', m); if (!box) return;
    var state = { d: null, busy: false };
    var paint = function () {
      var d = state.d; if (!d) return;
      var a = d.allowance || {};
      $('#ceAllow', box).textContent = a.free_left != null && a.free_left > 0 ? a.free_left + ' free message' + (a.free_left > 1 ? 's' : '') + ' left today' : a.credits ? a.credits + ' credits a message' : '';
      $('#ceV', box).innerHTML = versionsHTML(d);
      $('#ceT', box).innerHTML = d.messages.length ? d.messages.map(bubble).join('') : '<p class="ce-empty">Try "cut the first 2 seconds" or "captions bigger at the top". Cuts, captions, text and music edits are free; re-making a scene or dubbing shows its price first.</p>';
      var t = $('#ceT', box); t.scrollTop = t.scrollHeight;
      wire();
    };
    var load = async function () { try { state.d = await call('GET', '/api/jobs/' + j.id + '/versions'); paint(); } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; } };
    var send = async function (text) {
      if (!text || state.busy) return; state.busy = true;
      var t = $('#ceT', box); t.insertAdjacentHTML('beforeend', '<div class="ce-m me"><p>' + esc(text) + '</p></div><div class="ce-m ai typing"><p>Planning…</p></div>'); t.scrollTop = t.scrollHeight;
      try { var r = await call('POST', '/api/jobs/' + j.id + '/chat', { message: text }); if (r.fee_credits) say(r.fee_credits + ' credits for this message'); await load(); }
      catch (e) { say(e.message, true); await load(); }
      state.busy = false;
    };
    var watch = async function (editId) {
      for (var k = 0; k < 400; k++) {
        await sleep(1500);
        var r; try { r = (await call('GET', '/api/jobs/' + editId)).job; } catch (e) { continue; }
        if (r.status === 'done') { say('Version ' + (r.output.version || '') + ' is ready'); await load(); if (onVersion) onVersion(r.output.url); return; }
        if (r.status === 'failed') { say(r.error || 'That edit failed. Credits for it were returned.', true); await load(); return; }
      }
    };
    var wire = function () {
      $$('[data-ok]', box).forEach(function (b) { b.addEventListener('click', async function () {
        b.disabled = true; b.textContent = 'Starting…';
        try {
          var r = await call('POST', '/api/jobs/' + j.id + '/chat/' + b.dataset.ok + '/confirm');
          if (r.charged) say(fmt(r.charged) + ' credits used');
          (r.children || []).filter(function (c) { return c.separate; }).forEach(function (c) { say('Your new hooks are being made. They land in My ads.'); });
          await load();
          if (r.edit_job_id) watch(r.edit_job_id);
          if (H().refreshMe) H().refreshMe();
        } catch (e) { say(e.message, true); await load(); }
      }); });
      $$('[data-v]', box).forEach(function (b) { b.addEventListener('click', async function () { try { state.d = await call('POST', '/api/jobs/' + j.id + '/versions/' + b.dataset.v + '/use'); paint(); var v = state.d.versions.find(function (x) { return x.current; }); if (v && onVersion) onVersion(v.url); } catch (e) { say(e.message, true); } }); });
      var u = $('[data-undo]', box); if (u) u.addEventListener('click', async function () { try { state.d = await call('POST', '/api/jobs/' + j.id + '/undo'); paint(); var v = state.d.versions.find(function (x) { return x.current; }); if (v && onVersion) onVersion(v.url); say('Back to v' + (v ? v.version : 1)); } catch (e) { say(e.message, true); } });
      var c = $('[data-cmp]', box); if (c) c.addEventListener('click', function () { compare(state.d); });
    };
    $('#ceF', box).addEventListener('submit', function (e) { e.preventDefault(); var i = $('#ceI', box); var v = i.value.trim(); i.value = ''; send(v); });
    $$('[data-sg]', box).forEach(function (b) { b.addEventListener('click', function () { if (/AI label/.test(b.dataset.sg)) return labelIt(); send(b.dataset.sg); }); });
    var labelIt = async function () { try { await call('POST', '/api/jobs/' + j.id + '/label', { on: true }); await load(); } catch (e) { say(e.message, true); } };
    box._label = labelIt;
    load();
  }
  function compare(d) {
    var done = (d.versions || []).filter(function (v) { return v.version; });
    var cur = done.find(function (v) { return v.current; }) || done[done.length - 1];
    var prev = done.filter(function (v) { return v !== cur; }).pop() || done[0];
    var opts = function (sel) { return done.map(function (v) { return '<option value="' + v.job_id + '"' + (v === sel ? ' selected' : '') + '>v' + v.version + ' · ' + esc(v.version === 1 ? 'Original' : (v.summary || '').slice(0, 30)) + '</option>'; }).join(''); };
    var m = H().modal('<div class="mbd"><div class="cmp"><div><select class="inp" id="cmpA">' + opts(prev) + '</select><div class="player"><video id="cvA" src="' + esc(prev.url) + '" playsinline muted controls></video></div></div><div><select class="inp" id="cmpB">' + opts(cur) + '</select><div class="player"><video id="cvB" src="' + esc(cur.url) + '" playsinline muted controls></video></div></div></div><div class="chips" style="justify-content:center;margin-top:12px"><button class="btn blue" id="cmpP">' + ic('play', 15) + 'Play both</button></div></div>', 'Compare versions');
    var A = $('#cvA', m), B = $('#cvB', m);
    $('#cmpA', m).addEventListener('change', function () { A.src = done.find(function (v) { return String(v.job_id) === this.value; }, this).url; });
    $('#cmpB', m).addEventListener('change', function () { B.src = done.find(function (v) { return String(v.job_id) === this.value; }, this).url; });
    $('#cmpP', m).addEventListener('click', function () { A.currentTime = 0; B.currentTime = 0; A.play().catch(function () {}); B.play().catch(function () {}); });
  }

  /* ================= Export note (honesty) ================= */
  function exportNote(j) {
    if (!j || j.status !== 'done' || AI_LABEL_TYPES.indexOf(j.type) < 0) return '';
    var street = j.type === 'street';
    return '<div class="honest">' + ic('shield', 15) + '<div><b>' + (street ? 'AI dramatization' : 'AI-generated people') + '</b><span>Every face and voice here is AI-generated. Don\'t present it as a real customer, a real interview or a real review. Platforms may ask you to switch on their AI label.</span><button type="button" class="chip" data-ailabel>' + ic('plus', 13) + 'Add "AI-generated" label (free)</button></div></div>';
  }
  function wireExport(m) {
    var b = $('[data-ailabel]', m); if (!b) return;
    b.addEventListener('click', function () { var ce = $('#ce', m); if (ce && ce._label) { ce._label(); ce.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
  }

  /* ================= Hook factory grid ================= */
  function hookGrid(j) {
    var o = j.output || {}, hs = o.hooks || [];
    return '<div class="hgrid-h"><div><b>' + hs.length + ' openings for this ad</b><small>Each hook is spliced onto your video, ready to test side by side.</small></div><a class="btn blue" href="/api/jobs/' + j.id + '/export.zip" download>' + ic('download', 15) + 'Export all</a></div>' +
      '<div class="hgrid' + (hs.length > 5 ? ' ten' : '') + '">' + hs.map(function (x, i) {
        var src = x.remix_url || x.url;
        return '<figure class="hcell"><div class="media"><video muted loop playsinline preload="metadata" data-src="' + esc(src) + '"></video><span class="hn">' + String(i + 1).padStart(2, '0') + '</span></div><figcaption><b>' + esc(x.text) + '</b><span class="chips">' + (x.remix_url ? '<a class="chip on" href="' + esc(x.remix_url) + '" download>' + ic('download', 12) + 'Full ad</a>' : '') + '<a class="chip" href="' + esc(x.url) + '" download>' + ic('download', 12) + 'Hook only</a></span></figcaption></figure>';
      }).join('') + '</div>' + (o.note ? '<p class="muted" style="font-size:13px">' + esc(o.note) + '</p>' : '');
  }
  function hookCounts(t, cur) {
    var max = Math.min(10, Number(t && t.max_hooks) || 10), out = [];
    for (var n = 1; n <= max; n++) {
      var pct = (t && t.bulk_discounts || []).filter(function (x) { return n >= x.min; }).reduce(function (m, x) { return Math.max(m, x.pct); }, 0);
      out.push('<button class="chip' + (cur === n ? ' on' : '') + '" data-hn="' + n + '">' + n + (pct ? ' <em class="save">−' + pct + '%</em>' : '') + '</button>');
    }
    return out.join('');
  }

  /* ================= Street interview + Viral edit forms ================= */
  function opts(t, B) {
    if (t.pipeline === 'street') {
      return '<div><h3>Street interview</h3><p class="sub">A presenter with a handheld mic stops a passer-by. Two AI speakers, real street sound. The AI writes the questions and answers, or paste your own.</p></div>' +
        '<div class="fld"><label for="sQ">First question <small>optional</small></label><input class="inp" id="sQ" maxlength="160" placeholder="What is in your bag today?" value="' + esc(B.st_question || '') + '"></div>' +
        '<div class="g2" style="gap:12px"><div class="fld"><label for="sG">Passer-by <small>optional look</small></label><input class="inp" id="sG" maxlength="200" placeholder="woman in her thirties, denim jacket" value="' + esc(B.st_guest || '') + '"></div><div class="fld"><label for="sC">City feel <small>optional</small></label><input class="inp" id="sC" maxlength="40" placeholder="busy downtown" value="' + esc(B.st_city || '') + '"></div></div>' +
        '<div class="fld"><label for="sS">Your script <small>optional · one line each, "Host:" or "Guest:"</small></label><textarea class="inp" id="sS" rows="4" maxlength="3000" placeholder="Host: What are you training for?\nGuest: My first half marathon.">' + esc(B.st_script || '') + '</textarea></div>' +
        '<label class="sw"><input type="checkbox" id="sL"' + (B.st_label === false ? '' : ' checked') + '><span class="k"></span><span><b>Mark it as AI-generated</b><small class="muted" style="display:block;font-size:12.5px">Every face is AI. Never present it as a real customer or a real interview.</small></span></label>';
    }
    if (t.pipeline === 'mad_edit') {
      var own = B.md_source === 'own';
      return '<div><h3>Viral edit</h3><p class="sub">Fast cuts on the beat, zooms, bold captions and sound hits. Sound effects and the beat are made by Vooads.</p></div>' +
        '<div class="fld"><span class="lbl">Footage</span><div class="chips"><button class="chip' + (own ? '' : ' on') + '" data-md="ai">New AI shots</button><button class="chip' + (own ? ' on' : '') + '" data-md="own">My own videos <em class="save">cheaper</em></button></div></div>' +
        (own ? '<div class="fld"><label class="upl"><input type="file" accept="video/mp4,video/quicktime,video/webm" hidden id="mdUp" multiple><span class="ph">' + ic('upload', 22) + '</span><div><b style="font-size:14.5px">' + ((B.md_videos || []).length ? (B.md_videos.length + ' video' + (B.md_videos.length > 1 ? 's' : '') + ' added') : 'Add 1 to 8 clips') + '</b><small class="muted" style="display:block;font-size:12.5px">MP4, MOV or WebM. We cut them to the beat.</small></div></label></div>' : '') +
        '<div class="fld"><label for="mdH">Big text hits <small>optional · one per line, 1–3 words</small></label><textarea class="inp" id="mdH" rows="3" maxlength="200" placeholder="New drop\nZero fuss\nShop now">' + esc(B.md_hits || '') + '</textarea></div>' +
        '<div class="fld"><span class="lbl">Tempo</span><div class="chips">' + [[108, 'Chill'], [124, 'Punchy'], [140, 'Hyper']].map(function (x) { return '<button class="chip' + ((B.md_bpm || 124) === x[0] ? ' on' : '') + '" data-bpm="' + x[0] + '">' + x[1] + ' · ' + x[0] + ' bpm</button>'; }).join('') + '</div></div>';
    }
    return '';
  }
  function wireOpts(root, t, B, ctx) {
    var on = function (sel, ev, fn) { $$(sel, root).forEach(function (x) { x.addEventListener(ev, fn); }); };
    on('#sQ', 'input', function () { B.st_question = this.value; });
    on('#sG', 'input', function () { B.st_guest = this.value; });
    on('#sC', 'input', function () { B.st_city = this.value; });
    on('#sS', 'input', function () { B.st_script = this.value; ctx.quote(); });
    on('#sL', 'change', function () { B.st_label = this.checked; });
    on('[data-md]', 'click', function () { B.md_source = this.dataset.md; ctx.repaint(); ctx.quote(); });
    on('#mdH', 'input', function () { B.md_hits = this.value; });
    on('[data-bpm]', 'click', function () { B.md_bpm = Number(this.dataset.bpm); ctx.repaint(); });
    on('#mdUp', 'change', async function () {
      var files = Array.prototype.slice.call(this.files || []).slice(0, 8);
      B.md_videos = B.md_videos || [];
      for (var k = 0; k < files.length; k++) {
        try {
          var r = await fetch('/api/uploads/video?for=mad_edit&name=' + encodeURIComponent(files[k].name), { method: 'POST', headers: { 'Content-Type': files[k].type || 'video/mp4' }, body: files[k], credentials: 'same-origin' });
          var d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
          B.md_videos.push(d.upload.id);
        } catch (e) { say(e.message, true); }
      }
      ctx.repaint();
    });
  }
  function req(t, B, i) {
    if (t.pipeline === 'street') {
      if (B.st_question) i.question = B.st_question;
      if (B.st_guest) i.guest_desc = B.st_guest;
      if (B.st_city) i.city = B.st_city;
      if (B.st_script && B.st_script.trim()) i.script = B.st_script;
      i.ai_label = B.st_label !== false;
      if (B.actor_id) i.actor_id = B.actor_id;
    }
    if (t.pipeline === 'mad_edit') {
      i.source = B.md_source === 'own' ? 'own' : 'ai';
      if (i.source === 'own') i.videos = (B.md_videos || []).slice(0, 8);
      var hits = String(B.md_hits || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (hits.length) i.hits = hits.slice(0, 6);
      i.bpm = B.md_bpm || 124;
      i.brand_color = B.brand_color;
    }
    return i;
  }

  /* ================= Actor library ================= */
  async function actors(el) {
    el.innerHTML = '<span class="spinner"></span>';
    var d;
    try { d = await call('GET', '/api/actors'); } catch (e) { el.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; return; }
    var card = function (a, house) {
      var st = a.status !== 'active' ? '<em class="pill ' + (a.status === 'pending' ? 'wait' : 'bad') + '">' + (a.status === 'pending' ? 'Consent check' : 'Not approved') + '</em>' : '';
      return '<article class="actor2' + (a.status !== 'active' ? ' off' : '') + '"><span class="ph"><img src="' + esc(a.image_url) + '" alt="" loading="lazy"></span><div><b>' + esc(a.name) + '</b>' + st + '<small>' + esc(a.voice_name || '') + (house ? ' · House actor' : a.kind === 'upload' ? ' · Your face' : ' · Your actor') + '</small></div>' +
        '<div class="chips">' + (a.status === 'active' ? '<button class="chip on" data-use="' + esc(a.id) + '">' + ic('ugc', 12) + 'Use in a video</button>' : '') + (house ? '' : '<button class="chip" data-del="' + esc(a.id) + '" aria-label="Delete ' + esc(a.name) + '">' + ic('x', 12) + '</button>') + '</div></article>';
    };
    el.innerHTML = '<p class="lead muted">Actors keep the same face and voice in every video. Every face is AI-generated, except your own (after a consent check).</p>' +
      '<div class="act-new"><button class="btn blue" id="aNew">' + ic('plus', 15) + 'Create an actor</button><button class="btn ghost" id="aOwn">' + ic('ugc', 15) + 'Use my own face</button></div>' +
      (d.mine.length ? '<h3 class="act-h">Your actors</h3><div class="actors2">' + d.mine.map(function (a) { return card(a, false); }).join('') + '</div>' : '') +
      '<h3 class="act-h">House actors <small class="muted">recommended for you</small></h3>' + (window.VooActors ? VooActors.row('', '') : '<div class="actors2">' + d.house.map(function (a) { return card(a, true); }).join('') + '</div>') +
      '<p class="muted fine">We refuse actors that copy or resemble celebrities, public figures or people you know.</p>';
    $$('[data-use]', el).forEach(function (b) { b.addEventListener('click', function () { var a = d.house.concat(d.mine).find(function (x) { return String(x.id) === b.dataset.use; }); H().startDraft({ pipe: 'ugc', presenter: a && a.id && String(a.id).indexOf('h:') === 0 ? String(a.id).slice(2) : undefined }); if (H().B) { H().B.actor_id = b.dataset.use; } say((a ? a.name : 'Actor') + ' is your presenter'); }); });
    $$('[data-del]', el).forEach(function (b) { b.addEventListener('click', async function () { if (!confirm('Delete this actor?')) return; try { await call('DELETE', '/api/actors/' + b.dataset.del); actors(el); } catch (e) { say(e.message, true); } }); });
    if (window.VooActors) { var useHouse = function (id, own) { H().startDraft({ pipe: 'ugc', presenter: own ? undefined : id }); if (H().B) { if (own) H().B.actor_id = id; else delete H().B.actor_id; } var a = (H().CFG.presenters || []).find(function (x) { return x.id === id; }); say((a ? a.name : 'Actor') + ' is your presenter'); }; VooActors.wire(el, useHouse); VooActors.load(el, 'ugc', '', '', useHouse); }
    $('#aNew', el).addEventListener('click', function () { createActor(d, function () { actors(el); }); });
    $('#aOwn', el).addEventListener('click', function () { ownFace(d, function () { actors(el); }); });
  }
  function voiceSel(d, id) { return '<select class="inp" id="' + id + '">' + d.voices.map(function (v) { return '<option value="' + esc(v.key) + '">' + esc(v.name) + '</option>'; }).join('') + '</select>'; }
  function createActor(d, done) {
    var m = H().modal('<div class="mbd"><div class="fld"><label for="acD">Describe the person</label><textarea class="inp" id="acD" rows="3" maxlength="400" placeholder="Woman in her forties, short grey hair, linen shirt, sunny kitchen"></textarea><small class="muted">Age, look, hair, clothes, setting. Fictional people only.</small></div><p class="muted" id="acP" style="font-size:13px"></p><div class="chips"><button class="btn blue" id="acGo">' + ic('spark', 15) + 'Make 4 faces</button></div><div id="acF" class="faces"></div></div>', 'Create an actor');
    var cfg = H().CFG || {}; var price = (cfg.costs && cfg.costs.actor_faces) || 12;
    $('#acP', m).textContent = '4 faces cost ' + price + ' credits. Pick one, name it and give it a voice.';
    $('#acGo', m).addEventListener('click', async function () {
      var b = this, text = $('#acD', m).value.trim();
      try { var chk = await call('POST', '/api/actors/check', { text: text }); if (!chk.ok) { say(chk.error, true); return; } } catch (e) {}
      b.disabled = true; b.textContent = 'Making faces…';
      try {
        var r = await call('POST', '/api/jobs', { type: 'actor', description: text });
        var j = r.job;
        for (var k = 0; k < 120 && j.status !== 'done' && j.status !== 'failed'; k++) { await sleep(1500); j = (await call('GET', '/api/jobs/' + j.id)).job; }
        if (j.status !== 'done') throw new Error(j.error || 'The faces did not finish. Your credits were returned.');
        $('#acF', m).innerHTML = j.output.faces.map(function (f, i) { return '<button class="face2' + (i ? '' : ' on') + '" data-f="' + esc(f) + '"><img src="' + esc(f) + '" alt="Face ' + (i + 1) + '"></button>'; }).join('') +
          '<div class="g2" style="gap:12px;grid-column:1/-1"><div class="fld"><label for="acN">Name</label><input class="inp" id="acN" maxlength="40" placeholder="Rita"></div><div class="fld"><label for="acV">Voice</label>' + voiceSel(d, 'acV') + '</div></div><button class="btn blue" id="acS" style="grid-column:1/-1">Save actor</button>';
        var pick = j.output.faces[0];
        $$('[data-f]', m).forEach(function (x) { x.addEventListener('click', function () { pick = x.dataset.f; $$('[data-f]', m).forEach(function (y) { y.classList.toggle('on', y === x); }); }); });
        $('#acS', m).addEventListener('click', async function () { try { await call('POST', '/api/actors', { job_id: j.id, face_url: pick, name: $('#acN', m).value, voice_key: $('#acV', m).value }); say('Actor saved'); m._close(); done(); } catch (e) { say(e.message, true); } });
        b.remove();
        if (H().refreshMe) H().refreshMe();
      } catch (e) { say(e.message, true); b.disabled = false; b.textContent = 'Make 4 faces'; }
    });
  }
  function ownFace(d, done) {
    var line = String(d.consent_line || '').replace('{name}', '[your name]');
    var m = H().modal('<div class="mbd"><p class="muted">Use your own face as an actor. We check your consent clip before the actor can be used.</p>' +
      '<div class="fld"><label for="ofN">Your name <small>as you say it in the clip</small></label><input class="inp" id="ofN" maxlength="40"></div>' +
      '<div class="fld"><span class="lbl">1. A clear photo of your face</span><label class="upl"><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="ofP"><span class="ph">' + ic('upload', 20) + '</span><div><b id="ofPt">Add a photo</b><small class="muted" style="display:block">PNG, JPG or WebP, face to camera, good light.</small></div></label></div>' +
      '<div class="fld"><span class="lbl">2. Consent clip</span><p class="consent">"' + esc(line) + '"</p><label class="upl"><input type="file" accept="video/mp4,video/quicktime,video/webm" hidden id="ofC"><span class="ph">' + ic('upload', 20) + '</span><div><b id="ofCt">Upload a short video of you saying this</b><small class="muted" style="display:block">3 to 60 seconds, face visible.</small></div></label></div>' +
      '<div class="fld"><label for="ofV">Voice</label>' + voiceSel(d, 'ofV') + '</div>' +
      '<label class="sw"><input type="checkbox" id="ofOk"><span class="k"></span><span><b>This is my own face</b><small class="muted" style="display:block;font-size:12.5px">I am 18 or older and I agree to Vooads making AI videos with my face for my own ads. I can delete the actor at any time.</small></span></label>' +
      '<button class="btn blue" id="ofS" style="margin-top:12px">Send for consent check</button></div>', 'Use my own face');
    var img = '', clip = '';
    $('#ofP', m).addEventListener('change', async function () { var f = this.files[0]; if (!f) return; try { var r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f, credentials: 'same-origin' }); var j = await r.json(); if (!r.ok) throw new Error(j.error); img = j.url; $('#ofPt', m).textContent = 'Photo added'; } catch (e) { say(e.message, true); } });
    $('#ofC', m).addEventListener('change', async function () { var f = this.files[0]; if (!f) return; $('#ofCt', m).textContent = 'Uploading…'; try { var r = await fetch('/api/uploads/video?for=actor_consent&name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': f.type || 'video/mp4' }, body: f, credentials: 'same-origin' }); var j = await r.json(); if (!r.ok) throw new Error(j.error); clip = j.upload.id; $('#ofCt', m).textContent = 'Consent clip added'; } catch (e) { $('#ofCt', m).textContent = 'Upload a short video of you saying this'; say(e.message, true); } });
    $('#ofS', m).addEventListener('click', async function () { try { await call('POST', '/api/actors/upload', { name: $('#ofN', m).value, image_url: img, consent: $('#ofOk', m).checked, consent_upload_id: clip, voice_key: $('#ofV', m).value }); say('Sent. We check consent clips quickly; you can use the actor once it is approved.'); m._close(); done(); } catch (e) { say(e.message, true); } });
  }


  /* ================= Learn: real-UI walkthroughs ================= */
  // Each lesson step is a real screenshot of the studio (public/learn, made from the live UI) with the element ringed, the
  // caption and the narration. Narration: the lesson's recorded mp3 when there is one, else the browser voice, else text.
  async function learn(el, r) {
    el.innerHTML = '<span class="spinner"></span>';
    var data, shots = {};
    try { data = await H().VooTrainer.data(); } catch (e) { data = { lessons: [], audio: {} }; }
    try { shots = (await (await fetch('/learn/index.json', { credentials: 'same-origin' })).json()).lessons || {}; } catch (e) { shots = {}; }
    var ls = (data.lessons || []).filter(function (l) { return shots[l.id] && shots[l.id].length; });
    el.innerHTML = '<section class="lrn-h"><div><span class="ml">' + ls.length + ' walkthroughs · real screens</span><h2>Learn Vooads on the real studio.</h2><p class="muted">Every step is a screenshot of the studio you are using, with captions and a voice. Pause, go back, replay.</p></div></section>' +
      '<div class="lrn-grid">' + ls.map(function (l, i) {
        return '<button class="lrn-c" data-id="' + esc(l.id) + '"><span class="lrn-th"><img src="' + esc(shots[l.id][0].img) + '" alt="" loading="lazy"><span class="pl">' + ic('play', 16) + '</span></span><span class="ml">' + (i ? 'Lesson ' + (i + 1) : 'Start here') + ' · ' + esc(l.level || 'Beginner') + '</span><b>' + esc(l.title) + '</b><small>' + esc(l.summary || '') + '</small><span class="lrn-meta">' + (l.minutes || 2) + ' min · ' + l.scenes.length + ' steps</span></button>';
      }).join('') + '</div>';
    $$('.lrn-c', el).forEach(function (b) { b.addEventListener('click', function () { play(ls.find(function (l) { return l.id === b.dataset.id; }), shots[b.dataset.id], data.audio || {}); }); });
    if (r && r.sub) { var id = r.sub.replace(/^lesson-/, ''); var l0 = ls.find(function (l) { return l.id === id; }); if (l0) play(l0, shots[id], data.audio || {}); }
  }
  function play(l, imgs, audio) {
    var i = 0, auto = true, au = null, timer = 0;
    var m = H().modal('<div class="mbd lrn-p"><div class="lrn-fr"><img id="lpI" alt=""></div><div class="lrn-tx"><span class="ml" id="lpN"></span><b id="lpC"></b><p id="lpT"></p><div class="lrn-bar"><i id="lpB"></i></div><div class="chips"><button class="chip" id="lpPrev">' + ic('arrow', 13) + 'Back</button><button class="btn blue" id="lpPlay">Pause</button><button class="chip" id="lpNext">Next</button></div></div></div>', l.title);
    var stop = function () { clearTimeout(timer); if (au) { au.pause(); au = null; } try { speechSynthesis.cancel(); } catch (e) {} };
    var next = function () { if (i < l.scenes.length - 1) { i++; show(); } else { auto = false; $('#lpPlay', m).textContent = 'Replay'; } };
    var speak = function (text) {
      var url = (audio[l.id] || [])[i];
      if (url) { au = new Audio(url); au.onended = function () { if (auto) next(); }; au.play().catch(function () { timer = setTimeout(next, 4000); }); return; }
      try { var u = new SpeechSynthesisUtterance(text); u.rate = 1; u.onend = function () { if (auto) timer = setTimeout(next, 500); }; speechSynthesis.speak(u); }
      catch (e) { timer = setTimeout(function () { if (auto) next(); }, Math.max(3500, text.length * 55)); }
    };
    var show = function () {
      stop();
      var s = l.scenes[i];
      $('#lpI', m).src = imgs[i] ? imgs[i].img : imgs[0].img;
      $('#lpI', m).alt = s.caption || '';
      $('#lpN', m).textContent = 'Step ' + (i + 1) + ' of ' + l.scenes.length;
      $('#lpC', m).textContent = s.caption || '';
      $('#lpT', m).textContent = s.narration || '';
      $('#lpB', m).style.transform = 'scaleX(' + ((i + 1) / l.scenes.length) + ')';
      if (auto) speak(s.narration || s.caption || '');
    };
    $('#lpPrev', m).addEventListener('click', function () { if (i > 0) { i--; show(); } });
    $('#lpNext', m).addEventListener('click', function () { if (i < l.scenes.length - 1) { i++; show(); } });
    $('#lpPlay', m).addEventListener('click', function () { if (!auto && i === l.scenes.length - 1) { i = 0; auto = true; this.textContent = 'Pause'; show(); return; } auto = !auto; this.textContent = auto ? 'Pause' : 'Play'; if (auto) show(); else stop(); });
    var close0 = m._onclose; m._onclose = function () { stop(); if (close0) close0(); };
    show();
  }


  /* ================= Zedapex apps (restyled) ================= */
  function apps(el) {
    var A = window.VooApps; if (!A) return;
    var arrow = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    el.innerHTML = '<section class="apx-h"><span class="ml">The Voo family</span><h2>Vooads makes the ad. These apps close the loop.</h2><p class="muted">Track who the ad brought in, answer their chats, follow up and get paid. One Voo ID opens all of them.</p></section>' +
      '<div class="apx">' + A.CAR.map(function (a) {
        return '<article class="apx-c ' + esc(a.k) + '"><div class="apx-t">' + A.logo(a.k) + '<div><b>' + esc(a.name) + '</b><small>' + esc(a.tag) + '</small></div></div><p>' + esc(a.line) + '</p><div class="apx-f"><span class="apx-chip">' + esc(a.chip) + '</span><a class="btn ghost sm" href="' + esc(A.LINKS[a.name] || 'https://voosquare.com') + '" target="_blank" rel="noopener">' + esc(a.cta) + ' ' + arrow + '</a></div></article>';
      }).join('') + '</div>';
  }

  window.VooP2 = { apps: apps, learn: learn, canEdit: canEdit, chatPanel: chatPanel, wireChat: wireChat, exportNote: exportNote, wireExport: wireExport, hookGrid: hookGrid, hookCounts: hookCounts, opts: opts, wireOpts: wireOpts, req: req, actors: actors, isNew: function (t) { return t && (t.pipeline === 'street' || t.pipeline === 'mad_edit'); } };
})();
