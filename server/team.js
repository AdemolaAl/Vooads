// Staff limits that need the database (credits given in the last 24 hours, refund caps) and the one-time role upgrades
// for the role builder. Pure parts (groups, presets, limit rules) are in roles.js.
const { get, all, run, J } = require('./db');
const { fail } = require('./lib/http');
const auth = require('./auth');
const roles = require('./roles');

const dayAgoSql = () => new Date(Date.now() - 864e5).toISOString().replace('T', ' ').slice(0, 19);

// Credits a staff member added in the last 24 hours (grants only, removals do not count).
function grantedToday(staffId) {
  return Number(get('SELECT COALESCE(SUM(delta), 0) AS t FROM credit_ledger WHERE staff_id = ? AND delta > 0 AND created_at >= ?', staffId, dayAgoSql()).t) || 0;
}
// Same for a VooSquare agent (identified by email in the activity log).
function agentGrantedToday(email) {
  return Number(get("SELECT COALESCE(SUM(CAST(json_extract(detail, '$.amount') AS INTEGER)), 0) AS t FROM audit_log WHERE actor = ? AND action = 'ticket.credits' AND created_at >= ?", 'voosquare:' + email, dayAgoSql()).t) || 0;
}

// Throws 403 when the staff member's role limits do not allow this grant.
function assertGrant(staff, amount) {
  if (auth.can(staff, '*')) return;
  const why = roles.grantProblem(auth.roleLimits(staff), amount, grantedToday(staff.id), false);
  if (why) fail(403, why);
}
function assertRefund(staff, amountUsd) {
  if (auth.can(staff, '*')) return;
  const why = roles.refundProblem(auth.roleLimits(staff), amountUsd, false);
  if (why) fail(403, why);
}
// Closing or solving needs tickets.close (or tickets.manage, which runs support).
const canClose = (staff) => auth.can(staff, 'tickets.close') || auth.can(staff, 'tickets.manage');
function assertStatusChange(staff, status) {
  if (['solved', 'closed'].includes(status) && !canClose(staff)) fail(403, 'Your role cannot solve or close tickets. Ask a lead, or reply and leave it pending.');
}

// One-time upgrades for the role builder (flag in settings.support_flags via support.flag/setFlag).
function migrate() {
  const support = require('./support');
  if (!support.flag('roles_builder_v1')) {
    for (const r of all('SELECT * FROM roles')) {
      const p = J(r.permissions, []);
      if (p.includes('*')) continue;
      const add = [];
      if (p.includes('tickets.reply')) add.push('tickets.close'); // replying used to include solving
      if (['Viewer', 'Manager'].includes(r.name)) add.push('users.finance', 'features.view');
      if (r.name === 'Manager') add.push('features.manage');
      if (add.length) run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...p, ...add])]), r.id);
    }
    support.setFlag('roles_builder_v1');
  }
  // Preset roles from the role builder (Admin, Support agent, Finance, Content editor), added once by name.
  for (const pr of roles.presetsFor(auth.PERMISSIONS)) {
    if (pr.name === 'Owner' || get('SELECT 1 FROM roles WHERE lower(name) = lower(?)', pr.name)) continue;
    run('INSERT INTO roles(name, description, permissions, limits, system) VALUES(?,?,?,?,1)', pr.name, pr.description, JSON.stringify(pr.permissions), JSON.stringify(pr.limits));
  }
}

module.exports = { grantedToday, agentGrantedToday, assertGrant, assertRefund, assertStatusChange, canClose, migrate };
