// Database backups: a consistent copy of the SQLite file in DATA_DIR/backups (on Railway: the Volume, /data/backups).
//  - Every boot makes one before any schema change runs (db.js), so a bad migration can always be undone.
//  - Owners can make one and download it in Admin → Integrations → Backups.
//  - The newest KEEP files are kept; older ones are deleted.
// Uses SQLite's "VACUUM INTO", which writes a clean, complete copy even while the app is running (WAL mode).
// Restore: stop the service, replace /data/vooads.db with the backup file (delete vooads.db-wal and -shm), start again.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const KEEP = 10;
const DIR = () => path.join(config.dataDir, 'backups');
const NAME_RE = /^vooads-\d{8}-\d{6}(?:-\d+)?-[a-z0-9]{1,20}\.db$/;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// db: an open DatabaseSync. label: short word (boot, manual, ...). Returns the file name.
function snapshot(db, label = 'manual') {
  fs.mkdirSync(DIR(), { recursive: true });
  const tag = String(label).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'manual';
  let name = `vooads-${stamp()}-${tag}.db`;
  for (let i = 2; fs.existsSync(path.join(DIR(), name)); i++) name = `vooads-${stamp()}-${i}-${tag}.db`;
  const file = path.join(DIR(), name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune();
  return name;
}

function list() {
  let names = [];
  try { names = fs.readdirSync(DIR()).filter((n) => NAME_RE.test(n)); } catch { return []; }
  return names.map((name) => {
    const st = fs.statSync(path.join(DIR(), name));
    return { name, bytes: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.name.localeCompare(a.name)));
}

function prune(keep = KEEP) {
  for (const b of list().slice(keep)) { try { fs.unlinkSync(path.join(DIR(), b.name)); } catch {} }
}

// Full path of a backup by name, or null. Only names this module makes are accepted (no path tricks).
function fileFor(name) {
  name = String(name || '');
  if (!NAME_RE.test(name)) return null;
  const f = path.join(DIR(), name);
  return fs.existsSync(f) ? f : null;
}

module.exports = { snapshot, list, prune, fileFor, KEEP, DIR };
