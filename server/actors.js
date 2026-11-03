// Actor library: faces with a matching voice, reusable in every video (UGC, hooks, street interview host, re-made scenes).
//   house     our own AI actors (Admin → Settings → presenters), always available
//   generated a customer describes a person → 4 AI faces (an "actor" job, priced) → picks one → saves it with a voice
//   upload    the customer's own face: only with the consent box ticked AND a short consent clip (them saying the consent line
//             on camera). It stays "pending" until staff approve it in Admin → Actors; we never use it before that.
// Celebrities and real-person lookalikes are refused (names list + phrases), for generated and uploaded actors alike, and
// the terms say so. Every face is AI-generated except approved uploads of the customer's own face.
const { db, get, all, run } = require('./db');
const { fail } = require('./lib/http');
const { getSetting } = require('./settings');

function migrate() {
  db.exec(`
CREATE TABLE IF NOT EXISTS actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, kind TEXT NOT NULL,
  image_url TEXT NOT NULL, voice_key TEXT, voice_id TEXT, voice_name TEXT, source_job_id INTEGER, status TEXT NOT NULL DEFAULT 'active',
  consent TEXT, review_note TEXT, reviewed_by INTEGER, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS actors_user ON actors(user_id, deleted_at);`);
}

const CONSENT_LINE = 'My name is {name}. I am the person in this video and I agree to Vooads making AI videos with my face and voice for my own ads.';
const LIMIT_PER_USER = 40;

// ---------- Real-person filter ----------
// Not exhaustive by design: it stops the obvious asks. Staff review covers uploads; the terms forbid the rest.
const NAMES = ['taylor swift', 'beyonce', 'beyoncé', 'rihanna', 'drake', 'kanye', 'ye west', 'kim kardashian', 'kardashian', 'kylie jenner', 'elon musk', 'jeff bezos', 'mark zuckerberg', 'bill gates', 'oprah', 'barack obama', 'obama', 'michelle obama', 'donald trump', 'trump', 'joe biden', 'biden', 'kamala harris', 'putin', 'zelensky', 'king charles', 'prince harry', 'meghan markle', 'cristiano ronaldo', 'ronaldo', 'lionel messi', 'messi', 'neymar', 'mbappe', 'mbappé', 'lebron', 'lebron james', 'michael jordan', 'serena williams', 'usain bolt', 'tom cruise', 'brad pitt', 'angelina jolie', 'leonardo dicaprio', 'dicaprio', 'johnny depp', 'scarlett johansson', 'zendaya', 'tom holland', 'dwayne johnson', 'the rock', 'keanu reeves', 'will smith', 'morgan freeman', 'denzel washington', 'jennifer lopez', 'jlo', 'shakira', 'ariana grande', 'selena gomez', 'billie eilish', 'dua lipa', 'ed sheeran', 'justin bieber', 'bad bunny', 'mrbeast', 'mr beast', 'pewdiepie', 'logan paul', 'jake paul', 'andrew tate', 'joe rogan', 'gordon ramsay', 'emma watson', 'margot robbie', 'ryan reynolds', 'ryan gosling', 'chris hemsworth', 'gal gadot', 'jackie chan', 'bts', 'blackpink', 'lisa manoban', 'jennie kim', 'priyanka chopra', 'shah rukh khan', 'deepika padukone', 'virat kohli', 'pope francis', 'pope leo', 'davido', 'wizkid', 'burna boy', 'tiwa savage', 'tems', 'aliko dangote', 'dangote'];
const PHRASES = /\b(look(s|ing)?[- ]?alike|look(s|ing)? (just |exactly )?like|lookalike|double of|clone of|impersonat\w*|deep ?fake|celebrit(y|ies)|famous (person|actor|actress|singer|rapper|footballer|player|influencer)|real person|my (ex|boss|neighbou?r|friend|wife|husband|girlfriend|boyfriend)\b|president of|prime minister|politician)/i;
function realPersonReason(...texts) {
  const t = texts.map((x) => String(x || '')).join(' ').toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  if (PHRASES.test(t)) return 'We do not make actors that copy or resemble a real person (celebrities, public figures or people you know). Describe a new, fictional person instead.';
  const words = ' ' + t.replace(/[^\p{L}\p{N} ]/gu, ' ') + ' ';
  const hit = NAMES.find((n) => words.includes(' ' + n + ' '));
  if (hit) return 'That looks like a real, well-known person. Actors must be fictional or your own face. Describe a new person instead.';
  return null;
}

