// Role builder: plain-English permission groups, role presets and per-role limits. Pure module (also embedded in the demo).
// Permissions themselves are listed in auth.js (PERMISSIONS). Limits live in roles.limits:
//   max_credit_grant      most credits one grant can add (empty = no limit, 0 = cannot give credits)
//   max_credit_grant_day  most credits a person can give in 24 hours, all grants together
//   max_refund_usd        biggest payment (USD) they can mark refunded
//   ticket_scope          'all' | 'assigned' (only tickets assigned to them)
const GROUPS = [
  { id: 'support', label: 'Support', perms: [
    ['tickets.view', 'View tickets'], ['tickets.reply', 'Reply and write internal notes'], ['calls.handle', 'Take callback calls (see phone numbers)'],
    ['tickets.close', 'Solve and close tickets'], ['tickets.assign', 'Assign tickets to teammates'], ['tickets.manage', 'Run support: saved replies, reply times, VooSquare mode'],
    ['support.reply', 'Answer classic in-app chats'],
  ] },
  { id: 'users', label: 'Users', perms: [
    ['users.view', 'See customers and their usage'], ['users.edit', 'Edit customer details and plans'], ['users.credits', 'Add or remove credits'], ['users.ban', 'Ban, suspend or unban customers'],
  ] },
  { id: 'money', label: 'Money', perms: [
    ['users.finance', 'See money: what customers spent, our AI cost, profit, revenue and CSV export'], ['payments.view', 'See payments'],
    ['payments.refund', 'Refund payments and approve bank transfers'], ['payments.manage', 'Set up payment methods and keys'],
    ['pricing.view', 'See plans and prices'], ['pricing.manage', 'Change prices and discount codes'],
  ] },
  { id: 'content', label: 'Content', perms: [
    ['blog.view', 'See blog posts'], ['blog.edit', 'Write and publish blog posts'], ['emails.view', 'See emails'], ['emails.edit', 'Edit emails and send tests'],
  ] },
  { id: 'settings', label: 'Settings', perms: [
    ['dashboard.view', 'See the overview'], ['settings.view', 'See settings and integrations'], ['settings.manage', 'Change settings and connect services'],
    ['staff.view', 'See the team'], ['staff.manage', 'Invite people and edit roles'], ['audit.view', 'See the activity log'],
  ] },
  { id: 'ai', label: 'AI', perms: [
    ['providers.view', 'See AI models and their costs'], ['providers.manage', 'Add and switch AI models and keys'],
    ['features.view', 'See AI tools'], ['features.manage', 'Build, test and publish AI tools'],
  ] },
];

const LIMIT_KEYS = ['max_credit_grant', 'max_credit_grant_day', 'max_refund_usd'];

// One-click starting points. "Owner" is the built-in full-access role.
const PRESETS = [
  { name: 'Owner', description: 'Full access to everything, including other owners.', permissions: ['*'], limits: {} },
  { name: 'Admin', description: 'Runs everything day to day. Cannot change owners.', permissions: 'ALL', limits: { max_credit_grant: 5000, max_credit_grant_day: 20000, max_refund_usd: 1000, ticket_scope: 'all' } },
  { name: 'Support agent', description: 'Answers tickets given to them, takes calls, small credit refunds.', permissions: ['dashboard.view', 'users.view', 'users.credits', 'tickets.view', 'tickets.reply', 'tickets.close', 'calls.handle', 'support.reply'], limits: { max_credit_grant: 100, max_credit_grant_day: 300, ticket_scope: 'assigned' } },
  { name: 'Finance', description: 'Revenue, payments, refunds and pricing. No support.', permissions: ['dashboard.view', 'users.view', 'users.finance', 'payments.view', 'payments.refund', 'pricing.view', 'audit.view'], limits: { max_credit_grant: 0, max_refund_usd: 500, ticket_scope: 'all' } },
  { name: 'Content editor', description: 'Blog, emails, the AI brain and AI tools.', permissions: ['dashboard.view', 'blog.view', 'blog.edit', 'emails.view', 'emails.edit', 'settings.view', 'features.view', 'features.manage', 'providers.view'], limits: { ticket_scope: 'all' } },
];

