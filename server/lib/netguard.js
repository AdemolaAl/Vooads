// Outbound requests to addresses customers or AI providers give us (ad links, provider output files). Guards against SSRF:
// http(s) only, no credentials in the URL, no localhost / private / link-local / reserved / metadata addresses, checked on
// the resolved IP and pinned through a custom DNS lookup (a second lookup cannot swap in a private address). Redirects are
// followed only by hand, each hop checked again. Timeout and size limit. Modelled on VooSquare's src/netguard.js.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]]) blocked.addSubnet(a, p, 'ipv6');

class GuardError extends Error {}
// Tests (and only tests) may allow loopback, e.g. a fake provider on 127.0.0.1.
const allowPrivate = () => process.env.NETGUARD_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production';

function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 6) {
    const lower = ip.toLowerCase();
    const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (m) return blocked.check(m[1], 'ipv4');
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true;
    return blocked.check(ip, 'ipv6');
  }
  return blocked.check(ip, 'ipv4');
}
function urlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'is not a valid web address'; }
  if (!/^https?:$/.test(u.protocol)) return 'must start with https://';
  if (u.username || u.password) return 'must not contain a username or password';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate()) {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return 'points to a private address';
    if (net.isIP(host) && isBlockedIp(host)) return 'points to a private address';
  }
  return '';
}
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length) return cb(new GuardError('could not be found'));
    if (!allowPrivate() && addrs.some((a) => isBlockedIp(a.address))) return cb(new GuardError('points to a private address'));
    if (options && options.all) return cb(null, addrs);
    const fam = options && options.family;
    const pick = addrs.find((a) => !fam || a.family === fam) || addrs[0];
    cb(null, pick.address, pick.family);
  });
}
// One request, no redirects followed. Resolves {status, headers, body}.
function request(url, { timeoutMs = 120e3, maxBytes = 300e6, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const problem = urlProblem(url);
    if (problem) return reject(new GuardError('That link ' + problem + '.'));
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = lib.request({ protocol: u.protocol, hostname: host, port: u.port || undefined, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Vooads/1.0', ...headers }, lookup: net.isIP(host) ? undefined : guardedLookup }, (res) => {
      if (Number(res.headers['content-length']) > maxBytes) { req.destroy(); return finish(reject, new GuardError('That file is too big (max ' + Math.round(maxBytes / 1e6) + ' MB).')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); finish(reject, new GuardError('That file is too big (max ' + Math.round(maxBytes / 1e6) + ' MB).')); } else chunks.push(c); });
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new GuardError('The download took too long.')); }, timeoutMs);
    req.on('error', (e) => finish(reject, e instanceof GuardError ? new GuardError('That link ' + e.message + '.') : new GuardError(e.code === 'ENOTFOUND' ? 'That link could not be found.' : 'Could not download that link.')));
    req.end();
  });
}
// Download with at most `maxRedirects` redirects, every hop checked. Resolves {body, type, url}.
async function download(url, { maxRedirects = 4, ...opts } = {}) {
  let u = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const r = await request(u, opts);
    if (r.status >= 300 && r.status < 400 && r.headers.location) { u = new URL(r.headers.location, u).toString(); continue; }
    if (r.status < 200 || r.status >= 300) throw new GuardError('Could not download that link (' + r.status + ').');
    return { body: r.body, type: String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), url: u };
  }
  throw new GuardError('Too many redirects.');
}

// What a media file really is, from its first bytes. {ext, mime, demuxer} or null (refused).
function sniff(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const s = (o, n) => b.toString('latin1', o, o + n);
  if (b.length < 12) return null;
  if (s(4, 4) === 'ftyp') { const brand = s(8, 4); return /^(M4A |M4B )/.test(brand) ? { ext: '.m4a', mime: 'audio/mp4', demuxer: 'mov' } : brand === 'qt  ' ? { ext: '.mov', mime: 'video/quicktime', demuxer: 'mov' } : { ext: '.mp4', mime: 'video/mp4', demuxer: 'mov' }; }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: '.webm', mime: 'video/webm', demuxer: 'matroska' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return { ext: '.wav', mime: 'audio/wav', demuxer: 'wav' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return { ext: '.webp', mime: 'image/webp', demuxer: 'image2' };
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return { ext: '.png', mime: 'image/png', demuxer: 'image2' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg', demuxer: 'image2' };
  if (s(0, 4) === 'GIF8') return { ext: '.gif', mime: 'image/gif', demuxer: 'gif' };
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { ext: '.mp3', mime: 'audio/mpeg', demuxer: 'mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { ext: '.aac', mime: 'audio/aac', demuxer: 'aac' };
  if (s(0, 4) === 'OggS') return { ext: '.ogg', mime: 'audio/ogg', demuxer: 'ogg' };
  return null;
}

module.exports = { download, request, sniff, isBlockedIp, urlProblem, GuardError };
