// Stores generated and uploaded files on disk (DATA_DIR/media) and serves them at /media/<id>.
// Optional mirroring: provider links can expire, so finished videos are copied here when MIRROR_MEDIA=1 (default on).
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { run, get } = require('./db');
const { id } = require('./lib/util');

const DIR = path.join(config.dataDir, 'media');
const EXT = { 'audio/mpeg': '.mp3', 'video/mp4': '.mp4', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'text/plain': '.srt', 'video/webm': '.webm', 'text/x-ass': '.ass', 'audio/wav': '.wav', 'application/zip': '.zip', 'video/quicktime': '.mov', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'image/gif': '.gif' };

function save(buf, mime, userId = null) {
  const mid = id(12);
  const file = mid + (EXT[mime] || '');
  fs.writeFileSync(path.join(DIR, file), buf);
  run('INSERT INTO media(id, user_id, mime, file) VALUES(?,?,?,?)', mid, userId, mime, file);
  return { id: mid, file, publicUrl: `${config.appUrl}/media/${file}`, path: `/media/${file}` };
}

// Provider output links are copied through the guarded download (lib/netguard.js: pinned DNS, private ranges refused,
// redirects re-checked) and stored with the type their first bytes show; anything that is not media keeps its link.
async function mirror(url, userId) {
  if (process.env.MIRROR_MEDIA === '0' || !/^https?:\/\//.test(url)) return url;
  try {
    const ng = require('./lib/netguard');
    const r = await ng.download(url, { maxBytes: 300e6, timeoutMs: 120e3 });
    const t = ng.sniff(r.body);
    if (!t) return url;
    return save(r.body, t.mime, userId).path;
  } catch {
    return url;
  }
}

const filePath = (file) => {
  const p = path.normalize(path.join(DIR, file));
  return p.startsWith(DIR + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
};

module.exports = { save, mirror, filePath, DIR, row: (mid) => get('SELECT * FROM media WHERE id = ?', mid) };