// ---------- Voices ----------
const VOICE_LABELS = { female_warm: 'Warm female voice', female_energetic: 'Energetic female voice', male_calm: 'Calm male voice', male_mature: 'Mature male voice' };
function voiceList() {
  const v = getSetting('voices') || {};
  return Object.keys(v).filter((k) => k !== 'coach').map((k) => ({ key: k, name: VOICE_LABELS[k] || k.replace(/_/g, ' ') }));
}

// ---------- Views ----------
// House actors with a portrait (slots still being made are hidden), featured originals first. See server/houseactors.js.
function house() {
  const ha = require('./houseactors');
  return ha.ready().map((p) => ({ ...ha.card(p), kind: 'house', description: p.look, voice_key: p.voice || null, voice_id: p.voice_id || null, voice_name: p.voice_label || VOICE_LABELS[p.voice] || p.voice || null, status: 'active' }));
}
const view = (a) => a && { id: a.id, kind: a.kind, name: a.name, description: a.description, image_url: a.image_url, voice_key: a.voice_key, voice_name: a.voice_name || VOICE_LABELS[a.voice_key] || null, status: a.status, review_note: a.review_note || null, created_at: a.created_at };
function list(userId) {
  return { house: house(), mine: all('SELECT * FROM actors WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC', userId).map(view), voices: voiceList(), consent_line: CONSENT_LINE };
}
// The actor a job may use: a house actor or the customer's own active one. Returns {image_url, voice_id, name} or throws.
function resolve(id, userId) {
  const s = String(id || '');
  if (!s) return null;
  if (s.startsWith('h:')) {
    const h = house().find((x) => x.id === s);
    if (!h) fail(400, 'That actor is no longer available.');
    return { id: h.id, name: h.name, description: h.description, image_url: h.image_url, presenter: h.presenter, voice_key: h.voice_key, voice_id: h.voice_id || null };
  }
  const a = get('SELECT * FROM actors WHERE id = ? AND deleted_at IS NULL', Number(s) || 0);
  if (!a || a.user_id !== userId) fail(400, 'Pick one of your actors or a house actor.');
  if (a.status !== 'active') fail(400, a.status === 'pending' ? 'This actor is waiting for our consent check. You can use it once it is approved.' : 'This actor cannot be used.');
  return { id: a.id, name: a.name, description: a.description, image_url: a.image_url, voice_key: a.voice_key, voice_id: a.voice_id || null };
}

// ---------- Create ----------
const okUrl = (u) => /^\/media\/[\w.-]+$/.test(String(u || ''));
function count(userId) { return Number(get('SELECT COUNT(*) AS n FROM actors WHERE user_id = ? AND deleted_at IS NULL', userId).n) || 0; }
function checkVoice(key) { if (key && !voiceList().some((v) => v.key === key)) fail(400, 'Pick one of the voices.'); }

// From a finished "actor" job: the face must be one of that job's faces.
function saveGenerated(user, { job_id, face_url, name, voice_key }) {
  const job = get("SELECT * FROM jobs WHERE id = ? AND user_id = ? AND type = 'actor' AND status = 'done'", Number(job_id) || 0, user.id);
  if (!job) fail(400, 'Make the faces first, then pick one.');
  const out = JSON.parse(job.output || '{}'), inp = JSON.parse(job.input || '{}');
  if (!(out.faces || []).includes(face_url)) fail(400, 'Pick one of the faces we made for you.');
  const nm = String(name || '').trim().slice(0, 40);
  if (nm.length < 2) fail(400, 'Give your actor a name.');
  const why = realPersonReason(nm);
  if (why) fail(400, why);
  checkVoice(voice_key);
  if (count(user.id) >= LIMIT_PER_USER) fail(400, `You can keep up to ${LIMIT_PER_USER} actors. Delete one first.`);
  const info = run("INSERT INTO actors(user_id, name, description, kind, image_url, voice_key, source_job_id, status) VALUES(?,?,?,?,?,?,?,'active')", user.id, nm, String(inp.description || '').slice(0, 400), 'generated', face_url, voice_key || 'female_warm', job.id);
  return view(get('SELECT * FROM actors WHERE id = ?', Number(info.lastInsertRowid)));
}

