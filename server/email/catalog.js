// Built-in email copy that goes with the new designs (designs.js). Two kinds of entries:
//   new       templates the app did not have yet (video ready, needs attention, credits added, plan renewed ...)
//   upgraded  new defaults for existing templates whose details now sit in a structured block (the receipt table,
//             the code box, the stat card), so the text no longer repeats them.
// seedTemplates() inserts the new ones, and swaps in an upgraded default only while the stored template is still the
// untouched original from content/emails/emails.json. Anything edited in Admin is never overwritten.
// Every template here stays editable in Admin → Emails and Admin → Mail → Lifecycle.

const T = (id, trigger, subject, preheader, heading, body_html, cta_label, cta_url, delay = '0') => ({ id, trigger, delay, subject, preheader, heading, body_html, cta_label, cta_url });

const NEW = [
  T('verify_email', 'New sign-up asks for an email code', 'Confirm your email: {{code}}', 'Enter this code to finish creating your Vooads account.', 'Confirm your email',
    '<p>Hi {{name}},</p><p>Enter this code in Vooads to confirm your email and finish setting up your account.</p><p>If you did not try to sign up, ignore this email. Nobody at Vooads will ever ask you for this code.</p>',
    'Open Vooads', '{{app_url}}/app'),
  T('password_reset', 'Account recovery link requested', 'Reset your Vooads password', 'This link works once and expires in 30 minutes.', 'Reset your password',
    '<p>Hi {{name}},</p><p>We got a request to reset the password for your Vooads account. Press the button to choose a new one. The link works once and expires in 30 minutes.</p><p>If you did not ask for this, ignore this email. Your password stays the same.</p>',
    'Choose a new password', '{{reset_url}}'),
  T('video_ready', 'A video finishes rendering', 'Your video is ready: {{video_title}}', 'Watch it, download it, or change anything by chat.', 'Your video is ready',
    '<p>Hi {{name}},</p><p><strong>{{video_title}}</strong> finished rendering and is in your library in full quality, ready to download.</p><p>Want a sharper hook, bigger captions or new music? Open it and tell the chat editor what to change. Edits reuse what is already made, so they are quick.</p>',
    'Watch your video', '{{video_page}}'),
  T('video_attention', 'A long video pauses because one part keeps failing', 'One part of your video needs a choice', 'Every other part is finished and saved. Pick what happens next.', 'One part needs your choice',
    '<p>Hi {{name}},</p><p>Part {{part}} of <strong>{{video_title}}</strong> could not be made after a few tries. Every other part is finished and saved.</p><p>Pick what happens next. We keep the finished parts until {{keep_until}}. If you do nothing by then, the video is cancelled and every credit for it goes back to you.</p>',
    'Open the video', '{{job_url}}'),
  T('job_failed', 'A video job fails and its credits are refunded', 'We could not finish your video. {{credits}} credits are back', '{{credits}} credits went back to your balance automatically.', 'Your credits are back',
    '<p>Hi {{name}},</p><p><strong>{{video_title}}</strong> could not be finished this time.</p><p>{{reason}}</p><p>Every credit for it went back to your balance automatically. Press Try again in your library: anything already made is reused, so a second try is often cheaper.</p>',
    'Try again', '{{job_url}}'),
  T('credits_added', 'Staff or support add credits to an account', '{{credits}} credits added to your Vooads balance', 'They are top-up credits, so they never expire.', 'Credits added',
    '<p>Hi {{name}},</p><p>We added <strong>{{credits}} credits</strong> to your balance. {{note}}</p><p>These are top-up credits, so they never expire. Plan credits are used first.</p>',
    'Make an ad', '{{app_url}}/app#create'),
  T('plan_renews_soon', 'Auto-renewing plan renews in 3 days', 'Your {{plan}} plan renews on {{renew_date}}', 'Fresh monthly credits arrive the moment it renews.', 'Your plan renews soon',
    '<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> plan renews automatically on <strong>{{renew_date}}</strong> for {{amount}}. Your monthly credits refresh the moment it does.</p><p>You have {{credits}} plan credits left until then. Want to change plans or turn auto-renew off? You can do both in your wallet.</p>',
    'Manage my plan', '{{app_url}}/app#wallet'),
  T('card_renews_soon', 'Card auto-renew (Bachs): 3 days before each renewal, and 7 days before a yearly one', 'Your {{plan}} plan renews on {{renew_date}} for {{amount}}', 'Your card is charged {{amount}} in {{days}} days. Turn auto-renew off any time.', 'Your plan renews in {{days}} days',
    '<p>Hi {{name}},</p><p>Your {{period}} <strong>{{plan}}</strong> plan renews automatically on <strong>{{renew_date}}</strong>. We will charge <strong>{{amount}}</strong> to the card you paid with, and your fresh credits arrive the moment it goes through.</p><p>{{price_note}}</p><p>Want to change plans, update your card or turn auto-renew off? You can do all three in your wallet. If you turn it off, your plan stays active until {{renew_date}}.</p>',
    'Manage my plan', '{{app_url}}/app#wallet'),
  T('plan_renewed', 'Plan renewal payment succeeds', 'Your {{plan}} plan is renewed', '{{credits}} fresh credits are in your balance.', 'Plan renewed',
    '<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> plan is renewed and <strong>{{credits}} fresh credits</strong> are in your balance.</p><p>Your receipt is in a separate email and in your wallet.</p>',
    'Make this month’s ads', '{{app_url}}/app#create'),
  T('plan_expired', 'A plan ends without renewing', 'Your {{plan}} plan has ended', 'Your videos and top-up credits are kept. Restart any time.', 'Your plan has ended',
    '<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> plan ended on {{ended_date}}. Unused plan credits expired with it.</p><p>Everything you made stays in your library, and top-up credits are untouched. Restart your plan any time to get fresh monthly credits, 1080p renders and no watermark.</p>',
    'Restart my plan', '{{app_url}}/app#wallet'),
  T('actor_approved', 'Staff approve an own-face actor', 'Approved: {{actor_name}} is ready to use', 'Your consent clip checks out. Use your own face in any video.', 'Your face actor is approved',
    '<p>Hi {{name}},</p><p>We checked your consent clip and <strong>{{actor_name}}</strong> is approved. You can now pick it as the presenter in any UGC video.</p><p>Only you can use this actor. You can delete it any time in Actors, and we delete the consent clip with it.</p>',
    'Make a video with it', '{{app_url}}/app#create'),
  T('actor_declined', 'Staff decline an own-face actor', 'We could not approve {{actor_name}} yet', 'Record the consent clip again and we will check it quickly.', 'Not approved yet',
    '<p>Hi {{name}},</p><p>We could not approve <strong>{{actor_name}}</strong> as a face actor.</p><p>Most often the consent clip is too short, the face is hard to see, or the consent line is not read out in full. Record a new clip in good light, facing the camera, and say the whole line.</p>',
    'Try again', '{{app_url}}/app#actors'),
  T('weekly_digest', 'Weekly, for customers who made something that week', 'Your week on Vooads: {{videos}} videos made', '{{credits}} credits left for this week’s tests.', 'Your week on Vooads',
    '<p>Hi {{name}},</p><p>Here is your week at a glance. Winners fatigue fast, so a fresh batch of hooks on your best video is usually the cheapest next test.</p>',
    'Make this week’s ads', '{{app_url}}/app#create'),
];

