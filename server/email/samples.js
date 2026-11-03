// Sample values for previews (Admin → Emails, Admin → Mail → Lifecycle), the offline gallery and the checks.
// Made-up people and products only.
// Credit and price numbers come from the live pricing config, so previews always match what customers see.
function sampleVars(appUrl, id) {
  const lib = `${appUrl}/app#library`;
  const P = require('../settings').pricing();
  const pro = (P.plans || []).find((x) => x.id === 'pro') || (P.plans || [])[0] || {};
  const pack = (P.topups || [])[0] || {};
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  const trial = Number(P.free_trial?.credits) || 0;
  const common = {
    name: 'Alex', code: '482915', credits: n(pro.credits_month), plan: pro.name || 'Pro', amount: '$' + Number(pro.price_month || 0).toFixed(2), period: 'monthly', date: 'Nov 3, 2026',
    referral_link: `${appUrl}/?invite=alex7`, invite_url: `${appUrl}/admin`, role: 'Support', inviter_name: 'Jordan',
    reason: 'Example reason', effective_date: 'in 14 days', change_1: 'Example change', change_2: 'Example change', change_3: 'Example change',
    customer_email: 'alex@example.com', ticket_subject: 'Captions look small on 4:5', ticket_body: 'Example message', ticket_id: '1042',
    seconds: '45', segments: '3', video_title: 'Lumen Serum: morning routine hook', video_meta: '0:15 · 9:16 · 1080p · captions on',
    video_page: lib, edit_url: lib, job_url: lib, url: lib, renew_date: 'Nov 6, 2026', ended_date: 'Nov 2, 2026', balance: n(Number(pro.credits_month || 0) + 250),
    actor_name: 'Alex (own face)', note: '', videos: '14', credits_used: '860', pct: '20', pct_left: '11',
    agent_name: 'Maya from Vooads support', reply_excerpt: 'Good catch. I bumped the caption size on all 4:5 exports for your account. Re-export the video and it will use the larger style.',
    reply_html: 'Good catch. I bumped the caption size on all 4:5 exports for your account.', ticket_url: `${appUrl}/app#support/1042`,
    reset_url: `${appUrl}/app#login`, part: '2', keep_until: 'Nov 10, 2026',
  };
  const per = {
    welcome: { credits: n(trial) },
    topup_receipt: { credits: n(pack.credits), amount: '$' + Number(pack.price || 0).toFixed(2), plan: '', code: 'VA-2291' },
    payment_receipt: { code: 'VA-2290' },
    credits_added: { credits: '250', note: 'Sorry about the render that stalled yesterday. These are on us.' },
    paid_credits_low: { credits: '140' }, trial_credits_low: { credits: n(Math.max(1, Math.floor(trial * 0.1))), pct_left: '10' },
    job_failed: { credits: '120', reason: 'The AI model was busy and did not answer after a few tries.', video_title: 'Brewline Cold Brew: street interview' },
    referral_earned: { amount: '$14.90' },
    actor_declined: { note: 'The consent clip ends before the consent line is finished.' },
    video_attention: { video_title: 'Northpeak Shoes: 45s founder story', segments: '3' },
    long_video_ready: { video_title: 'Northpeak Shoes: 45s founder story', video_meta: '0:45 · 9:16 · 1080p · 3 parts joined' },
  };
  return { ...common, ...(per[id] || {}) };
}
module.exports = { sampleVars };