// The customer's own face. Needs the consent box, a consent clip (a video upload) and staff approval before use.
function saveUpload(user, { name, image_url, consent, consent_upload_id, voice_key }, ip) {
  if (consent !== true) fail(400, 'Tick the box to confirm this is your own face and you agree to the consent terms.');
  const nm = String(name || '').trim().slice(0, 40);
  if (nm.length < 2) fail(400, 'Add your name as it is said in the consent clip.');
  const why = realPersonReason(nm);
  if (why) fail(400, why);
  if (!okUrl(image_url)) fail(400, 'Upload a clear photo of your face.');
  const uploads = require('./uploads');
  const up = uploads.owned(String(consent_upload_id || ''), user.id);
  if (!up || up.kind !== 'video') fail(400, 'Record the consent clip: say the consent line to the camera, then upload it.');
  if (!(Number(up.duration) >= 3)) fail(400, 'The consent clip is too short. Say the whole consent line.');
  checkVoice(voice_key);
  if (count(user.id) >= LIMIT_PER_USER) fail(400, `You can keep up to ${LIMIT_PER_USER} actors. Delete one first.`);
  // Keep the clip as evidence (uploads are deleted after a few days; media is kept).
  const fs = require('node:fs');
  const p = uploads.filePath(up);
  const clip = p && fs.existsSync(p) ? require('./media').save(fs.readFileSync(p), up.mime || 'video/mp4', user.id).path : null;
  if (!clip) fail(400, 'We could not read the consent clip. Upload it again.');
  const consentRec = { checked_at: new Date().toISOString(), ip: String(ip || '').slice(0, 64), clip_url: clip, line: CONSENT_LINE.replace('{name}', nm), seconds: up.duration };
  const info = run("INSERT INTO actors(user_id, name, description, kind, image_url, voice_key, status, consent) VALUES(?,?,?,?,?,?,'pending',?)", user.id, nm, 'Own face (uploaded)', 'upload', image_url, voice_key || null, JSON.stringify(consentRec));
  return view(get('SELECT * FROM actors WHERE id = ?', Number(info.lastInsertRowid)));
}

function rename(user, id, { name, voice_key }) {
  const a = get('SELECT * FROM actors WHERE id = ? AND user_id = ? AND deleted_at IS NULL', Number(id) || 0, user.id);
  if (!a) fail(404, 'Actor not found.');
  const nm = name !== undefined ? String(name).trim().slice(0, 40) : a.name;
  if (nm.length < 2) fail(400, 'Give your actor a name.');
  const why = realPersonReason(nm);
  if (why) fail(400, why);
  if (voice_key !== undefined) checkVoice(voice_key);
  run('UPDATE actors SET name = ?, voice_key = ? WHERE id = ?', nm, voice_key !== undefined ? voice_key : a.voice_key, a.id);
  return view(get('SELECT * FROM actors WHERE id = ?', a.id));
}
function remove(user, id) {
  const r = run('UPDATE actors SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL', new Date().toISOString(), Number(id) || 0, user.id);
  if (!r.changes) fail(404, 'Actor not found.');
}

// ---------- Staff review (uploads) ----------
function pending() { return all("SELECT a.*, u.email FROM actors a JOIN users u ON u.id = a.user_id WHERE a.kind = 'upload' AND a.deleted_at IS NULL ORDER BY (a.status = 'pending') DESC, a.id DESC LIMIT 100").map((a) => ({ ...view(a), email: a.email, consent: JSON.parse(a.consent || 'null') })); }
function review(staff, id, { approve, note }) {
  const a = get("SELECT * FROM actors WHERE id = ? AND kind = 'upload' AND deleted_at IS NULL", Number(id) || 0);
  if (!a) fail(404, 'Actor not found.');
  if (approve && !JSON.parse(a.consent || 'null')?.clip_url) fail(400, 'There is no consent clip on this actor.');
  run('UPDATE actors SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', approve ? 'active' : 'rejected', String(note || '').slice(0, 300) || null, staff.id, new Date().toISOString(), a.id);
  if (a.status !== (approve ? 'active' : 'rejected')) { try { require('./email').hooks.actorReviewed(a, !!approve, note); } catch (e) { console.warn('[email]', e.message); } }
  return view(get('SELECT * FROM actors WHERE id = ?', a.id));
}

// Prompt for the 4 faces of an "actor" job.
function facePrompt(desc, k) {
  const angles = ['looking straight at the camera', 'slight three-quarter turn', 'natural smile, looking at the camera', 'relaxed expression, soft daylight'];
  return `Photorealistic portrait photo of a fictional person: ${desc}. ${angles[k % 4]}, head and shoulders, plain softly blurred background, natural skin texture, realistic smartphone photo, vertical. Not a real or famous person. No text.`;
}

module.exports = { migrate, list, house, resolve, saveGenerated, saveUpload, rename, remove, pending, review, realPersonReason, facePrompt, voiceList, CONSENT_LINE, NAMES };