// New defaults for existing templates (the details moved into structured blocks).
const UPGRADED = [
  T('welcome', 'Account created', 'Welcome to Vooads, {{name}}. Make your first ad today', 'Try hooks, images and Ban Shield free. Videos start with any plan.', 'Good to have you here, {{name}}',
    '<p>You now have a studio that makes UGC video ads, image ads, hooks and copy in 20+ languages, built for people who test creatives every week.</p><p>{{trial_line}} Videos start with any plan, from {{plan_from}} a month.</p><p><strong>Three quick wins for today:</strong></p><ol><li><strong>Get 20 hooks for one product.</strong> Pick Hooks in Create, describe your product in one line and pick a language. It costs {{hook_cost}} credits.</li><li><strong>Make an image set.</strong> One prompt gives you 1:1, 4:5 and 9:16, sized for Feed, Stories and Reels.</li><li><strong>Run your live ad copy through Ban Shield.</strong> It flags wording that often gets ads rejected and suggests a safer line.</li></ol><p>Stuck anywhere? Tap the live guide in the studio, or reply to this email. A person reads it.</p><p style="color:#8A93A8;font-size:13px;line-height:20px">Vooads is for honest advertising. Scams, impersonation, fake giveaways and guaranteed-return schemes get an account closed without a refund. See the <a href="{{app_url}}/legal/acceptable-use">Acceptable Use Policy</a>.</p>',
    'Make your first ad', '{{app_url}}/app#create'),
  T('login_code', 'User requests a sign-in code with Voo ID', 'Your Vooads login code: {{code}}', 'Use this code to sign in. It expires in 10 minutes.', 'Your sign-in code',
    '<p>Hi {{name}},</p><p>Use this code to sign in to Vooads.</p><p>If you did not try to sign in, ignore this email. Your account is safe. Nobody at Vooads will ever ask you for this code.</p>',
    'Open Vooads', '{{app_url}}/app'),
  T('payment_receipt', 'Subscription payment succeeded', 'Receipt for your Vooads {{plan}} plan', 'Payment of {{amount}} received. {{credits}} credits added.', 'Payment received',
    '<p>Hi {{name}},</p><p>Thanks for your payment. Your <strong>{{plan}}</strong> plan is active and your credits are in.</p><p>Card plans renew automatically and you can turn auto-renew off in your wallet. Other payment methods do not renew automatically; we email you before your plan ends.</p>',
    'View payments', '{{app_url}}/app#wallet'),
  T('topup_receipt', 'Top-up payment succeeded', '{{credits}} credits added to your account', 'Payment of {{amount}} received. Top-up credits never expire.', 'Top-up complete',
    '<p>Hi {{name}},</p><p>Your top-up is complete and the credits are in your balance.</p><p>Top-up credits never expire. We use plan credits first, since they expire sooner. Unused top-ups can be refunded within 7 days.</p>',
    'Make an ad', '{{app_url}}/app#create'),
  T('plan_upgraded', 'User upgrades plan', 'You are now on {{plan}}', 'Your new credits and features are live.', 'Welcome to {{plan}}',
    '<p>Hi {{name}},</p><p>Your upgrade to <strong>{{plan}}</strong> is complete. Your plan includes <strong>{{credits}} credits</strong> a month.</p><p>If your plan includes AI script writing, try it now: pick a product, choose an angle and send each script straight to a presenter.</p>',
    'Write my first script', '{{app_url}}/app#create'),
  T('renewal_reminder', 'Plan without auto-renew ends in 3 days', 'Your {{plan}} plan ends in 3 days', 'Renew in your wallet to keep your plan and monthly credits.', 'Your plan ends soon',
    '<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> plan ends in 3 days. It does not renew automatically.</p><p>You have <strong>{{credits}} plan credits</strong> left, and they expire with the plan, so now is a good time to use them. Top-up credits are not affected.</p><p>To keep your plan, renew it in your wallet before it ends.</p>',
    'Renew my plan', '{{app_url}}/app#wallet'),
  T('payment_failed', 'Card renewal payment failed', 'Your Vooads card payment did not go through', 'Nothing is lost. Update your card and your {{plan}} plan carries on.', 'Your card payment did not go through',
    '<p>Hi {{name}},</p><p>We tried to charge <strong>{{amount}}</strong> for your <strong>{{plan}}</strong> plan, but the card payment did not go through. This happens: a new card, a bank limit on online payments, or not enough funds at that moment.</p><p>Nothing is lost. Your plan stays active until <strong>{{grace_date}}</strong> while the payment is tried again over the next few days. To sort it now, update your card in your wallet.</p><p>Prefer another way to pay? You can renew with bank transfer, mobile money or crypto from your wallet too.</p>',
    'Update my card', '{{app_url}}/app#wallet'),
  T('paid_credits_low', 'Paid user balance falls below 15% of plan credits', 'You have {{credits}} credits left', 'Buy credits so your tests do not stop mid-week.', 'Your credits are running low',
    '<p>Hi {{name}},</p><p>You are down to <strong>{{credits}} credits</strong> on your {{plan}} plan.</p><p>Buy a credit pack to keep going today (top-up credits never expire), or move to a bigger plan for a better price per credit.</p>',
    'Buy credits', '{{app_url}}/app#wallet'),
  T('trial_credits_low', 'Trial user balance falls below 20% of trial credits', 'You have {{credits}} trial credits left', 'Pick a plan to keep creating without a watermark.', 'Your trial credits are running low',
    '<p>Hi {{name}},</p><p>You have <strong>{{credits}} trial credits</strong> left. When they run out you can still sign in and download what you made.</p><p>A plan gives you monthly credits, UGC videos, no watermark and commercial use in paid ads. After that you can buy extra credits any time.</p>',
    'See plans', '{{app_url}}/#pricing'),
  T('referral_earned', 'Referred user makes a payment', 'You earned {{amount}} from a referral', 'Your commission settles in 30 days.', 'New referral commission',
    '<p>Hi {{name}},</p><p>Someone you referred just paid for Vooads.</p><p>Earnings settle 30 days after the payment. Once your settled balance reaches $300, message support in the studio to withdraw it. Your rate grows with you: 10% with 1 to 4 paying referrals, 20% with 5 to 19, and 30% with 20 or more.</p><p>Your link: {{referral_link}}</p>',
    'View earnings', '{{app_url}}/app#refer'),
  T('long_video_ready', 'Long video job (more than one segment) finishes', 'Your {{seconds}}s video is ready', 'All parts are rendered and joined. Watch it or edit it by chat.', 'Your long video is ready',
    '<p>Hi {{name}},</p><p>Your <strong>{{seconds}}-second</strong> video is done. It was rendered in {{segments}} parts with the same presenter and voice, then joined into one file.</p><p>Watch it once with sound and once on mute: the captions should carry the message on their own. Want a 15-second cut too? Ask the chat editor.</p>',
    'Watch your video', '{{video_page}}'),
];

// "Start with 20 hooks": the hook-pack price comes from the live pricing config, never a number in the copy.
{
  const o = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'content', 'emails', 'emails.json'), 'utf8')).find((e) => e.id === 'trial_inactive_48h');
  if (o) UPGRADED.push({ ...o, preheader: 'The easiest first step in Vooads costs {{hook_cost}} credits.', body_html: o.body_html.replace(/for \d+ credits/, 'for {{hook_cost}} credits'), cta_url: '{{app_url}}/app#create' });
}

module.exports = { NEW, UPGRADED, all: [...NEW, ...UPGRADED] };