// Preset with "ALL" expanded to every known permission (never "*").
function presetsFor(allPerms) {
  const keys = Object.keys(allPerms || {});
  return PRESETS.map((p) => ({ ...p, permissions: p.permissions === 'ALL' ? keys.slice() : p.permissions.filter((x) => x === '*' || keys.includes(x)) }));
}

// Groups with every permission the server knows; unknown ones (added later) land in "Other".
function groupsFor(allPerms) {
  const keys = Object.keys(allPerms || {});
  const known = new Set();
  const out = GROUPS.map((g) => ({ id: g.id, label: g.label, perms: g.perms.filter(([k]) => keys.includes(k)).map(([k, l]) => { known.add(k); return { key: k, label: l }; }) })).filter((g) => g.perms.length);
  const rest = keys.filter((k) => !known.has(k));
  if (rest.length) out.push({ id: 'other', label: 'Other', perms: rest.map((k) => ({ key: k, label: allPerms[k] })) });
  return out;
}

// Clean a limits object from the admin (numbers ≥ 0, empty = no limit).
function cleanLimits(input = {}, prev = {}) {
  const out = {};
  for (const k of LIMIT_KEYS) {
    const v = input[k] === undefined ? prev[k] : input[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = k === 'max_refund_usd' ? Math.round(n * 100) / 100 : Math.min(1e7, Math.round(n));
  }
  const sc = input.ticket_scope === undefined ? prev.ticket_scope : input.ticket_scope;
  if (sc !== undefined && sc !== null && sc !== '') out.ticket_scope = sc === 'assigned' ? 'assigned' : 'all';
  return out;
}

// Can someone with `limits` give `amount` credits now, having given `usedDay` in the last 24 hours?
// Returns null when allowed, else a plain-English reason. Owners pass isOwner and are never limited.
function grantProblem(limits = {}, amount, usedDay = 0, isOwner = false) {
  if (isOwner) return null;
  const a = Math.abs(Math.round(Number(amount) || 0));
  const per = limits.max_credit_grant;
  if (per !== undefined && per !== null && a > Number(per)) return Number(per) === 0 ? 'Your role cannot give credits.' : `Your role can give at most ${Number(per).toLocaleString('en-US')} credits at a time.`;
  const day = limits.max_credit_grant_day;
  if (day !== undefined && day !== null && Number(amount) > 0 && usedDay + a > Number(day)) {
    const left = Math.max(0, Number(day) - usedDay);
    return `Your role can give ${Number(day).toLocaleString('en-US')} credits a day. ${left.toLocaleString('en-US')} left today.`;
  }
  return null;
}
function refundProblem(limits = {}, amountUsd, isOwner = false) {
  if (isOwner) return null;
  const max = limits.max_refund_usd;
  if (max !== undefined && max !== null && Number(amountUsd) > Number(max) + 1e-9) return `Your role can refund payments up to $${Number(max).toLocaleString('en-US')}. Ask a manager for this one.`;
  return null;
}
// A non-owner may only hand out limits at or below their own (no climbing above your own access).
function limitsProblem(mine = {}, wanted = {}, permsWanted = []) {
  for (const k of LIMIT_KEYS) {
    const m = mine[k];
    if (m === undefined || m === null) continue;
    const relevant = k === 'max_refund_usd' ? permsWanted.includes('payments.refund') : permsWanted.includes('users.credits');
    if (!relevant) continue;
    const w = wanted[k];
    if (w === undefined || w === null || w === '' || Number(w) > Number(m)) return `Set "${k.replace(/_/g, ' ')}" to ${m} or less (your own limit).`;
  }
  return null;
}

module.exports = { GROUPS, PRESETS, LIMIT_KEYS, presetsFor, groupsFor, cleanLimits, grantProblem, refundProblem, limitsProblem };
