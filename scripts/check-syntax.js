// Syntax check without running anything: every .js file (node --check) and every inline <script> in public/*.html
// and server-rendered templates. Run: npm run check:syntax   (also runs in GitHub Actions before npm run check)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'data', '.git']);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const files = walk(ROOT);
let bad = 0, js = 0, inline = 0;
for (const f of files.filter((x) => x.endsWith('.js'))) {
  js++;
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error('✗', path.relative(ROOT, f), '\n', r.stderr.trim()); }
}
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs) || /type=["']?(application\/ld\+json|application\/json|text\/template)/i.test(attrs) || !m[2].trim()) continue;
    inline++;
    const line = html.slice(0, m.index).split('\n').length;
    try {
      if (/type=["']?module/i.test(attrs)) {
        const tmp = path.join(require('node:os').tmpdir(), `vooads-inline-${process.pid}-${inline}.mjs`);
        fs.writeFileSync(tmp, m[2]);
        const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
        fs.unlinkSync(tmp);
        if (r.status !== 0) throw new Error(r.stderr.trim().split('\n').slice(-3).join(' '));
      } else new vm.Script(m[2], { filename: `${path.relative(ROOT, f)}:${line}` });
    } catch (e) { bad++; console.error('✗', `${path.relative(ROOT, f)} inline script at line ${line}:`, e.message); }
  }
}
console.log(`${bad ? '✗' : '✓'} syntax: ${js} JS files, ${inline} inline scripts${bad ? `, ${bad} with errors` : ', all OK'}`);
process.exit(bad ? 1 : 0);
