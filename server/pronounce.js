// Pronunciation dictionary (SPEC §12). Applied to every text sent to a TTS provider so brand names are said right.
// Setting `pronunciations`: [{word, say}], matched case-insensitively on whole words. Edited at GET/PUT /api/admin/pronunciations.
const { getSetting } = require('./settings');

const DEFAULT = [
  { word: 'Vooads', say: 'Voo-ads' },
  { word: 'VooSquare', say: 'Voo-square' },
  { word: 'Zedapex', say: 'Zed-a-pex' },
  { word: 'Joinvoo', say: 'Join-voo' },
  { word: 'Replyvoo', say: 'Reply-voo' },
  { word: 'Castvoo', say: 'Cast-voo' },
  { word: 'Gatevoo', say: 'Gate-voo' },
  { word: 'Affleego', say: 'Af-lee-go' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pure function (unit-tested): apply(text, list) → text with every listed word replaced by how it should be said.
function apply(text, list) {
  let out = String(text ?? '');
  const rows = (Array.isArray(list) ? list : []).filter((r) => r && String(r.word || '').trim() && r.say !== undefined)
    .sort((a, b) => String(b.word).length - String(a.word).length); // longer words first ("VooSquare" before "Voo")
  for (const r of rows) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(String(r.word).trim())}(?![\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(re, () => String(r.say));
  }
  return out;
}

const list = () => {
  const v = getSetting('pronunciations');
  return Array.isArray(v) ? v : DEFAULT;
};
const forTts = (text) => apply(text, list());

// Clean admin input: [{word, say}] with sane lengths, no duplicates.
function sanitize(rows) {
  if (!Array.isArray(rows)) return null;
  const seen = new Set();
  const out = [];
  for (const r of rows.slice(0, 300)) {
    const word = String(r?.word || '').trim().slice(0, 60);
    const say = String(r?.say || '').trim().slice(0, 120);
    if (!word || !say || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push({ word, say });
  }
  return out;
}

module.exports = { apply, forTts, list, sanitize, DEFAULT };
