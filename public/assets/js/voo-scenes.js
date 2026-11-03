// VooToons scenes for the Create picker and Checkout: small drawn, animated thumbnails (ink + orange duotone).
// Extends window.VooToons. Motion lives in /assets/css/polish.css and only animates transform and opacity.
(function () {
  'use strict';
  var TN = window.VooToons; if (!TN) return;
  var INK = '#0B0B0A', OR = '#FF4A1C', ORD = '#C9370F', PEACH = '#FFB59E', SOFT = '#FFEDE6', LINE = '#E6E3DA', GREY = '#6B6860';
  var F = 'font-family="Plus Jakarta Sans,system-ui,sans-serif" font-weight="800"';
  var uid = 0;
  var id = function (p) { return 'vs' + p + (++uid); };
  var who = function (w, pose, cls, x, y, s) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || .52) + ')">' + TN.person({ who: w, pose: pose, cls: cls || '' }) + '</g>'; };
  var star = function (x, y, r, fill, cls) { return '<path class="' + (cls || '') + '" d="M' + x + ' ' + (y - r) + 'l' + r * .28 + ' ' + r * .72 + ' ' + r * .72 + ' ' + r * .28 + '-' + r * .72 + ' ' + r * .28 + '-' + r * .28 + ' ' + r * .72 + '-' + r * .28 + '-' + r * .72 + '-' + r * .72 + '-' + r * .28 + ' ' + r * .72 + '-' + r * .28 + 'z" fill="' + fill + '"/>'; };
  var floor = '<ellipse cx="80" cy="98" rx="62" ry="5" fill="' + INK + '" opacity=".06"/>';

  var S = {
    // Creator talking to a phone camera
    ugc: function () {
      return '<circle cx="60" cy="50" r="40" fill="' + SOFT + '"/>' + floor + who('maya', 'hold', 'talking', -14, -20, 1) +
        '<g class="sc-pop"><rect x="104" y="38" width="40" height="17" rx="8.5" fill="#fff"/><circle class="sc-blink" cx="113" cy="46.5" r="3.2" fill="' + OR + '"/><text x="120" y="50.2" font-size="9" ' + F + ' fill="' + INK + '">REC</text></g>' +
        '<g class="sc-type"><rect x="100" y="66" width="48" height="8" rx="4" fill="' + INK + '"/></g><g class="sc-type d2"><rect x="108" y="78" width="32" height="7" rx="3.5" fill="' + OR + '"/></g>';
    },
    // Green-screen reaction: a creator in front of a real chroma-green wall (soft studio light falloff, flickering key
    // lights) pointing at the screen behind them while it swaps: web page → product → price tag. Drawn full-bleed.
    green: function () {
      var g = id('gs'), v = id('gv'), l = id('gl'), c = id('gc');
      return '<defs><radialGradient id="' + g + '" cx="58%" cy="34%" r="78%"><stop offset="0" stop-color="#4BEA87"/><stop offset=".42" stop-color="#1DB954"/><stop offset="1" stop-color="#0B7D35"/></radialGradient>' +
        '<radialGradient id="' + v + '" cx="50%" cy="45%" r="70%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#03240F" stop-opacity=".38"/></radialGradient>' +
        '<radialGradient id="' + l + '"><stop offset="0" stop-color="#F4FFF7" stop-opacity=".95"/><stop offset=".35" stop-color="#C9FFD9" stop-opacity=".45"/><stop offset="1" stop-color="#C9FFD9" stop-opacity="0"/></radialGradient>' +
        '<clipPath id="' + c + '"><rect x="72" y="11" width="80" height="54" rx="6"/></clipPath></defs>' +
        '<rect width="160" height="100" fill="url(#' + g + ')"/>' +
        // floor seam + soft key-light pools (they flicker a little, like real studio lights)
        '<path d="M0 86C40 82 120 82 160 86V100H0z" fill="#0E8F3F" opacity=".55"/>' +
        '<g class="gs-key"><ellipse cx="28" cy="10" rx="34" ry="22" fill="url(#' + l + ')"/></g><g class="gs-key k2"><ellipse cx="146" cy="6" rx="30" ry="18" fill="url(#' + l + ')"/></g>' +
        '<g opacity=".9"><path d="M8 2l10 8M152 1l-8 7" stroke="#0B0B0A" stroke-width="2" stroke-linecap="round" opacity=".55"/><rect x="2" y="-4" width="16" height="9" rx="2" transform="rotate(36 10 0)" fill="#0B0B0A" opacity=".7"/><rect x="144" y="-5" width="16" height="9" rx="2" transform="rotate(-36 152 0)" fill="#0B0B0A" opacity=".7"/></g>' +
        // the keyed-in screen behind the creator
        '<g class="gs-screen"><rect x="70" y="9" width="84" height="58" rx="8" fill="#0B0B0A" opacity=".22"/><rect x="72" y="11" width="80" height="54" rx="6" fill="#fff"/>' +
        '<g clip-path="url(#' + c + ')">' +
          '<g class="gs-s1"><rect x="72" y="11" width="80" height="54" fill="#FBF8F3"/><rect x="72" y="11" width="80" height="9" fill="#EEE9DF"/><circle cx="78" cy="15.5" r="1.6" fill="#FF6159"/><circle cx="83" cy="15.5" r="1.6" fill="#FFBD2E"/><circle cx="88" cy="15.5" r="1.6" fill="#28C840"/><rect x="94" y="13.6" width="40" height="4" rx="2" fill="#fff"/>' +
            '<rect x="78" y="25" width="34" height="5" rx="2.5" fill="' + INK + '"/><rect x="78" y="33" width="26" height="3.4" rx="1.7" fill="' + GREY + '" opacity=".6"/><rect x="78" y="40" width="18" height="7" rx="3.5" fill="' + OR + '"/><rect x="118" y="24" width="28" height="34" rx="4" fill="' + PEACH + '"/><circle cx="132" cy="36" r="6" fill="' + OR + '"/></g>' +
          '<g class="gs-s2"><rect x="72" y="11" width="80" height="54" fill="' + SOFT + '"/><ellipse cx="112" cy="58" rx="22" ry="4" fill="' + INK + '" opacity=".08"/><rect x="101" y="24" width="22" height="34" rx="7" fill="' + OR + '"/><rect x="106" y="17" width="12" height="9" rx="2.5" fill="' + INK + '"/><rect x="105" y="35" width="14" height="11" rx="2" fill="#fff" opacity=".9"/><rect x="108" y="26" width="3" height="30" rx="1.5" fill="#fff" opacity=".3"/>' + star(134, 24, 5, OR, 'sc-tw') + star(88, 46, 3.5, PEACH, 'sc-tw d2') + '</g>' +
          '<g class="gs-s3"><rect x="72" y="11" width="80" height="54" fill="' + INK + '"/><text x="80" y="25" font-size="7" ' + F + ' fill="#fff" opacity=".7">TODAY ONLY</text><g transform="rotate(-8 112 42)"><path d="M92 31h34l8 11-8 11H92a4 4 0 0 1-4-4V35a4 4 0 0 1 4-4z" fill="' + OR + '"/><circle cx="127" cy="42" r="2.4" fill="' + INK + '"/><text x="107" y="46.5" text-anchor="middle" font-size="13" ' + F + ' fill="#fff">-40%</text></g></g>' +
        '</g></g>' +
        '<rect width="160" height="100" fill="url(#' + v + ')"/>' +
        // green spill on the creator's edges, then the creator pointing back at the screen
        '<ellipse cx="38" cy="78" rx="34" ry="30" fill="#6CFF9E" opacity=".16"/>' +
        who('sam', 'idle', 'waving talking pointing', -24, -8, .9) +
        '<g fill="#D7FFE4">' + star(70, 58, 3.2, '#D7FFE4', 'sc-tw') + star(14, 46, 2.4, '#D7FFE4', 'sc-tw d2') + star(60, 86, 2.2, '#D7FFE4', 'sc-tw d3') + '</g>';
    },
    // Host talking into a studio mic
    podcast: function () {
      return '<circle cx="50" cy="50" r="40" fill="' + SOFT + '"/>' + floor + who('kofi', 'idle', 'talking', -26, -23, 1) +
        '<path d="M158 2 120 28 94 44" stroke="' + INK + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<g class="sc-mic"><rect x="82" y="38" width="17" height="30" rx="8.5" fill="' + INK + '"/><path d="M85 47h11M85 52h11M85 57h11" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/><rect x="80" y="66" width="21" height="5" rx="2.5" fill="' + OR + '"/></g>' +
        '<g fill="none" stroke="' + OR + '" stroke-width="3" stroke-linecap="round"><path class="sc-wave" d="M108 44a12 12 0 0 1 0 18"/><path class="sc-wave d2" d="M116 38a20 20 0 0 1 0 30"/><path class="sc-wave d3" d="M124 32a28 28 0 0 1 0 42"/></g>' +
        '<g class="sc-onair"><rect x="104" y="80" width="46" height="15" rx="7.5" fill="' + INK + '"/><circle cx="113" cy="87.5" r="2.6" fill="' + OR + '"/><text x="119" y="91" font-size="7.5" ' + F + ' fill="#fff">ON AIR</text></g>';
    },
    // Product bottle turning on a turntable, with sparkles
    broll: function () {
      var c = id('b');
      return '<defs><clipPath id="' + c + '"><rect x="62" y="30" width="36" height="56" rx="11"/></clipPath></defs>' +
        '<circle cx="80" cy="54" r="38" fill="' + SOFT + '"/>' +
        '<ellipse cx="80" cy="90" rx="44" ry="8" fill="' + LINE + '"/><ellipse cx="80" cy="87" rx="44" ry="8" fill="#fff"/>' +
        '<g class="sc-float"><rect x="62" y="30" width="36" height="56" rx="11" fill="' + OR + '"/><rect x="71" y="16" width="18" height="16" rx="4" fill="' + INK + '"/>' +
        '<g clip-path="url(#' + c + ')"><g class="sc-turn"><rect x="40" y="44" width="22" height="26" rx="3" fill="#fff"/><rect x="44" y="50" width="14" height="3" rx="1.5" fill="' + OR + '"/><rect x="44" y="56" width="10" height="3" rx="1.5" fill="' + PEACH + '"/><rect x="74" y="30" width="7" height="56" fill="#fff" opacity=".28"/><rect x="108" y="44" width="22" height="26" rx="3" fill="#fff"/></g></g>' +
        '<rect x="62" y="30" width="36" height="56" rx="11" fill="none" stroke="' + ORD + '" stroke-opacity=".35" stroke-width="1.5"/></g>' +
        star(124, 26, 9, OR, 'sc-tw') + star(38, 34, 6, PEACH, 'sc-tw d2') + star(130, 64, 5, INK, 'sc-tw d3');
    },
    // A still photo starts to move
    i2v: function () {
      var c = id('p');
      return '<g class="sc-lines" stroke="' + INK + '" stroke-width="3" stroke-linecap="round" opacity=".8"><path d="M14 36h14"/><path class="d2" d="M8 50h20"/><path class="d3" d="M16 64h12"/></g>' +
        '<g class="sc-tilt"><rect x="36" y="12" width="92" height="72" rx="9" fill="#fff" stroke="' + INK + '" stroke-width="2.6"/>' +
        '<defs><clipPath id="' + c + '"><rect x="42" y="18" width="80" height="60" rx="5"/></clipPath></defs><g clip-path="url(#' + c + ')"><rect x="42" y="18" width="80" height="60" fill="' + SOFT + '"/>' +
        '<g class="sc-sun"><circle cx="102" cy="40" r="8" fill="' + OR + '"/></g><g class="sc-cloud"><rect x="50" y="28" width="22" height="7" rx="3.5" fill="#fff"/></g>' +
        '<path d="M42 78 66 50l14 14 12-10 30 24z" fill="' + PEACH + '"/><path class="sc-hill" d="M30 78 58 60l18 10 14-8 40 16z" fill="' + OR + '"/></g></g>' +
        '<g class="sc-pulse"><circle cx="126" cy="80" r="13" fill="' + INK + '"/><path d="M122 74v12l10-6z" fill="#fff"/></g>';
    },
    // Slides flipping in a stack
    slides: function () {
      return '<g transform="rotate(-9 80 52)"><rect x="50" y="18" width="60" height="70" rx="9" fill="#fff" stroke="' + LINE + '" stroke-width="1.5"/></g>' +
        '<g transform="rotate(7 80 52)"><rect x="50" y="18" width="60" height="70" rx="9" fill="' + PEACH + '"/></g>' +
        '<g class="sc-flip"><g class="sc-fa"><rect x="50" y="16" width="60" height="70" rx="9" fill="' + OR + '"/><rect x="58" y="26" width="34" height="7" rx="3.5" fill="#fff"/><rect x="58" y="38" width="44" height="5" rx="2.5" fill="#fff" opacity=".7"/><rect x="58" y="47" width="28" height="5" rx="2.5" fill="#fff" opacity=".7"/><rect x="58" y="66" width="26" height="11" rx="5.5" fill="' + INK + '"/></g>' +
        '<g class="sc-fb"><rect x="50" y="16" width="60" height="70" rx="9" fill="' + INK + '"/><circle cx="96" cy="32" r="6" fill="' + OR + '"/><path d="M50 74l20-20 14 12 10-8 16 14v5a9 9 0 0 1-9 9H59a9 9 0 0 1-9-9z" fill="' + PEACH + '"/><rect x="58" y="24" width="24" height="5" rx="2.5" fill="#fff"/></g></g>' +
        '<g><rect x="62" y="94" width="36" height="4" rx="2" fill="' + LINE + '"/><rect class="sc-dot" x="62" y="94" width="9" height="4" rx="2" fill="' + OR + '"/></g>';
    },
    // Speech bubbles cycling languages
    dub: function () {
      var c = id('g');
      return '<defs><clipPath id="' + c + '"><circle cx="40" cy="62" r="24"/></clipPath></defs>' +
        '<circle cx="40" cy="62" r="24" fill="#fff"/><g clip-path="url(#' + c + ')"><g class="sc-globe" fill="none" stroke="' + INK + '" stroke-width="2"><path d="M16 62h48M12 50h56M12 74h56"/><ellipse cx="40" cy="62" rx="10" ry="24"/><ellipse cx="68" cy="62" rx="10" ry="24"/><ellipse cx="12" cy="62" rx="10" ry="24"/></g><path d="M22 52c6-4 12 0 14 6s-6 8-10 6-8-8-4-12zM46 70c6-2 12 2 10 8s-10 4-12 0 0-6 2-8z" fill="' + PEACH + '"/></g>' +
        '<circle cx="40" cy="62" r="24" fill="none" stroke="' + INK + '" stroke-width="2.6"/>' +
        '<g class="sc-pop"><path d="M58 10h40a10 10 0 0 1 10 10v6a10 10 0 0 1-10 10H70l-8 7v-7h-4a10 10 0 0 1-10-10v-6a10 10 0 0 1 10-10z" fill="' + INK + '"/><text x="78" y="28" text-anchor="middle" font-size="11" ' + F + ' fill="#fff">Hi!</text></g>' +
        '<g class="sc-pop d2"><path d="M86 50h52a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10h-6v8l-9-8H86a10 10 0 0 1-10-10v-8a10 10 0 0 1 10-10z" fill="' + OR + '"/>' +
        '<text class="sc-l1" x="112" y="68.5" text-anchor="middle" font-size="11.5" ' + F + ' fill="#fff">Hola!</text><text class="sc-l2" x="112" y="68.5" text-anchor="middle" font-size="11.5" ' + F + ' fill="#fff">Salut!</text><text class="sc-l3" x="112" y="68.5" text-anchor="middle" font-size="11.5" ' + F + ' fill="#fff">Olá!</text></g>';
    },
    // Scissors snip, new hook clips drop into the first slot
    remix: function () {
      var clip = function (x, f) { return '<rect x="' + x + '" y="58" width="28" height="24" rx="6" fill="' + f + '"/><path d="M' + (x + 11) + ' 65v10l8-5z" fill="#fff" opacity=".55"/>'; };
      return '<rect x="10" y="86" width="140" height="3" rx="1.5" fill="' + LINE + '"/>' + clip(52, '#24231F') + clip(84, '#34322C') + clip(116, '#24231F') +
        '<g class="sc-h1"><rect x="16" y="58" width="30" height="24" rx="6" fill="' + OR + '"/>' + star(31, 70, 6, '#fff') + '</g>' +
        '<g class="sc-h2"><rect x="16" y="58" width="30" height="24" rx="6" fill="' + INK + '" stroke="' + OR + '" stroke-width="2"/>' + star(31, 70, 6, OR) + '</g>' +
        '<g transform="translate(49 30)"><g class="sc-bl1"><path d="M0 0 22-14" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/><circle cx="-6" cy="4" r="6" fill="none" stroke="' + OR + '" stroke-width="3.4"/></g><g class="sc-bl2"><path d="M0 0 22 14" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/><circle cx="-6" cy="-4" r="6" fill="none" stroke="' + OR + '" stroke-width="3.4"/></g></g>' +
        '<path d="M49 48v6" stroke="' + OR + '" stroke-width="2" stroke-dasharray="2 3"/>' +
        '<g class="sc-pop"><rect x="98" y="16" width="48" height="18" rx="9" fill="#fff"/><text x="122" y="28.6" text-anchor="middle" font-size="8.5" ' + F + ' fill="' + OR + '">NEW HOOK</text></g>';
    },
    // Kinetic text on a screen and music notes
    motion: function () {
      var note = function (x, y, cls) { return '<g class="' + cls + '"><path d="M' + x + ' ' + y + 'v-16l12-3v16" stroke="' + INK + '" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="' + (x - 3) + '" cy="' + y + '" r="3.6" fill="' + OR + '"/><circle cx="' + (x + 9) + '" cy="' + (y - 3) + '" r="3.6" fill="' + OR + '"/></g>'; };
      return '<rect x="14" y="12" width="102" height="76" rx="11" fill="' + INK + '"/>' +
        '<g class="sc-kin"><rect x="26" y="24" width="56" height="11" rx="5.5" fill="' + OR + '"/></g><g class="sc-kin d2"><rect x="26" y="40" width="76" height="8" rx="4" fill="#fff"/></g><g class="sc-kin d3"><rect x="26" y="52" width="48" height="8" rx="4" fill="' + GREY + '"/></g>' +
        '<g class="sc-pop d2"><rect x="26" y="68" width="36" height="12" rx="6" fill="#fff"/><path d="M50 74h6M53 71l3 3-3 3" stroke="' + OR + '" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
        '<g fill="' + OR + '"><rect class="sc-eq" x="124" y="70" width="5" height="18" rx="2.5"/><rect class="sc-eq d2" x="132" y="70" width="5" height="18" rx="2.5"/><rect class="sc-eq d3" x="140" y="70" width="5" height="18" rx="2.5"/><rect class="sc-eq d4" x="148" y="70" width="5" height="18" rx="2.5"/></g>' +
        note(130, 46, 'sc-note') + note(126, 36, 'sc-note d2') + star(110, 14, 6, PEACH, 'sc-tw');
    },
    // Change background: a creator cut out with "marching ants" while the wall behind swaps (orange → beach → office).
    bgswap: function () {
      var c = id('bc');
      return '<defs><clipPath id="' + c + '"><rect x="34" y="6" width="92" height="88" rx="12"/></clipPath></defs>' +
        '<rect x="34" y="6" width="92" height="88" rx="12" fill="' + INK + '" opacity=".08" transform="translate(2 3)"/>' +
        '<g clip-path="url(#' + c + ')">' +
          '<g class="bs-b1"><rect x="34" y="6" width="92" height="88" fill="' + OR + '"/><circle cx="104" cy="28" r="18" fill="#FF7A52" opacity=".55"/></g>' +
          '<g class="bs-b2"><rect x="34" y="6" width="92" height="88" fill="#BDE7FF"/><circle cx="108" cy="24" r="8" fill="#FFD25C"/><path d="M34 62q23-6 46 0t46 0V94H34z" fill="#3FA9F5"/><path d="M34 72q23-5 46 0t46 0V94H34z" fill="#F5DDB3"/></g>' +
          '<g class="bs-b3"><rect x="34" y="6" width="92" height="88" fill="#EDE8DF"/><rect x="44" y="14" width="34" height="40" rx="3" fill="#CFE7F7"/><path d="M61 14v40M44 34h34" stroke="#fff" stroke-width="2.4"/><rect x="88" y="20" width="28" height="22" rx="3" fill="' + PEACH + '"/><rect x="34" y="72" width="92" height="22" fill="#D9CDBA"/><rect x="98" y="54" width="6" height="18" rx="2" fill="' + INK + '" opacity=".6"/><circle cx="101" cy="50" r="7" fill="#5DBB63"/></g>' +
          who('maya', 'idle', 'talking', 28, -8, .74) +
        '</g>' +
        '<g class="bs-ants" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3"><path d="M58 94C58 74 66 66 80 66C94 66 102 74 102 94M70 66V58M90 66V58"/><ellipse cx="80" cy="42" rx="13" ry="15"/></g>' +
        '<rect x="34" y="6" width="92" height="88" rx="12" fill="none" stroke="' + INK + '" stroke-width="2.4"/>' +
        '<g class="bs-wand"><path d="M132 74 146 60" stroke="' + INK + '" stroke-width="3.4" stroke-linecap="round"/><path d="M146 60l3-3" stroke="' + OR + '" stroke-width="3.4" stroke-linecap="round"/>' + star(150, 52, 5, OR, 'sc-tw') + star(140, 46, 3, PEACH, 'sc-tw d2') + '</g>' +
        '<g class="sc-pop"><rect x="4" y="16" width="34" height="15" rx="7.5" fill="#fff"/><circle cx="12" cy="23.5" r="3.4" fill="' + OR + '"/><circle cx="19" cy="23.5" r="3.4" fill="#3FA9F5"/><circle cx="26" cy="23.5" r="3.4" fill="#5DBB63"/></g>';
    },
    // Auto-edit: a 9:16 preview with word-by-word captions; the timeline below snips out a silent gap and closes it.
    autoedit: function () {
      var bars = function (x0, n, cls) { var h = ''; for (var i = 0; i < n; i++) { var v = [6, 10, 4, 12, 8, 5, 11, 7][i % 8]; h += '<rect x="' + (x0 + i * 4) + '" y="' + (80 - v / 2) + '" width="2.4" height="' + v + '" rx="1.2" fill="' + (cls || INK) + '"/>'; } return h; };
      return '<rect x="12" y="6" width="44" height="78" rx="9" fill="' + INK + '"/>' +
        '<circle cx="34" cy="34" r="12" fill="' + PEACH + '"/><path d="M22 66c2-10 8-14 12-14s10 4 12 14z" fill="' + OR + '"/><circle cx="34" cy="31" r="9" fill="#F2C9A8"/><path d="M25 29c0-8 18-8 18 0-3-3-15-3-18 0z" fill="' + INK + '"/>' +
        '<g class="ae-cap"><rect x="16" y="56" width="36" height="12" rx="6" fill="#fff"/><text class="ae-w1" x="34" y="64.6" text-anchor="middle" font-size="7.2" ' + F + ' fill="' + INK + '">SO <tspan fill="' + OR + '">GOOD</tspan></text><text class="ae-w2" x="34" y="64.6" text-anchor="middle" font-size="7.2" ' + F + ' fill="' + INK + '"><tspan fill="' + OR + '">TRY</tspan> IT</text></g>' +
        '<g class="ae-zoom"><rect x="14" y="8" width="40" height="74" rx="8" fill="none" stroke="' + OR + '" stroke-width="1.6" stroke-dasharray="4 3" opacity=".8"/></g>' +
        '<rect x="64" y="66" width="90" height="28" rx="8" fill="#fff" stroke="' + LINE + '" stroke-width="1.4"/>' +
        '<g class="ae-left">' + bars(70, 7) + '</g>' +
        '<g class="ae-gap"><rect x="99" y="72" width="18" height="16" rx="3" fill="' + LINE + '"/><path d="M103 80h10" stroke="' + GREY + '" stroke-width="1.6" stroke-dasharray="2 2"/></g>' +
        '<g class="ae-right">' + bars(120, 8, OR) + '</g>' +
        '<g class="ae-head"><rect x="68" y="62" width="2" height="34" rx="1" fill="' + OR + '"/><circle cx="69" cy="62" r="2.6" fill="' + OR + '"/></g>' +
        '<g class="ae-snip" transform="translate(108 52)"><g class="sc-bl1"><path d="M0 0 9-9" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/><circle cx="-3" cy="3" r="3.4" fill="none" stroke="' + OR + '" stroke-width="2.2"/></g><g class="sc-bl2"><path d="M0 0 9 9" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/><circle cx="-3" cy="-3" r="3.4" fill="none" stroke="' + OR + '" stroke-width="2.2"/></g></g>' +
        '<g class="sc-pop d2"><rect x="70" y="14" width="56" height="16" rx="8" fill="#fff"/><text x="98" y="25" text-anchor="middle" font-size="7.6" ' + F + ' fill="' + INK + '">−12s silence</text></g>' +
        '<g class="sc-pop"><rect x="92" y="36" width="58" height="16" rx="8" fill="' + INK + '"/><text x="121" y="47" text-anchor="middle" font-size="7.6" ' + F + ' fill="#fff">Hook first ↑</text></g>';
    },
    // Brand music: a spinning record, notes floating up and a sung brand name popping out.
    jingle: function () {
      var note = function (x, y, cls) { return '<g class="' + cls + '"><path d="M' + x + ' ' + y + 'v-14l11-3v14" stroke="' + INK + '" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="' + (x - 3) + '" cy="' + y + '" r="3.4" fill="' + OR + '"/><circle cx="' + (x + 8) + '" cy="' + (y - 3) + '" r="3.4" fill="' + OR + '"/></g>'; };
      return '<circle cx="56" cy="54" r="42" fill="' + SOFT + '"/>' +
        '<g class="jg-spin"><circle cx="56" cy="54" r="34" fill="' + INK + '"/><circle cx="56" cy="54" r="27" fill="none" stroke="#34322C" stroke-width="1.2"/><circle cx="56" cy="54" r="21" fill="none" stroke="#34322C" stroke-width="1.2"/><path d="M34 40a26 26 0 0 1 14-10" stroke="#fff" stroke-opacity=".25" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="56" cy="54" r="12" fill="' + OR + '"/><text x="56" y="56.6" text-anchor="middle" font-size="6.4" ' + F + ' fill="#fff">YOU</text><circle cx="56" cy="54" r="1.8" fill="' + INK + '"/></g>' +
        '<g class="jg-arm"><path d="M104 14 92 34" stroke="' + GREY + '" stroke-width="3" stroke-linecap="round"/><circle cx="104" cy="14" r="4" fill="' + INK + '"/><rect x="87" y="32" width="8" height="5" rx="1.5" fill="' + INK + '" transform="rotate(-30 91 34)"/></g>' +
        '<g fill="' + OR + '"><rect class="sc-eq" x="104" y="74" width="5" height="18" rx="2.5"/><rect class="sc-eq d2" x="112" y="74" width="5" height="18" rx="2.5"/><rect class="sc-eq d3" x="120" y="74" width="5" height="18" rx="2.5"/><rect class="sc-eq d4" x="128" y="74" width="5" height="18" rx="2.5"/><rect class="sc-eq d2" x="136" y="74" width="5" height="18" rx="2.5"/></g>' +
        note(116, 50, 'sc-note') + note(134, 40, 'sc-note d2') +
        '<g class="jg-sing"><path d="M100 8h48a8 8 0 0 1 8 8v6a8 8 0 0 1-8 8h-30l-8 6v-6h-10a8 8 0 0 1-8-8v-6a8 8 0 0 1 8-8z" fill="' + OR + '"/><text x="124" y="22.4" text-anchor="middle" font-size="8.6" ' + F + ' fill="#fff">♪ your brand</text></g>';
    },
  };
  var KIND = function (t) {
    var i = String(t.id || ''), p = t.pipeline;
    if (/green/.test(i)) return 'green';
    if (/podcast/.test(i)) return 'podcast';
    return { ugc: 'ugc', video: 'broll', image_to_video: 'i2v', slideshow: 'slides', dub: 'dub', hook_remix: 'remix', motion_ad: 'motion', bg_swap: 'bgswap', auto_edit: 'autoedit', brand_music: 'jingle' }[p] || 'broll';
  };
  function typeScene(t) {
    var k = typeof t === 'string' ? t : KIND(t);
    var full = k === 'green';
    return '<svg class="tn tsc-svg' + (full ? ' full' : '') + '" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid ' + (full ? 'slice' : 'meet') + '" aria-hidden="true">' + (S[k] || S.broll)() + '</svg>';
  }

  // Payment marks: a bank card, or a coin stack for crypto.
  function payMark(kind) {
    if (kind === 'crypto') return '<svg class="tn pm-mark" viewBox="0 0 48 40" aria-hidden="true"><ellipse cx="24" cy="36" rx="16" ry="3" fill="' + INK + '" opacity=".08"/>' +
      [0, 1, 2].map(function (i) { return '<ellipse cx="24" cy="' + (31 - i * 7) + '" rx="14" ry="5" fill="' + ORD + '"/><ellipse cx="24" cy="' + (28 - i * 7) + '" rx="14" ry="5" fill="' + OR + '"/>'; }).join('') +
      '<g class="pm-drop"><ellipse cx="24" cy="9" rx="14" ry="5" fill="' + ORD + '"/><ellipse cx="24" cy="6" rx="14" ry="5" fill="#FF8A5C"/><ellipse cx="24" cy="6" rx="7" ry="2.2" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/></g></svg>';
    if (kind === 'card') return '<svg class="tn pm-mark" viewBox="0 0 48 40" aria-hidden="true"><g class="pm-back"><rect x="10" y="4" width="34" height="23" rx="5" fill="' + PEACH + '"/></g>' +
      '<g class="pm-card"><rect x="4" y="12" width="36" height="24" rx="5" fill="' + INK + '"/><rect x="4" y="17" width="36" height="5" fill="#34322C"/><rect x="9" y="25" width="8" height="6" rx="1.6" fill="' + PEACH + '"/><rect x="21" y="27" width="14" height="2.6" rx="1.3" fill="#fff" opacity=".5"/><circle cx="33" cy="15" r="1.6" fill="' + OR + '"/></g></svg>';
    return '<svg class="tn pm-mark" viewBox="0 0 48 40" aria-hidden="true"><rect x="6" y="8" width="36" height="26" rx="6" fill="' + INK + '"/><rect x="26" y="16" width="16" height="10" rx="4" fill="' + OR + '"/></svg>';
  }

  // Small cheering character for success states.
  function cheer(w) {
    return '<svg class="tn sc-cheer" viewBox="0 0 160 126" aria-hidden="true"><ellipse cx="80" cy="121" rx="40" ry="4.5" fill="' + INK + '" opacity=".1"/>' +
      '<circle cx="80" cy="66" r="44" fill="' + SOFT + '"/>' + star(30, 30, 8, OR, 'sc-tw') + star(134, 40, 6, PEACH, 'sc-tw d2') + star(126, 92, 5, INK, 'sc-tw d3') +
      who(w || 'maya', 'idle', 'cheer', 36.6, 12, .62) + '</svg>';
  }

  // Pause scene motion while it is off screen.
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('off', !e.isIntersecting); }); }, { rootMargin: '60px' }) : null;
  function watch(root) { if (!io || !root) return; Array.prototype.forEach.call(root.querySelectorAll('.tsc'), function (el) { io.observe(el); }); }

  TN.typeScene = typeScene; TN.sceneKind = KIND; TN.payMark = payMark; TN.cheer = cheer; TN.watchScenes = watch;
})();
