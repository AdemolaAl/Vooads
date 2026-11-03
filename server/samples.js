// Sample creatives shown on the website (AI-generated with Higgsfield for Vooads).
// On boot the server copies them into DATA_DIR/samples so the site does not depend on the original links.
// /samples/<file> serves the local copy, or redirects to the original link until the copy exists.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_3JVmdMKIj1cyS4KALmIV38nUmgH/';
const SAMPLES = {
  'ugc-serum.mp4': 'hf_20261003_094554_60aabbb4-a56b-4991-bac9-3b6ec8f9a28f.mp4',
  'ugc-sunscreen.mp4': 'hf_20261003_094554_b67161e0-a09e-4a23-b00f-b95aa3a4c906.mp4',
  'ugc-protein.mp4': 'hf_20261003_094554_e8007675-f74f-4cfd-a8c9-d5175fc47479.mp4',
  'ugc-saas.mp4': 'hf_20261003_094554_25041850-ba0e-40f2-9e89-97125c5bbf13.mp4',
  'ugc-fintech.mp4': 'hf_20261003_094555_4d7e1e71-f4d7-4a72-b724-a54b5c8c42c7.mp4',
  'ugc-sneakers.mp4': 'hf_20261003_094554_5f4a1e49-96b1-459e-90f6-18d6d2686ae6.mp4',
  'ugc-serum-es.mp4': 'hf_20261003_094554_bfefd467-f584-424c-884b-232354bb447e.mp4',
  'ugc-language-app.mp4': 'hf_20261003_094554_97b008de-adb3-4ca0-ab0f-d946a1d6dfc3.mp4',
  'buyer-2.png': 'hf_20261003_094602_00721d2c-166c-4796-89f4-d427201faee3.png',
  'creator-3.png': 'hf_20261003_094559_0c8668d6-d0c8-4e02-8f98-1ad5a660d7e0.png',
  'creator-4.png': 'hf_20261003_094600_77d914d4-a1b6-4e56-a714-baa5fc6e0152.png',
  'creator-5.png': 'hf_20261003_094559_72f3e7d0-8c7b-4cb5-8460-4a423d43b21d.png',
  'support-agent-1.png': 'hf_20261003_135040_4ede4404-84a0-453e-92b4-9525661f151d.png',
  'support-agent-2.png': 'hf_20261003_135040_e0a40b63-fe20-4f00-b169-1608c09ccc90.png',
  'support-agent-3.png': 'hf_20261003_135039_4484ef41-cdb7-4acc-a221-e063e1bbcc56.png',
  'life-buyer-laptop.mp4': 'hf_20261003_135052_babef17a-943f-4f8c-b528-f647349f5325.mp4',
  'life-creator-filming.mp4': 'hf_20261003_135052_51374857-a095-4908-a553-3a0742b031f4.mp4',
  'life-phone-scroll.mp4': 'hf_20261003_135052_1c49f879-9892-423a-a387-2e0e92c70da6.mp4',
  'ad-explainer-vooads.mp4': 'hf_20261003_135052_4c1a8abb-3c1f-4710-9592-775bf43ed717.mp4',
  'ad-skincare-v2.mp4': 'hf_20261003_135052_25fd9eb0-7354-4496-9b67-62af98e91f6c.mp4',
  'ad-app-v2.mp4': 'hf_20261003_135052_6734ac52-72cf-4fc0-b97d-4f0d1ae22661.mp4',
  'promo-motion-sample.mp4': 'https://d2ol7oe51mr4n9.cloudfront.net/user_3JVmdMKIj1cyS4KALmIV38nUmgH/2d84cec1-635c-4c17-a371-8e3721d8cf67.mp4',
  'creator-6.png': 'hf_20261003_094559_05803054-6495-4100-886a-d54918f791a8.png',
  // Everyday-business and ad-style clips (Veo 3.1, November 2026). They ship in public/samples only (no CDN copy).
  // Silent style clips: decorative moving tiles only (no sound button, never the hero).
  'style-podcast.mp4': null, 'style-street-interview.mp4': null, 'biz-fashion-boutique.mp4': null,
  // Two promos were retired in November 2026 (they show the old logo).
  'biz-cafe-promo.mp4': null,
  'biz-real-estate.mp4': null,
  'style-product-headphones.mp4': null,
  // Owner-supplied talking samples with real synced speech, ending on the blue logo card (November 2026).
  'ugc-podcast-creator.mp4': null,
  'ugc-desk-creator.mp4': null,
  'sample-street.mp4': null, 'sample-podcast.mp4': null, 'sample-founder.mp4': null, 'sample-cafe.mp4': null,
  'sample-fitness.mp4': null, 'sample-skincare.mp4': null, 'sample-savings.mp4': null,
  // Stills from ugc-serum for the website's "how it's made" steps.
  'frame-serum-1.webp': null, 'frame-serum-2.webp': null, 'frame-serum-3.webp': null,
  'frame-serum-4.webp': null, 'frame-serum-5.webp': null, 'frame-serum-6.webp': null,
};
// public/samples holds small compressed copies: H.264 mp4 (about 0.3 to 1 MB), a .webp poster for every video
// (<name>.webp), and every photo as .webp. A request for "creator-3.png" is answered with "creator-3.webp".


const dir = path.join(config.dataDir, 'samples');
const bundled = path.join(__dirname, '..', 'public', 'samples');

const has = (name) => Object.prototype.hasOwnProperty.call(SAMPLES, name);
// A poster: "<video name without .mp4>.webp" for a known video.
// "<photo>.webp" for a known "<photo>.png" (the bundled photos are webp).
const isPoster = (name) => /^[a-z0-9-]+\.webp$/.test(name) && (has(name.replace(/\.webp$/, '.mp4')) || has(name.replace(/\.webp$/, '.png')));
// House-actor portraits and motion previews ship as actor-<id>.webp / actor-<id>.mp4 (server/houseactors.js).
const isActor = (name) => /^actor-p\d{1,3}\.(webp|mp4)$/.test(name);
// Captions: <video name>.vtt for a known video (the homepage player's CC option).
const isCaption = (name) => /^[a-z0-9-]+\.vtt$/.test(name) && has(name.replace(/\.vtt$/, '.mp4'));
const known = (name) => has(name) || isPoster(name) || isActor(name) || isCaption(name);

function localPath(name) {
  if (!known(name)) return null; // only the known sample files, never a path
  const tries = [name];
  if (/\.png$/.test(name)) tries.push(name.replace(/\.png$/, '.webp'));
  for (const d of [bundled, dir]) {
    for (const n of tries) {
      const p = path.join(d, n);
      if (fs.existsSync(p) && fs.statSync(p).size > (/\.vtt$/.test(n) ? 20 : 1000)) return p;
    }
  }
  return null;
}

async function mirror() {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, file] of Object.entries(SAMPLES)) {
    if (!file || localPath(name)) continue;
    try {
      const r = await fetch(srcUrl(file));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(path.join(dir, name), buf);
      console.log('[samples] saved', name);
    } catch (e) {
      console.warn('[samples] could not copy', name, '-', e.message, '(the site will use the original link)');
    }
  }
}

// A value may be a file name on the default CDN or a full https URL.
function srcUrl(file) { return /^https?:\/\//.test(file) ? file : CDN + file; }

module.exports = { SAMPLES, CDN, localPath, mirror, srcUrl, known };
