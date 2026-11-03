// VooToons: the Vooads cartoon cast and drawn icon set (flat people, duotone icons, small animated scenes).
// Everything is inline SVG. Motion lives in /assets/css/toons.css and only animates transform and opacity.
// Colours stay in the Vooads family: ink, orange, peach and warm off-whites.
(function () {
  'use strict';
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var INK = '#0B0B0A', OR = '#FF4A1C', ORD = '#C9370F', PEACH = '#FFB59E', CREAM = '#F7F3EC';
  var SKINS = ['#8D5524', '#C68642', '#5C3A1E', '#E0AC69', '#3B2219', '#A86B3C', '#F1C27D', '#6B4226'];
  var HAIRC = ['#1B120C', '#3B2219', '#6B4226', '#C9A227', '#9AA3AD'];
  var SHIRTS = [OR, INK, PEACH, '#E9DFCF', '#34322C', '#9C2A08', '#F2A23A', '#FFFFFF'];
  var BGS = ['#FFEDE6', '#F3EEE4', '#FFE3D6', '#EFEDE6', '#FFF4EC', '#F6E7DA'];
  var uid = 0;
  var nid = function (p) { return (p || 'tn') + (++uid); };

  // Named cast. Support agents, the studio crew and Coach Vee.
  var CAST = {
    ada: { skin: 2, hair: 5, hc: 0, eyes: 1, mouth: 1, acc: 2, shirt: OR, bg: '#FFEDE6' },
    tolu: { skin: 0, hair: 0, hc: 0, eyes: 0, mouth: 0, acc: 1, shirt: INK, bg: '#F3EEE4' },
    sam: { skin: 3, hair: 1, hc: 1, eyes: 0, mouth: 1, acc: 0, shirt: PEACH, bg: '#FFE3D6' },
    kofi: { skin: 4, hair: 3, hc: 0, eyes: 0, mouth: 0, acc: 4, shirt: '#34322C', bg: '#EFEDE6' },
    maya: { skin: 1, hair: 1, hc: 0, eyes: 1, mouth: 1, acc: 2, shirt: OR, bg: '#FFEDE6' },
    leo: { skin: 6, hair: 0, hc: 2, eyes: 0, mouth: 0, acc: 3, shirt: INK, cap: OR, bg: '#FFF4EC' },
    vee: { skin: 0, hair: 2, hc: 0, eyes: 0, mouth: 1, acc: 5, shirt: OR, bg: '#FFE3D6' },
  };
  function hash(s) { var h = 7; String(s).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) | 0; }); return Math.abs(h); }
  function look(seed) {
    if (seed && typeof seed === 'object') return seed;
    if (typeof seed === 'string' && CAST[seed.toLowerCase()]) return CAST[seed.toLowerCase()];
    var h = typeof seed === 'number' ? Math.abs(seed) * 2654435761 >>> 0 : hash(seed);
    return { skin: h % 8, hair: (h >> 3) % 6, hc: (h >> 6) % 4, eyes: (h >> 9) % 2, mouth: (h >> 11) % 2, acc: [0, 0, 1, 2][(h >> 13) % 4], shirt: SHIRTS[(h >> 15) % 7], bg: BGS[(h >> 18) % 6] };
  }

  /* ---------- head (64 x 64 box, face centred on 32,30) ---------- */
  function head(L) {
    var skin = SKINS[L.skin % 8], hc = HAIRC[(L.hc || 0) % 5];
    var back = [
      '',
      '<path d="M15 33C12 12 52 12 49 33L48 50C42 53 22 53 16 50Z" fill="' + hc + '"/>',
      '<circle cx="32" cy="11" r="7.5" fill="' + hc + '"/><path d="M26.5 14.5h11" stroke="' + OR + '" stroke-width="2.4" stroke-linecap="round"/>',
      '<circle cx="32" cy="20" r="17" fill="' + hc + '"/><circle cx="18.5" cy="25" r="9" fill="' + hc + '"/><circle cx="45.5" cy="25" r="9" fill="' + hc + '"/><circle cx="23" cy="12.5" r="8" fill="' + hc + '"/><circle cx="41" cy="12.5" r="8" fill="' + hc + '"/>',
      '',
      '<g fill="' + hc + '"><rect x="14.5" y="24" width="5" height="26" rx="2.5"/><rect x="18.5" y="27" width="4.6" height="25" rx="2.3"/><rect x="41" y="27" width="4.6" height="25" rx="2.3"/><rect x="44.5" y="24" width="5" height="26" rx="2.5"/></g><circle cx="17" cy="50" r="2.2" fill="' + OR + '"/><circle cx="47" cy="50" r="2.2" fill="' + OR + '"/>',
    ][L.hair % 6];
    var front = [
      '<path d="M18.4 28C17.6 13.5 46.4 13.5 45.6 28C42 20 22 20 18.4 28Z" fill="' + hc + '"/>',
      '<path d="M18.6 27C19.5 14.5 44.5 14.5 45.4 27C41 20.5 30 19.5 18.6 27Z" fill="' + hc + '"/>',
      '<path d="M18.5 27C19 15 45 15 45.5 27C41 20.5 23 20.5 18.5 27Z" fill="' + hc + '"/>',
      '<path d="M19 25.5C20.5 16.5 43.5 16.5 45 25.5C40 21 24 21 19 25.5Z" fill="' + hc + '"/>',
      '<path d="M19.5 25.5C20 16.5 44 16.5 44.5 25.5C40 21.5 24 21.5 19.5 25.5Z" fill="' + hc + '" opacity=".92"/>',
      '<path d="M18 27C18 14.5 46 14.5 46 27C42 21.5 34 20.5 32 18.5C30 20.5 22 21.5 18 27Z" fill="' + hc + '"/>',
    ][L.hair % 6];
    var eyes = [
      '<ellipse cx="27" cy="31" rx="1.75" ry="2.1" fill="#140C08"/><ellipse cx="37" cy="31" rx="1.75" ry="2.1" fill="#140C08"/><circle cx="27.6" cy="30.3" r=".55" fill="#fff"/><circle cx="37.6" cy="30.3" r=".55" fill="#fff"/>',
      '<path d="M24.9 31.6q2.1-2.6 4.2 0M34.9 31.6q2.1-2.6 4.2 0" stroke="#140C08" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    ][(L.eyes || 0) % 2];
    var mouth = [
      '<path d="M27.6 37.2Q32 41.2 36.4 37.2" stroke="#3A1F14" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      '<path d="M27 36.6Q32 43.4 37 36.6Z" fill="#3A1F14"/><path d="M28.4 37.3h7.2" stroke="#fff" stroke-width="1.2"/>',
    ][(L.mouth || 0) % 2];
    var cap = L.cap || L.shirt || OR;
    var acc = [
      '',
      '<g fill="none" stroke="' + INK + '" stroke-width="1.6"><circle cx="27" cy="31" r="4.5"/><circle cx="37" cy="31" r="4.5"/><path d="M31.5 31h1M22.5 30.4l-3-.9M41.5 30.4l3-.9"/></g><path d="M24.6 29.2l1.6-1.4M34.6 29.2l1.6-1.4" stroke="#fff" stroke-width="1" opacity=".8"/>',
      '<circle cx="19.2" cy="36" r="1.8" fill="' + OR + '"/><circle cx="44.8" cy="36" r="1.8" fill="' + OR + '"/>',
      '<path d="M17.8 23.4C17.8 12 46.2 12 46.2 23.4z" fill="' + cap + '"/><path d="M44 22.6h9.5" stroke="' + cap + '" stroke-width="3.4" stroke-linecap="round"/><circle cx="32" cy="13.6" r="1.4" fill="' + INK + '"/>',
      '<path d="M17.6 30C17 11.5 47 11.5 46.4 30" stroke="' + INK + '" stroke-width="2.8" fill="none"/><rect x="14.4" y="25.5" width="6.4" height="11" rx="3.2" fill="' + INK + '"/><rect x="43.2" y="25.5" width="6.4" height="11" rx="3.2" fill="' + INK + '"/><rect x="16.4" y="28" width="2.4" height="6" rx="1.2" fill="' + OR + '"/><rect x="45.2" y="28" width="2.4" height="6" rx="1.2" fill="' + OR + '"/>',
      '<g fill="none" stroke="' + INK + '" stroke-width="1.8"><rect x="22" y="27.2" width="9.4" height="7.6" rx="3"/><rect x="32.6" y="27.2" width="9.4" height="7.6" rx="3"/><path d="M31.4 30.6h1.2"/></g><circle cx="19.2" cy="36.4" r="1.9" fill="' + OR + '"/><circle cx="44.8" cy="36.4" r="1.9" fill="' + OR + '"/>',
    ][(L.acc || 0) % 6];
    return back +
      '<circle cx="19" cy="32" r="3.1" fill="' + skin + '"/><circle cx="45" cy="32" r="3.1" fill="' + skin + '"/>' +
      '<ellipse cx="32" cy="30" rx="13" ry="15" fill="' + skin + '"/>' + front +
      '<path d="M24.6 25.6q2.4-1.5 4.8 0M34.6 25.6q2.4-1.5 4.8 0" stroke="' + hc + '" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>' +
      '<g class="tn-blink">' + eyes + '</g>' +
      '<path d="M32 32.6v2" stroke="#000" stroke-opacity=".16" stroke-width="1.5" stroke-linecap="round"/>' +
      '<circle cx="24.2" cy="35.6" r="2.3" fill="' + OR + '" opacity=".16"/><circle cx="39.8" cy="35.6" r="2.3" fill="' + OR + '" opacity=".16"/>' +
      '<g class="tn-mouth"><g class="tn-mc">' + mouth + '</g><g class="tn-mo"><ellipse cx="32" cy="38.3" rx="3" ry="2.5" fill="#3A1F14"/><ellipse cx="32" cy="39.5" rx="1.7" ry=".9" fill="#FF8A6B"/></g></g>' + acc;
  }

  /* Round face avatar. seed: a cast name ('ada'), any string/number, or a look object. */
  function avatar(seed, opts) {
    opts = opts || {};
    var L = look(seed), id = nid('av'), skin = SKINS[L.skin % 8], bg = opts.bg || L.bg || BGS[0];
    var sz = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '';
    var d = (hash(seed && seed.skin !== undefined ? JSON.stringify(seed) : String(seed)) % 40) / 10;
    return '<svg class="tn tn-av' + (opts.talk ? ' talking' : '') + '" viewBox="0 0 64 64"' + sz + ' aria-hidden="true" style="--d:-' + d + 's"><defs><clipPath id="' + id + '"><circle cx="32" cy="32" r="32"/></clipPath></defs><g clip-path="url(#' + id + ')"><rect width="64" height="64" fill="' + bg + '"/>' +
      '<path d="M8 67C10 51 21 46 32 46C43 46 54 51 56 67Z" fill="' + (L.shirt || OR) + '"/><path d="M27 46.5 32 52l5-5.5" fill="#fff" opacity=".22"/><rect x="27.5" y="38" width="9" height="9" rx="3" fill="' + skin + '"/>' +
      head(L) + '</g></svg>';
  }

  /* ---------- people (140 x 170 local box, head centred near 70,67) ---------- */
  var sleeve = function (d, c, cls) { return '<path class="' + (cls || '') + '" d="' + d + '" stroke="' + c + '" stroke-width="13" fill="none" stroke-linecap="round"/>'; };
  var hand = function (x, y, skin, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + (r || 6.5) + '" fill="' + skin + '"/>'; };
  function arms(pose, shirt, skin) {
    var L = '', R = '';
    if (pose === 'type') {
      L = '<g class="tn-type">' + sleeve('M46 126Q34 144 50 156', shirt) + hand(52, 156, skin) + '</g>';
      R = '<g class="tn-type r">' + sleeve('M94 126Q106 144 90 156', shirt) + hand(88, 156, skin) + '</g>';
    } else if (pose === 'hold') {
      L = '<g class="tn-gest">' + sleeve('M46 126Q28 128 30 106', shirt) + hand(30, 101, skin, 7) + '<path d="M25.5 96.5v-5M30 95v-6M34.5 96.5v-5" stroke="' + skin + '" stroke-width="3.2" stroke-linecap="round"/></g>';
      R = '<g class="tn-holdp"><g transform="rotate(-8 82 128)"><rect x="73" y="104" width="17" height="34" rx="5" fill="' + OR + '"/><rect x="76.5" y="97" width="10" height="9" rx="2.5" fill="' + INK + '"/><rect x="76" y="114" width="11" height="12" rx="2.5" fill="' + CREAM + '"/><path d="M78.5 118.5h6M78.5 122h4" stroke="' + OR + '" stroke-width="1.6" stroke-linecap="round"/><path d="M76 108v24" stroke="#fff" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round"/></g>' + sleeve('M94 126Q104 146 86 140', shirt) + hand(84, 138, skin, 7) + '</g>';
    } else if (pose === 'film') {
      L = '<g class="tn-filmp">' + sleeve('M46 126Q30 120 20 104', shirt) + sleeve('M94 126Q66 120 32 108', shirt) +
        '<g transform="rotate(-12 18 92)"><rect x="6" y="74" width="22" height="38" rx="5" fill="' + INK + '"/><rect x="8.5" y="77" width="17" height="30" rx="3" fill="#34322C"/><circle class="tn-rec" cx="12.5" cy="81" r="2.2" fill="' + OR + '"/><circle cx="21" cy="81" r="2.4" fill="none" stroke="#6B6860" stroke-width="1.2"/></g>' +
        hand(21, 104, skin, 6.5) + hand(31, 108, skin, 6.5) + '</g>';
      R = '';
    } else {
      L = '<g>' + sleeve('M46 126Q36 146 46 166', shirt) + '</g>';
      R = '<g>' + sleeve('M94 126Q104 146 94 166', shirt) + '</g>';
    }
    var wave = '<g class="tn-arw"><g class="tn-wv">' + sleeve('M94 126Q113 112 114 90', shirt) + hand(114, 84, skin, 7.5) + '</g></g>';
    var cheer = '<g class="tn-ac"><g class="tn-ch l">' + sleeve('M46 126Q28 108 32 86', shirt) + hand(32, 80, skin, 7.5) + '</g><g class="tn-ch r">' + sleeve('M94 126Q112 108 108 86', shirt) + hand(108, 80, skin, 7.5) + '</g></g>';
    return '<g class="tn-al">' + L + '</g><g class="tn-ar">' + R + '</g>' + wave + cheer;
  }
  /* person({ who: 'maya', pose: 'type'|'hold'|'film'|'idle', cls, d }) → a <g> in the 140 x 170 box. */
  function person(o) {
    o = o || {};
    var L = look(o.who || o.seed || 1), skin = SKINS[L.skin % 8], shirt = o.shirt || L.shirt || OR;
    var shade = shirt === INK ? '#24231F' : 'rgba(0,0,0,.08)';
    return '<g class="tn-p ' + (o.cls || '') + '" style="--d:' + (o.d || 0) + 's"><g class="tn-body">' +
      '<path d="M28 174C30 126 47 109 70 109C93 109 110 126 112 174Z" fill="' + shirt + '"/>' +
      '<path d="M50 118C58 124 82 124 90 118" stroke="' + shade + '" stroke-width="2" fill="none"/>' +
      '<path d="M61 109 70 122 79 109" fill="#fff" opacity=".22"/>' +
      '<rect x="62" y="93" width="16" height="19" rx="6" fill="' + skin + '"/><path d="M62 104q8 5 16 0" stroke="#000" stroke-opacity=".12" stroke-width="3"/>' +
      '<g class="tn-head"><g transform="translate(25.2 25) scale(1.4)">' + head(L) + '</g></g>' +
      arms(o.pose || 'idle', shirt, skin) + '</g></g>';
  }

  /* ---------- Coach Vee (180 x 210 box) ---------- */
  function coachG(o) {
    o = o || {};
    var L = CAST.vee, skin = SKINS[L.skin];
    return '<g class="tn-p tn-coach ' + (o.cls || '') + '"><g class="tn-body">' +
      '<path d="M36 214C38 150 58 128 90 128C122 128 142 150 144 214Z" fill="' + OR + '"/>' +
      '<path d="M74 128 90 160 106 128Z" fill="' + CREAM + '"/><path d="M74 128 86 214M106 128 94 214" stroke="' + ORD + '" stroke-width="2.4" opacity=".55"/>' +
      '<circle cx="100" cy="176" r="2.6" fill="' + CREAM + '"/><circle cx="101" cy="192" r="2.6" fill="' + CREAM + '"/>' +
      '<rect x="80" y="110" width="20" height="22" rx="7" fill="' + skin + '"/>' +
      '<g class="tn-head tn-nod"><g transform="translate(43 38) scale(1.47)">' + head(L) + '</g></g>' +
      // marker hand at the waist
      '<g class="tn-al">' + sleeve('M130 146Q148 172 126 186', OR) + '<rect x="114" y="176" width="22" height="7" rx="3.5" fill="' + INK + '" transform="rotate(-24 125 180)"/><rect x="132" y="168" width="5" height="7" rx="2" fill="' + OR + '" transform="rotate(-24 125 180)"/>' + hand(124, 186, skin, 7.5) + '</g>' +
      // pointer arm towards the board on the left
      '<g class="tn-point"><path d="M50 146Q28 140 18 122" stroke="' + OR + '" stroke-width="15" fill="none" stroke-linecap="round"/>' +
      '<path d="M16 118 -64 64" stroke="#7A5230" stroke-width="3.6" stroke-linecap="round"/><circle cx="-64" cy="64" r="4.2" fill="' + OR + '"/>' + hand(17, 117, skin, 8) + '</g>' +
      '</g></g>';
  }
  function coach(opts) {
    opts = opts || {};
    return '<svg class="tn tn-coachsvg' + (opts.talk ? ' talking' : '') + '" viewBox="-70 0 250 214" aria-hidden="true">' + coachG(opts) + '</svg>';
  }
  function coachFace(size, opts) { return avatar('vee', { size: size, talk: opts && opts.talk }); }

  /* ---------- duotone icons (24 box): s = ink stroke, a = accent fill, t = soft tint ---------- */
  var IC = {
    home: '<path class="t" d="M4.5 10.5 12 4.6l7.5 5.9V20h-15z"/><path class="s" d="M3.2 10.6 12 3.8l8.8 6.8M5.5 9.2V20h13V9.2"/><rect class="a" x="9.8" y="13" width="4.4" height="7" rx="1.4"/>',
    ads: '<rect class="t" x="7.5" y="2.8" width="13" height="15.5" rx="3"/><rect class="s" x="3.5" y="6.2" width="13" height="15.3" rx="3"/><path class="a" d="M8.4 10.8v6.4l5.2-3.2z"/>',
    learn: '<path class="t" d="M12 7.6C9.4 5.9 6.4 5.5 3.4 6.3v12.4c3-.8 6-.4 8.6 1.3z"/><path class="s" d="M12 7.6C9.4 5.9 6.4 5.5 3.4 6.3v12.4c3-.8 6-.4 8.6 1.3 2.6-1.7 5.6-2.1 8.6-1.3V6.3c-3-.8-6-.4-8.6 1.3zM12 7.6V20"/><path class="a" d="M15 5.4v6.4l1.7-1.2 1.7 1.2V5.1z"/>',
    credits: '<ellipse class="t" cx="12" cy="16.2" rx="7" ry="2.9"/><path class="s" d="M5 7.3v4.5c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V7.3M5 11.8v4.4c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-4.4"/><ellipse class="a" cx="12" cy="7.3" rx="7" ry="2.9"/><path d="M10 7.3h4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    create: '<path class="s" d="M12 5.5v13M5.5 12h13"/><path class="a" d="M18.6 2.6l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>',
    support: '<path class="t" d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20l1.4-5A8 8 0 1 1 20.5 11.5z"/><path class="s" d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20l1.4-5A8 8 0 1 1 20.5 11.5z"/><circle class="a" cx="8.5" cy="11.5" r="1.3"/><circle class="a" cx="12.5" cy="11.5" r="1.3"/><circle class="a" cx="16.5" cy="11.5" r="1.3"/>',
    hooks: '<circle class="t" cx="9.3" cy="14.2" r="5.6"/><circle class="s" cx="14" cy="4.3" r="1.6"/><path class="s" d="M14 5.9v8.3a4.6 4.6 0 0 1-9.2 0v-2.6l2.6 2.3"/><path class="a" d="M17.6 8.2c1.9.4 3 1.8 2.7 3.4-.3 1.5-1.8 2.3-3.4 2-.5-.1-.7-.6-.4-1 .7-1 .8-2.5.4-3.6-.2-.5.2-.9.7-.8z"/>',
    video: '<rect class="t" x="3.5" y="10" width="17" height="10.5" rx="2.4"/><rect class="s" x="3.5" y="10" width="17" height="10.5" rx="2.4"/><path class="a" d="M3.6 9.2 19.2 4.9l1.1 3.6L4.7 12.8z"/><path d="M8.4 7.9l1.8 2.9M13.1 6.6l1.8 2.9" stroke="#fff" stroke-width="1.5" fill="none"/><path class="s" d="m10.4 13.2 3.8 2.1-3.8 2.1z"/>',
    image: '<path class="t" d="M3.5 17.5l5-5.2 4 4 2.6-2.6 5.4 5.3v.5a2.5 2.5 0 0 1-2.5 2.5h-12a2.5 2.5 0 0 1-2.5-2.5z"/><rect class="s" x="3.5" y="4.5" width="17" height="15" rx="3"/><circle class="a" cx="15.6" cy="9.2" r="2.1"/>',
    shield: '<path class="t" d="M12 3l7.5 3v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6z"/><path class="s" d="M12 3l7.5 3v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6z"/><path d="m8.6 12 2.4 2.4 4.6-4.8" stroke="var(--tn-ac,#FF4A1C)" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    ugc: '<rect class="t" x="6.5" y="2.5" width="11" height="19" rx="2.6"/><rect class="s" x="6.5" y="2.5" width="11" height="19" rx="2.6"/><circle class="a" cx="12" cy="9.6" r="2.5"/><path class="s" d="M8.8 16.4c.7-1.7 1.8-2.5 3.2-2.5s2.5.8 3.2 2.5"/>',
    spark: '<path class="a" d="M10 3.5l1.7 4.6 4.6 1.7-4.6 1.7L10 16.1l-1.7-4.6L3.7 9.8l4.6-1.7z"/><path class="s" d="M17.5 13.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
    slides: '<rect class="t" x="7" y="3.5" width="13.5" height="12" rx="2.4"/><rect class="s" x="3.5" y="7.5" width="13.5" height="12.5" rx="2.4"/><rect class="a" x="6.5" y="15.2" width="7.5" height="2.2" rx="1.1"/>',
    target: '<circle class="t" cx="12" cy="12" r="8.5"/><circle class="s" cx="12" cy="12" r="8.5"/><circle class="s" cx="12" cy="12" r="4.6"/><circle class="a" cx="12" cy="12" r="2"/>',
    script: '<path class="t" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path class="s" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8.8 17h4.4"/><rect class="a" x="8.4" y="11.6" width="7.4" height="2.4" rx="1.2"/>',
    gift: '<rect class="t" x="4" y="11.5" width="16" height="9" rx="1.6"/><path class="s" d="M20 12v8.5H4V12M2.8 7.8h18.4v4.2H2.8z"/><path class="a" d="M10.6 7.8h2.8v12.7h-2.8zM12 7.6C10.8 4 8.4 2.9 7.2 4.2 6 5.5 7.6 7.6 12 7.6zM12 7.6c1.2-3.6 3.6-4.7 4.8-3.4 1.2 1.3-.4 3.4-4.8 3.4z"/>',
    grid: '<rect class="a" x="3.5" y="3.5" width="7" height="7" rx="2"/><rect class="t" x="13.5" y="3.5" width="7" height="7" rx="2"/><rect class="s" x="13.5" y="3.5" width="7" height="7" rx="2"/><rect class="s" x="3.5" y="13.5" width="7" height="7" rx="2"/><rect class="t" x="13.5" y="13.5" width="7" height="7" rx="2"/><rect class="s" x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    settings: '<circle class="t" cx="12" cy="12" r="7"/><path class="s" d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M5.8 18.2l1.7-1.7M16.5 7.5l1.7-1.7"/><circle class="s" cx="12" cy="12" r="5.4"/><circle class="a" cx="12" cy="12" r="2.2"/>',
    wallet: '<rect class="t" x="3" y="6" width="18" height="14" rx="3"/><rect class="s" x="3" y="6" width="18" height="14" rx="3"/><path class="s" d="M3 10h13"/><rect class="a" x="14.5" y="12.2" width="6.5" height="4.6" rx="2.3"/>',
    mic: '<rect class="a" x="9" y="3" width="6" height="11" rx="3"/><path class="s" d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    remix: '<path class="s" d="M4 7.5h11l-3-3M20 16.5H9l3 3"/><circle class="a" cx="19" cy="7.5" r="2.2"/><circle class="t" cx="5" cy="16.5" r="2.6"/><circle class="s" cx="5" cy="16.5" r="2.2"/>',
    imgvid: '<rect class="t" x="3" y="4" width="13" height="12" rx="2.2"/><rect class="s" x="3" y="4" width="13" height="12" rx="2.2"/><circle class="a" cx="7.6" cy="8.4" r="1.6"/><path class="a" d="M17.5 10.5l3.5-1.9v7.8l-3.5-1.9z"/><path class="s" d="m16 13-3.4-3.4L6 16"/>',
    play: '<circle class="t" cx="12" cy="12" r="9"/><path class="a" d="M10 8.3v7.4l6-3.7z"/>',
    lock: '<rect class="t" x="5" y="10.5" width="14" height="10" rx="2.5"/><rect class="s" x="5" y="10.5" width="14" height="10" rx="2.5"/><path class="s" d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle class="a" cx="12" cy="15.5" r="1.8"/>',
  };
  var ALIAS = { library: 'ads', plus: 'create', headset: 'support', film: 'video', chat: 'support' };
  function icon(name, size, cls) {
    var k = ALIAS[name] || name;
    if (!IC[k]) return window.VooUI ? VooUI.icon(name, size) : '';
    var s = size || 22;
    return '<svg class="tn-i tn-i-' + k + ' ' + (cls || '') + '" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' + IC[k] + '</svg>';
  }
  function has(name) { return !!IC[ALIAS[name] || name]; }

  /* ---------- scenes ---------- */
  // Home: three creators on a little filming set. Bubbles are HTML laid over it (see crewBubble).
  var CREW = [
    { who: 'kofi', pose: 'type', x: 25, y: 92, s: 1, d: -.4, head: [95, 112] },
    { who: 'maya', pose: 'hold', x: 191.6, y: 71.6, s: 1.12, d: -1.6, head: [270, 104] },
    { who: 'leo', pose: 'film', x: 384, y: 85, s: 1.04, d: -2.6, head: [457, 112] },
  ];
  function crewScene() {
    var g = '';
    // ring light behind the presenter
    g += '<g class="tn-ring"><circle cx="270" cy="150" r="74" fill="' + OR + '" opacity=".10" class="tn-glow"/><circle cx="270" cy="150" r="56" fill="none" stroke="#FFF8F2" stroke-width="12"/><circle cx="270" cy="150" r="56" fill="none" stroke="' + INK + '" stroke-opacity=".12" stroke-width="13" stroke-dasharray="1 0"/><circle cx="270" cy="150" r="56" fill="none" stroke="#FFFDF9" stroke-width="10"/><path d="M270 206v56" stroke="' + INK + '" stroke-width="4"/></g>';
    // sparkle bits
    g += '<g class="tn-sparks"><path class="sp1" d="M168 70l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="' + OR + '"/><path class="sp2" d="M372 52l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="' + PEACH + '"/><circle class="sp3" cx="60" cy="60" r="3" fill="' + PEACH + '"/><circle class="sp1" cx="500" cy="64" r="2.6" fill="' + OR + '"/></g>';
    CREW.forEach(function (c, i) { g += '<g class="tn-seat s' + i + '" transform="translate(' + c.x + ' ' + c.y + ') scale(' + c.s + ')">' + person({ who: c.who, pose: c.pose, d: c.d, cls: 'c' + i }) + '</g>'; });
    // hearts floating up from the presenter
    g += '<g class="tn-hearts">' + [0, 1, 2].map(function (i) { return '<path class="h' + i + '" d="M0 3C0-1 5-2 6 1.5 7-2 12-1 12 3 12 7 6 10.5 6 10.5S0 7 0 3z" fill="' + (i === 1 ? PEACH : OR) + '" transform="translate(' + (318 + i * 14) + ' ' + (150 - i * 6) + ')"/>'; }).join('') + '</g>';
    // desk with the editor's laptop
    g += '<rect x="-20" y="258" width="580" height="44" fill="#EADFD0"/><rect x="-20" y="258" width="580" height="5" fill="#F6EEE4"/><rect x="-20" y="263" width="580" height="2" fill="#000" opacity=".06"/>';
    g += '<g class="tn-laptop"><path d="M52 206h96a6 6 0 0 1 6 6v46H46v-46a6 6 0 0 1 6-6z" fill="#24231F"/><path d="M52 206h96a6 6 0 0 1 6 6v46H46v-46a6 6 0 0 1 6-6z" fill="none" stroke="#34322C" stroke-width="2"/>' +
      '<rect x="84" y="220" width="32" height="24" rx="8" fill="' + OR + '"/><g class="tn-blink"><circle cx="94" cy="232" r="4.4" fill="none" stroke="' + INK + '" stroke-width="2"/><circle cx="106" cy="232" r="4.4" fill="none" stroke="' + INK + '" stroke-width="2"/><circle cx="94" cy="232" r="1.6" fill="' + INK + '"/><circle cx="106" cy="232" r="1.6" fill="' + INK + '"/></g></g>';
    // the presenter's tripod phone on the desk
    g += '<g class="tn-tripod"><path d="M196 258l10-26 10 26M206 232v26" stroke="#6B6860" stroke-width="2.4" fill="none" stroke-linecap="round"/><rect x="198" y="210" width="16" height="26" rx="4" fill="' + INK + '"/><circle class="tn-rec" cx="206" cy="215.5" r="2" fill="' + OR + '"/></g>';
    return '<svg class="tn tn-crew" viewBox="0 0 540 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' + g + '</svg>';
  }
  function crewHead(i) { var c = CREW[i]; return { x: c.head[0] / 540 * 100, y: c.head[1] / 300 * 100 }; }

  // Learn: Coach Vee at a whiteboard with doodles that keep popping in.
  function classroom() {
    var g = '';
    g += '<path d="M58 284l14-40M292 284l-14-40" stroke="#6B6860" stroke-width="4" stroke-linecap="round"/>';
    g += '<rect x="22" y="26" width="306" height="222" rx="14" fill="#fff"/><rect x="22" y="26" width="306" height="222" rx="14" fill="none" stroke="' + INK + '" stroke-width="5"/>';
    g += '<rect x="96" y="246" width="160" height="10" rx="5" fill="' + INK + '"/><rect x="118" y="240" width="22" height="7" rx="3" fill="' + OR + '"/><rect x="146" y="240" width="16" height="7" rx="3" fill="#6B6860"/>';
    // doodle 1: a phone with a play button
    g += '<g class="tn-dd d1"><rect x="46" y="50" width="62" height="100" rx="12" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3"/><circle cx="77" cy="100" r="18" fill="' + OR + '"/><path d="M71 91v18l15-9z" fill="#fff"/><path d="M60 136h34" stroke="' + INK + '" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/></g>';
    // doodle 2: hook arrow + label
    g += '<g class="tn-dd d2"><path d="M132 72c40-26 86-16 98 22" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M220 86l10 10 8-14" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<rect x="128" y="88" width="76" height="30" rx="15" fill="#FFEDE6"/><text x="166" y="108.5" text-anchor="middle" font-size="16" font-weight="800" fill="' + OR + '" font-family="Plus Jakarta Sans,system-ui,sans-serif">HOOK</text></g>';
    // doodle 3: growing chart
    g += '<g class="tn-dd d3"><path d="M132 222h176M132 222V146" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
      [[146, 26], [178, 44], [210, 36], [242, 62], [274, 72]].map(function (b, i) { return '<rect class="tn-bar b' + i + '" x="' + b[0] + '" y="' + (220 - b[1]) + '" width="20" height="' + b[1] + '" rx="5" fill="' + (i === 4 ? OR : i === 3 ? PEACH : '#E6E3DA') + '"/>'; }).join('') +
      '<path class="tn-trend" d="M150 186l32-16 32 6 32-24 34-16" stroke="' + OR + '" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>';
    // sticky note
    g += '<g class="tn-dd d4"><g transform="rotate(6 280 74)"><rect x="252" y="46" width="58" height="56" rx="6" fill="#FFE3D6"/><path d="M266 74l9 9 17-18" stroke="' + OR + '" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>';
    // coach to the right, pointer reaching the board
    g += '<g transform="translate(356 70) scale(1.02)">' + coachG({ cls: 'c-coach' }) + '</g>';
    g += '<g class="tn-sparks"><path class="sp1" d="M520 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="' + OR + '"/><circle class="sp2" cx="350" cy="28" r="3" fill="' + PEACH + '"/></g>';
    return '<svg class="tn tn-class talking" viewBox="0 0 560 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' + g + '</svg>';
  }

  // Credits: a glass jar that fills with orange, coins dropping in. level 0..1
  function jar(level) {
    var id = nid('jar'), f = Math.max(.08, Math.min(1, Number(level) || 0)), lv = (18 + f * 92) / 118;
    var coin = function (cls, x) { return '<g class="tn-coin ' + cls + '"><ellipse cx="' + x + '" cy="0" rx="11" ry="4.2" fill="' + ORD + '"/><ellipse cx="' + x + '" cy="-2.6" rx="11" ry="4.2" fill="' + OR + '"/><ellipse cx="' + x + '" cy="-2.6" rx="6" ry="2" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/></g>'; };
    return '<svg class="tn tn-jar" viewBox="0 0 140 170" aria-hidden="true" style="--lv:' + lv.toFixed(3) + '"><defs><clipPath id="' + id + '"><path d="M32 52h76c8 0 12 6 12 14v76c0 12-8 20-20 20H40c-12 0-20-8-20-20V66c0-8 4-14 12-14z"/></clipPath></defs>' +
      '<ellipse cx="70" cy="164" rx="50" ry="5" fill="' + INK + '" opacity=".08"/>' +
      '<g class="tn-drops">' + coin('c1', 70) + coin('c2', 64) + coin('c3', 76) + '</g>' +
      '<path d="M32 52h76c8 0 12 6 12 14v76c0 12-8 20-20 20H40c-12 0-20-8-20-20V66c0-8 4-14 12-14z" fill="#FFF8F3"/>' +
      '<g clip-path="url(#' + id + ')"><g class="tn-fill"><g class="tn-wave"><path d="M-80 70q15-8 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0V180H-80z" fill="' + OR + '"/><path d="M-80 70q15-8 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0" stroke="#FF8A5C" stroke-width="3" fill="none"/></g><rect x="0" y="74" width="140" height="110" fill="' + OR + '" opacity="0"/></g>' +
      '<g opacity=".9"><ellipse cx="52" cy="152" rx="11" ry="4" fill="' + ORD + '"/><ellipse cx="52" cy="149.6" rx="11" ry="4" fill="#FF8A5C"/><ellipse cx="84" cy="154" rx="11" ry="4" fill="' + ORD + '"/><ellipse cx="84" cy="151.6" rx="11" ry="4" fill="#FF8A5C"/><ellipse cx="68" cy="145" rx="11" ry="4" fill="' + ORD + '"/><ellipse cx="68" cy="142.6" rx="11" ry="4" fill="#FF8A5C"/></g>' +
      '<g class="tn-bubbles"><circle class="b1" cx="46" cy="140" r="2.4" fill="#fff" opacity=".5"/><circle class="b2" cx="92" cy="146" r="1.8" fill="#fff" opacity=".5"/><circle class="b3" cx="74" cy="150" r="2" fill="#fff" opacity=".5"/></g></g>' +
      '<path d="M32 52h76c8 0 12 6 12 14v76c0 12-8 20-20 20H40c-12 0-20-8-20-20V66c0-8 4-14 12-14z" fill="none" stroke="' + INK + '" stroke-width="3.5"/>' +
      '<path d="M30 70v62" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>' +
      '<rect x="28" y="36" width="84" height="18" rx="7" fill="' + INK + '"/><rect x="56" y="42" width="28" height="5" rx="2.5" fill="#6B6860"/><rect x="28" y="49" width="84" height="5" fill="' + OR + '" opacity=".9"/>' +
      '</svg>';
  }

  // Lesson thumbnails: a drawn prop for the topic on the left, Coach Vee pointing at it from the right. 320 x 160.
  var F = 'font-family="Plus Jakarta Sans,system-ui,sans-serif" font-weight="800"';
  var LS = {
    home: '<rect x="20" y="22" width="190" height="122" rx="14" fill="#fff" stroke="' + INK + '" stroke-width="3"/><rect x="20" y="22" width="48" height="122" rx="14" fill="#F3EEE4"/><rect x="30" y="36" width="28" height="10" rx="5" fill="' + INK + '"/><rect x="30" y="54" width="22" height="6" rx="3" fill="#D9D5C9"/><rect x="30" y="66" width="26" height="6" rx="3" fill="#D9D5C9"/><rect x="30" y="78" width="20" height="6" rx="3" fill="#D9D5C9"/>' +
      '<rect x="80" y="36" width="80" height="12" rx="6" fill="' + INK + '"/><rect x="80" y="56" width="116" height="34" rx="9" fill="#FFEDE6"/><rect x="88" y="66" width="56" height="7" rx="3.5" fill="' + OR + '"/><rect x="88" y="78" width="36" height="5" rx="2.5" fill="' + PEACH + '"/>' +
      '<g class="ls-pop"><rect x="80" y="100" width="70" height="24" rx="12" fill="' + OR + '"/><path d="M106 112h18M118 106l6 6-6 6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<g class="ls-cur"><path d="M150 112l18 9-7.5 2-3.4 7.5z" fill="' + INK + '" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></g>',
    ugc: '<g class="ls-bob"><rect x="62" y="12" width="78" height="136" rx="16" fill="' + INK + '"/><g transform="translate(70 22) scale(.97)"><rect width="64" height="114" rx="10" fill="#FFE3D6"/></g><g class="talking" transform="translate(74 40) scale(.88)">' + '<path d="M8 67C10 51 21 46 32 46C43 46 54 51 56 67Z" fill="' + OR + '"/><rect x="27.5" y="38" width="9" height="9" rx="3" fill="' + SKINS[1] + '"/>' + head(CAST.maya) + '</g><rect x="78" y="120" width="46" height="6" rx="3" fill="#fff" opacity=".85"/></g>' +
      '<g class="ls-blink"><circle cx="128" cy="30" r="4" fill="' + OR + '"/></g><g class="ls-pop"><rect x="150" y="104" width="56" height="26" rx="13" fill="#fff" stroke="#E6E3DA" stroke-width="1.5"/><text x="178" y="122" text-anchor="middle" font-size="12" ' + F + ' fill="' + OR + '">REC</text></g>',
    video: '<g class="ls-bob"><path d="M26 58 156 26l6 22L32 80z" fill="' + OR + '"/><path d="M52 52l10 18M84 44l10 18M116 36l10 18" stroke="#fff" stroke-width="5"/><rect x="28" y="78" width="136" height="62" rx="10" fill="' + INK + '"/><path d="M86 96v26l22-13z" fill="#fff"/></g>' +
      '<g>' + [0, 1, 2, 3].map(function (i) { return '<rect class="ls-seg s' + i + '" x="' + (176 + 0) + '" y="' + (40 + i * 26) + '" width="30" height="18" rx="5" fill="' + (i < 2 ? INK : i === 2 ? OR : '#E6E3DA') + '"/>'; }).join('') + '</g>',
    mic: '<g class="ls-spin"><circle cx="90" cy="88" r="50" fill="#fff" stroke="' + INK + '" stroke-width="3"/><path d="M40 88h100M90 38c18 16 18 84 0 100M90 38c-18 16-18 84 0 100" stroke="' + INK + '" stroke-width="2.4" fill="none"/><path d="M54 62q36 10 72 0M54 114q36-10 72 0" stroke="' + INK + '" stroke-opacity=".3" stroke-width="2" fill="none"/></g>' +
      '<g class="ls-pop"><rect x="122" y="18" width="70" height="30" rx="15" fill="' + OR + '"/><text x="157" y="38" text-anchor="middle" font-size="14" ' + F + ' fill="#fff">Hola!</text></g>' +
      '<g class="ls-pop p2"><rect x="14" y="20" width="58" height="28" rx="14" fill="' + INK + '"/><text x="43" y="39" text-anchor="middle" font-size="13" ' + F + ' fill="#fff">Hi!</text></g>' +
      '<g class="ls-pop p3"><rect x="136" y="116" width="66" height="28" rx="14" fill="#fff" stroke="#E6E3DA" stroke-width="1.5"/><text x="169" y="135" text-anchor="middle" font-size="13" ' + F + ' fill="' + INK + '">Salut</text></g>',
    shield: '<g class="ls-bob"><path d="M96 16l62 24v42c0 34-26 58-62 68-36-10-62-34-62-68V40z" fill="#fff" stroke="' + INK + '" stroke-width="3.5"/><path d="M96 34l44 17v31c0 24-18 41-44 49z" fill="#FFEDE6"/><path class="ls-pop" d="M72 82l16 16 32-34" stroke="' + OR + '" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<g class="ls-pop p2"><rect x="160" y="18" width="50" height="30" rx="15" fill="' + INK + '"/><text x="185" y="38" text-anchor="middle" font-size="14" ' + F + ' fill="#fff">94</text></g>',
    credits: '<g class="ls-bob"><ellipse cx="90" cy="134" rx="58" ry="10" fill="' + INK + '" opacity=".08"/>' + [0, 1, 2, 3, 4].map(function (i) { return '<ellipse cx="90" cy="' + (128 - i * 14) + '" rx="46" ry="13" fill="' + ORD + '"/><ellipse cx="90" cy="' + (122 - i * 14) + '" rx="46" ry="13" fill="' + OR + '"/>'; }).join('') + '<ellipse cx="90" cy="66" rx="24" ry="6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2"/></g>' +
      '<g class="ls-drop"><ellipse cx="90" cy="22" rx="20" ry="6.5" fill="' + ORD + '"/><ellipse cx="90" cy="18" rx="20" ry="6.5" fill="#FF8A5C"/></g>' +
      '<g class="ls-pop"><rect x="150" y="30" width="58" height="28" rx="14" fill="#fff" stroke="#E6E3DA" stroke-width="1.5"/><text x="179" y="49" text-anchor="middle" font-size="13" ' + F + ' fill="' + OR + '">+60</text></g>',
    support: '<g class="ls-pop"><rect x="18" y="22" width="130" height="44" rx="20" fill="#fff" stroke="#E6E3DA" stroke-width="1.5"/><rect x="34" y="36" width="74" height="7" rx="3.5" fill="' + INK + '"/><rect x="34" y="49" width="48" height="6" rx="3" fill="#D9D5C9"/></g>' +
      '<g class="ls-pop p2"><rect x="60" y="78" width="140" height="48" rx="20" fill="' + INK + '"/><rect x="78" y="94" width="80" height="7" rx="3.5" fill="#fff"/><rect x="78" y="107" width="54" height="6" rx="3" fill="#6B6860"/></g>' +
      '<g class="ls-typing"><circle cx="34" cy="108" r="5" fill="' + OR + '"/><circle cx="16" cy="108" r="5" fill="' + OR + '" opacity=".6"/><circle cx="52" cy="108" r="5" fill="' + OR + '" opacity=".3"/></g>',
    trend: '<path d="M24 140h180M24 140V24" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' + [[40, 30], [74, 48], [108, 40], [142, 74], [176, 98]].map(function (b, i) { return '<rect class="tn-bar b' + i + '" x="' + b[0] + '" y="' + (138 - b[1]) + '" width="24" height="' + b[1] + '" rx="6" fill="' + (i === 4 ? OR : i === 3 ? PEACH : '#E6E3DA') + '"/>'; }).join('') +
      '<path class="ls-pop" d="M44 96l34-18 34 8 34-26 40-30M168 30h18v18" stroke="' + OR + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    gift: '<g class="ls-bob"><rect x="44" y="64" width="104" height="76" rx="10" fill="#fff" stroke="' + INK + '" stroke-width="3"/><rect x="36" y="46" width="120" height="24" rx="8" fill="' + OR + '"/><rect x="86" y="46" width="20" height="94" fill="' + OR + '"/><path d="M96 46c-10-26-34-30-38-16-3 12 18 16 38 16zM96 46c10-26 34-30 38-16 3 12-18 16-38 16z" fill="' + ORD + '"/></g>' +
      '<g class="ls-pop"><rect x="150" y="20" width="60" height="28" rx="14" fill="' + INK + '"/><text x="180" y="39" text-anchor="middle" font-size="13" ' + F + ' fill="#fff">+30%</text></g>',
  };
  LS.hooks = '<path d="M24 120c30-70 90-90 140-58" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="2 9"/><g class="ls-bob"><circle cx="150" cy="22" r="7" fill="none" stroke="' + INK + '" stroke-width="4"/><path d="M150 29v54a24 24 0 0 1-48 0v-12l14 12" stroke="' + INK + '" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="168" cy="60" r="10" fill="' + OR + '"/></g>' +
    '<g class="ls-pop"><rect x="18" y="20" width="78" height="30" rx="15" fill="#FFEDE6"/><text x="57" y="40" text-anchor="middle" font-size="14" ' + F + ' fill="' + OR + '">HOOK</text></g>';
  LS.spark = '<g class="ls-bob"><rect x="30" y="30" width="150" height="100" rx="14" fill="' + INK + '"/><rect x="44" y="48" width="70" height="12" rx="6" fill="' + OR + '"/><rect x="44" y="68" width="110" height="10" rx="5" fill="#fff"/><rect x="44" y="86" width="80" height="10" rx="5" fill="#6B6860"/></g><path class="ls-pop" d="M184 18l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="' + OR + '"/><path class="ls-pop p2" d="M22 120l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="' + PEACH + '"/>';
  LS.image = [[24, 44, 70, 70], [104, 34, 64, 80], [176, 22, 40, 96]].map(function (r, i) { return '<g class="ls-pop' + (i ? ' p' + (i + 1) : '') + '"><rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="8" fill="#fff" stroke="' + INK + '" stroke-width="2.6"/><circle cx="' + (r[0] + r[2] * .66) + '" cy="' + (r[1] + 16) + '" r="6" fill="' + OR + '"/><path d="M' + r[0] + ' ' + (r[1] + r[3] - 8) + 'l' + r[2] * .35 + ' -' + r[3] * .3 + ' ' + r[2] * .3 + ' ' + r[3] * .2 + ' ' + r[2] * .35 + ' -' + r[3] * .12 + 'v' + (r[3] * .22 + 8) + 'h-' + r[2] + 'z" fill="' + PEACH + '"/></g>'; }).join('');
  LS.slides = LS.spark; LS.script = LS.home; LS.play = LS.home;
  function lesson(kind) {
    var art = LS[kind] || LS.home;
    return '<svg class="tn tn-lesson" viewBox="0 0 320 160" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
      '<ellipse cx="120" cy="152" rx="110" ry="6" fill="' + INK + '" opacity=".06"/><g class="ls-art">' + art + '</g>' +
      '<g transform="translate(214 10) scale(.8)">' + coachG({ cls: 'c-coach' }) + '</g></svg>';
  }

  // Small empty-state scene: one character waving next to a prop icon.
  function empty(kind) {
    var who = kind === 'tickets' ? 'ada' : kind === 'shield' ? 'tolu' : 'maya';
    var prop = kind === 'tickets' ? 'support' : kind === 'shield' ? 'shield' : 'ads';
    return '<div class="tn-empty"><svg class="tn" viewBox="0 0 220 150" aria-hidden="true"><ellipse cx="110" cy="146" rx="80" ry="6" fill="' + INK + '" opacity=".06"/>' +
      '<g transform="translate(40 4) scale(.84)">' + person({ who: who, pose: 'idle', cls: 'waving' }) + '</g>' +
      '<g class="tn-float"><rect x="140" y="30" width="58" height="58" rx="18" fill="#fff" stroke="#E6E3DA" stroke-width="1.5"/><g transform="translate(151 41) scale(1.5)" style="color:' + INK + '">' + IC[prop].replace(/class="s"/g, 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"').replace(/class="a"/g, 'fill="' + OR + '"').replace(/class="t"/g, 'fill="' + OR + '" opacity=".12"') + '</g></g></svg></div>';
  }

  // Confetti burst inside any positioned box.
  function burst(el, n) {
    if (reduce || !el) return;
    var b = document.createElement('div'); b.className = 'tn-burst'; var h = '', cols = [OR, INK, '#FF8A5C', PEACH, '#A19E95', '#FFD3C2'];
    for (var i = 0; i < (n || 30); i++) { var a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120; h += '<i style="--c:' + cols[i % 6] + ';--bx:' + Math.round(Math.cos(a) * d) + 'px;--by:' + Math.round(Math.sin(a) * d - 50) + 'px;--br:' + Math.round(Math.random() * 640 - 320) + 'deg;border-radius:' + (i % 3 ? '2px' : '50%') + '"></i>'; }
    b.innerHTML = h; el.appendChild(b); setTimeout(function () { b.remove(); }, 1300);
  }
  // Count a number up inside an element.
  function countUp(el, to, ms) {
    if (!el) return; to = Number(to) || 0;
    if (reduce || !to) { el.textContent = to.toLocaleString('en-US'); return; }
    var t0 = performance.now(), dur = ms || 1100;
    (function f(t) { var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  window.VooToons = { avatar: avatar, person: person, coach: coach, coachFace: coachFace, icon: icon, has: has, crewScene: crewScene, crewHead: crewHead, classroom: classroom, lesson: lesson, jar: jar, empty: empty, burst: burst, countUp: countUp, reduce: reduce, CAST: CAST };

  // Support agents are the Vooads cast, not stock icons.
  var AGENTS = [{ n: 'Ada', k: 'ada' }, { n: 'Tolu', k: 'tolu' }, { n: 'Sam', k: 'sam' }];
  if (window.VooUI) {
    VooUI.agent = function (i, size, cls) { var a = AGENTS[Math.abs(i) % AGENTS.length]; return '<span class="agent tn-agent ' + (cls || '') + '" style="--s:' + (size || 40) + 'px" title="' + a.n + '">' + avatar(a.k) + '</span>'; };
    VooUI.agentsStack = function (size) { return '<span class="agents">' + [0, 1, 2].map(function (i) { return VooUI.agent(i, size); }).join('') + '</span>'; };
    VooUI.agentNames = AGENTS.map(function (a) { return a.n; });
  }
})();
