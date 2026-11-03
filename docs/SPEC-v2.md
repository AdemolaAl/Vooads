# Vooads v2 build spec (shared contract for every engineer)

Read this whole file before you touch code. It is the contract between backend, frontend, admin and content.
The app is zero-dependency Node 22 (node:http, node:sqlite). No npm packages. Keep it that way.
Run `npm run check` (end-to-end checks) before you finish; it must pass. Add checks for what you build.

## 0. Ownership (who edits what)
| Owner | Files |
|---|---|
| Pricing analyst | `content/pricing.json`, `content/pricing.md`, `content/research/*.md` |
| Backend A (support + VooSquare + payments) | `server/support.js`, `server/routes/support.js`, `server/payments/custom.js`, `server/payments/gatevoo.js`, `server/payments/index.js`, `server/voosquare.js`, small mount/schema lines in `server/db.js`, `server/index.js`, `server/auth.js` (permissions), `server/seed.js` |
| Backend B (video types, long video, loss guard, AI brain, training voice) | `server/jobs.js`, `server/credits.js`, `server/guard.js`, `server/ai/brain.js`, `server/stitch.js`, `server/routes/studio.js` (new), `server/providers/*`, small lines in `server/routes/admin.js`, `server/settings.js` |
| Frontend (site + studio) | `public/index.html`, `public/app.html`, `public/assets/css/*`, `public/assets/js/*` (not admin) |
| Admin UI | `public/admin.html` only |
| Content | `content/emails/emails.json`, `content/blog/*.md`, `content/ai/*`, `content/training/lessons.json`, `content/sales/*.md` |
Shared files: re-read right before each edit and keep edits small. Never rewrite another owner's file.

## 1. Design language (site, studio, admin) — matches the owner's Gatevoo / Voo family style
- Page ground warm off-white `#F7F6F2`, cards white `#FFFFFF`, ink `#0B0B0A`, secondary grey `#A19E95`, line `#E6E3DA`.
- Brand accent: Vooads orange `#FF4A1C` (used sparingly: key buttons, live dots, highlights). Success green `#1F9D55`.
- Type: "Plus Jakarta Sans" 500–800 (headlines 800, tight tracking -0.05em) + "JetBrains Mono" for small live labels, numbers, timers (e.g. `00:21 · rendering`).
- Headlines are two-tone: first sentence ink, second sentence grey. Example: "Make the ad. **Launch it today.**" (second part grey). No italic serif. No emoji as icons (line icons only).
- Buttons: black pill with a white circle holding an arrow on the right (`Start free (→)`); secondary = white pill with border.
- Rich motion: dark device/phone mockups with animated UI inside (rendering progress, live counters, chat bubbles), floating status chips, real human video loops, smooth scroll reveals that start VISIBLE (never opacity 0 waiting). Respect prefers-reduced-motion.
- Logo: black rounded square with the two eyes (existing `.lmark`), wordmark "Voo" ink + "ads" grey (two-tone like "Gatevoo").
- Humans everywhere: use the media in §9 (people filming, smiling at laptops, support agents). It must feel real, not AI-template.
- Mobile first. No horizontal scroll. Bottom dock in studio on phones.

## 2. Video types registry (pricing.json → `video_types`)
`content/pricing.json` gains (pricing analyst fills real numbers; backend reads them; never hardcode prices):
```json
"credit_usd_value": 0.01,
"min_margin_pct": 60,
"video_types": [
  {
    "id": "ugc_talking",              // stable id
    "name": "UGC talking video",
    "description": "AI creator talks to camera about your product",
    "pipeline": "ugc",                 // ugc | video | slideshow | dub | image_to_video | hook_remix
    "provider_kind": "ugc",            // providers.kind used for the main render
    "unit": "second",                  // second | item
    "credits_per_unit": 15,
    "provider_cost_usd_per_unit": 0.115,
    "segment_seconds": 10,             // provider max per render; longer videos are rendered in segments and stitched
    "min_seconds": 5,
    "max_seconds_by_plan": {"starter": 30, "pro": 60, "scale": 90, "agency": 120},
    "min_plan": "starter",             // null = trial allowed
    "extras": {"ai_script": 8, "captions": 0},
    "enabled": true,
    "badge": "Most used"
  }
]
```
Backend keeps `costs` (existing keys) working for backward compatibility.

## 3. Long videos (segments)
- If requested seconds > `segment_seconds`, the job renders N = ceil(seconds / segment_seconds) segments in order, each with the next slice of the script and the same presenter/voice, then stitches them with ffmpeg (`server/stitch.js`, uses `ffmpeg` on PATH; nixpacks installs it via `nixpacks.toml` `[phases.setup] nixPkgs = ["...", "ffmpeg"]`).
- If ffmpeg is missing, the job still finishes and returns `output.segments: [{url, start, end}]` plus a note; the studio shows them as a playlist.
- Price is linear per second (no discount for length) so long videos are never cheaper per second than short ones. The quote shows segment count. Credits are taken up front; a failed job refunds everything.
- Studio shows: "60s video = 6 parts of 10s, stitched automatically".

## 4. Loss guard (`server/guard.js`)
- `worstCaseUsdPerCredit()` = the LOWEST price a customer can pay per credit across all plans (monthly and yearly/12) and top-ups and active discount codes (max discount %).
- `check(type, input)` → `{ ok, credits, providerCostUsd, revenueUsd, marginPct }`; revenue = credits × worstCaseUsdPerCredit.
- If marginPct < `min_margin_pct`, the job is NOT allowed at that price: `jobs.create` raises the credits to the minimum safe amount (`Math.ceil(cost / (1 - m) / usdPerCredit)`) and the quote returns `{credits, adjusted:true}`. Never run a job at a loss.
- Provider cost per unit comes from the provider row actually selected for the job (`providers.cost_usd` + `cost_unit`), falling back to the video type's `provider_cost_usd_per_unit`.
- Abuse limits in settings `limits`: `trial_max_jobs_per_day` (default 10), `max_concurrent_jobs` per user (default 3), `daily_credit_cap` per user (default 0 = off), `max_signups_per_ip_per_day` (default 3).
- Admin API: `GET /api/admin/margins` → per video type and job type: provider cost, credits, worst-case revenue, margin %, status ok|low|loss; `PUT /api/admin/settings/limits`.

## 5. Support tickets + VooSquare
Tables (Backend A creates in `server/support.js` `migrate(db)`):
- `tickets(id, user_id, subject, category, status, priority, channel, assignee_staff_id, assignee_ext_id, assignee_ext_name, voo_ticket_id, phone, call_time, created_at, updated_at, first_response_at, last_customer_at, last_staff_at, sla_due_at)`
  - status: `open | pending | solved | closed`; priority: `low | normal | high | urgent`; category: `billing | video | account | bug | call | other`; channel: `web | email | voosquare`.
- `ticket_messages(id, ticket_id, author_type, author_id, author_name, body, internal, attachments, created_at)` author_type: `customer | staff | voosquare | system | bot`.
- `macros(id, title, body, created_by, created_at)`.
- Migrate old `support_messages` rows into one ticket per user ("Chat with support"), keep the old table.

Customer API (cookie session):
- `GET /api/tickets` → `{tickets:[{id,subject,status,priority,category,updated_at,unread}]}`
- `POST /api/tickets` `{subject, body, category, priority?, phone?, call_time?}` → `{ticket}`; category `call` = callback request.
- `GET /api/tickets/:id` → `{ticket, messages:[{id,author_type,author_name,body,created_at}]}` (internal notes hidden)
- `POST /api/tickets/:id/messages` `{body}`; `POST /api/tickets/:id/close`
- Old `/api/support` GET/POST keep working (map to the newest open ticket).
- Bot: when a ticket is created, a `bot` message answers instantly with up to 3 matching help articles from the help center (content/training + FAQ) and the expected reply time.

Admin API (permissions below):
- `GET /api/admin/tickets?status=&priority=&assignee=me|none|<id>&q=&page=` → `{tickets, counts:{open,pending,solved,mine,unassigned,overdue}}`
- `GET /api/admin/tickets/:id` → `{ticket, messages, user, recent_jobs, recent_payments}`
- `POST /api/admin/tickets/:id/reply` `{body, internal, status?}`; `PUT /api/admin/tickets/:id` `{status, priority, assignee_staff_id, category}`
- `POST /api/admin/tickets/:id/credits` `{amount, reason}` (respects role `max_credit_grant`)
- Macros: `GET/POST /api/admin/macros`, `PUT/DELETE /api/admin/macros/:id`
- Support settings: `GET/PUT /api/admin/support-settings` → `{voosquare:{enabled, mode:'both'|'vooads'|'voosquare', events_url, max_credit_grant}, sla_hours:{urgent:1,high:4,normal:12,low:24}, auto_reply:true, business_hours:"..."}`
Permissions (add to PERMISSIONS in auth.js): `tickets.view`, `tickets.reply`, `tickets.assign`, `tickets.manage`, `calls.handle`. Role limits: `max_credit_grant`, `ticket_scope: 'all' | 'assigned'`. Seeded roles: Support gets tickets.view/reply/assign + calls.handle with scope 'all'; a new seeded role "Support (assigned only)" with scope 'assigned'.

VooSquare (Backend A, `server/voosquare.js`):
- Outbound events to `support-settings.voosquare.events_url` (default `VOO_SUPPORT_EVENTS_URL` env or `https://api.voosquare.com/v1/support/events`), JSON body, header `X-Voo-Signature: sha256=<hex HMAC of raw body with VOO_WEBHOOK_SECRET>`, `X-Voo-Tool: vooads`, retries 3x. Events: `ticket.created`, `ticket.message`, `ticket.updated`. Payload `{event_id, type, occurred_at, tool:'vooads', ticket:{...}, customer:{id,email,name,plan,voo_id}, message?:{...}}`.
- Inbound (VooSquare calls Vooads), header `Authorization: Bearer <VOO_SERVICE_KEY>`:
  - `GET /api/voosquare/support/tickets?status=&updated_since=` 
  - `GET /api/voosquare/support/tickets/:id`
  - `POST /api/voosquare/support/tickets/:id/reply` `{body, internal, agent:{id,name,email,role}}`
  - `PUT /api/voosquare/support/tickets/:id` `{status, priority, assignee:{id,name}}`
  - `POST /api/voosquare/support/tickets/:id/credits` `{amount, reason, agent}` capped by `voosquare.max_credit_grant`
  - `GET /api/voosquare/support/stats` → counts for VooSquare's dashboard
  - VooSquare owns its own agents, roles and limits; Vooads trusts the agent identity it sends, logs every action to `audit_log` as `voosquare:<agent email>`, and enforces the global caps.
- When `mode` = 'voosquare', the admin inbox is read-only with a banner "Replies happen in VooSquare".
- Emails: customer gets `ticket_reply` email on every public staff/VooSquare reply; support inbox (SUPPORT_EMAIL) gets `ticket_new` on new tickets.

## 6. Payments: custom + Gatevoo
- `server/payments/gatevoo.js`: config `{base_url (default https://api.gatevoo.com), currency:'USDT', network:'TRC20'}`, secret = API key, webhookSecret.
  - Checkout: `POST {base}/v1/invoices` Bearer secret, body `{amount_usd, order_id:"va_<paymentId>", description, customer_email, success_url, cancel_url, webhook_url, metadata:{payment_id}}` → `{id, checkout_url}`.
  - Webhook: header `X-Gatevoo-Signature: sha256=<HMAC of raw body with webhookSecret>`; event `{type:'invoice.paid', data:{order_id, amount_usd, tx_hash}}` → paid. `invoice.expired` → ignore.
  - This is the contract Gatevoo must implement; document it in `docs/GATEVOO-API.md`.
- `server/payments/custom.js` (any provider, no code): config fields
  `{checkout_url, method:'POST', headers_json, body_template (JSON with {{amount_usd}} {{amount_local}} {{currency}} {{payment_id}} {{email}} {{success_url}} {{cancel_url}} {{webhook_url}} {{description}}), response_url_path (e.g. data.link), signature_header, signature_algo ('sha256'|'sha512'|'none'), signature_prefix, paid_path (e.g. event), paid_value (e.g. charge.success), payment_id_path (e.g. data.metadata.payment_id), amount_path, usd_rate, currency}`
  Multiple custom methods allowed (each its own row, `adapter:'custom'`), webhook URL `/api/webhooks/custom/<methodId>`.
- Admin payment method form must show these fields with help text (Admin UI).

## 7. AI brain (Backend B + Content)
- Content writes: `content/ai/playbook.md` (core ad-creative knowledge: hook frameworks, UGC script structures, pacing per length, CTA patterns, platform policy rules, what converts), `content/ai/verticals.json` (array: `{id, name, audiences, pains, angles[], hook_examples[], proof_types[], ctas[], banned_claims[], compliance_notes, best_formats[]}` for at least: beauty, skincare, supplements, fitness, weight-management, fashion, ecommerce gadgets, home, pets, food & drink, SaaS, mobile apps, fintech/budgeting, trading/investing education, crypto apps, iGaming/sweepstakes (where legal, 18+), education/courses, coaching, travel, real estate, local services, health clinics), `content/ai/trends.md` (dated notes the admin updates weekly), `content/ai/script-templates.json` (10+ named structures with beat timings for 15/30/60s).
- `server/ai/brain.js`: `systemFor(task, input)` builds the system prompt from playbook + the matching vertical (input.niche or auto-detect by keywords) + trends + platform rules; `scriptPlan(seconds)` returns beats. jobs.js uses it for hooks, scripts and UGC scripts. Admin can edit all of it (settings keys `ai_playbook`, `ai_verticals`, `ai_trends`) via `GET/PUT /api/admin/ai-brain`.
- New job type `angles`: 10 angles with hook + why it works for the vertical (cheap text job, 2 credits).

## 8. Training center
- Content writes `content/training/lessons.json`: `[{id, title, minutes, level, summary, scenes:[{screen: 'home'|'create'|'create-ugc'|'library'|'wallet'|'shield'|'support'|'refer'|'settings', target: '<css selector inside the mock screen>', action: 'point'|'click'|'type'|'scroll', text?: '<typed text>', caption, narration}]}]` — 8 lessons minimum (Getting started, First UGC video, Long videos, Languages & geos, Ban Shield, Credits & plans, Support & tickets, Scaling a winner).
- Backend B: `GET /api/training` (public) returns lessons + `audio:{<lessonId>:[url per scene]}` for generated narration; `POST /api/admin/training/voice` generates mp3 per scene through the default `voice` provider (ElevenLabs) into media and stores the map in settings `training_audio`.
- Frontend: "Learn" page in the studio + "Watch how it works" on the site: a video-like player (16:9 frame, play/pause, scrubber, chapters, captions, speed) that animates a faithful mock of the studio UI (cursor moves, clicks ripple, fields type, highlights) and plays the narration mp3s, falling back to the browser's speechSynthesis (pick the most natural English voice available) when no mp3 exists.

## 9. Media (generated with Higgsfield, served through `server/samples.js` names)
Existing: ugc-serum.mp4, ugc-sunscreen.mp4, ugc-protein.mp4, ugc-saas.mp4, ugc-fintech.mp4, ugc-sneakers.mp4, ugc-serum-es.mp4, ugc-language-app.mp4, buyer-1.png, buyer-2.png, creator-3..6.png.
New (being generated now; use these exact names under `/samples/`):
- `life-buyer-laptop.mp4` (media buyer smiling at laptop, results going up), `life-creator-filming.mp4` (woman filming herself with a phone, happy), `life-team-celebrate.mp4` (small team celebrating at desk), `life-phone-scroll.mp4` (person scrolling ads on phone, smiling)
- `support-agent-1.mp4` + `support-agent-1.png` (friendly support agent with headset waving), `support-agent-2.png`, `support-agent-3.png`
- `ad-explainer-vooads.mp4` (15s talking presenter explaining Vooads, with audio), `ad-skincare-v2.mp4`, `ad-app-v2.mp4` (10s realistic UGC ads with audio). Label them "AI-generated sample ad". Do NOT label any of these "made with Vooads": they were made with another tool. (`support-agent-1.mp4` will not exist; animate the agent photos with CSS instead.)
- poster images for videos: same name with `.jpg` may not exist — use the first frame (`preload="metadata"`) and a dark fallback.

## 10. Emails + sales (Content)
- Add/upgrade templates in emails.json (same fields): `welcome` (rewrite: warm, animated GIF header, 3 quick wins), `onboarding_day1` … plus sales follow-ups: `sales_day2_first_video_nudge`, `sales_day4_case_study`, `sales_day6_objections`, `sales_day8_offer_last_call`, `sales_day12_founder_note`, `trial_inactive_48h`, `upgrade_after_first_hooks`, `ticket_reply`, `ticket_new`, `long_video_ready`. Each with `trigger`, `delay`, subject, preheader, heading, body_html, cta_label, cta_url. No fake testimonials or invented numbers about real customers.
- `content/sales/sales-playbook.md`: CSO playbook (ICP, offer, pricing talk track, objection handling, DM scripts for Telegram/WhatsApp/X, cold email sequence, demo script, follow-up cadence, referral pitch).
- Blog: 4 new detailed posts (front-matter like existing): long UGC videos and segment stitching, slideshow/carousel video ads, scaling a winner into 10 geos, AI brain: writing hooks per vertical.

## 11. Definition of done
- `npm run check` passes and covers your feature.
- No JS errors at 1440px and 390px; no horizontal scroll.
- Every claim on the site is something the code does.

## 12. v2.1 additions: animated ads, music, voice tiers, pronunciation
Owner asks (3 Oct 2026): animated ads with stock footage, graphics, voiceover and music; customers choose Standard or Ultra-realistic quality at different prices; background music as a paid add-on; "Vooads" must be pronounced correctly in every voiceover. Everything must stay profitable through the profit guard.

### pricing.json (pricing analyst owns)
- Two new video types (same schema as §2): `motion_ad` (pipeline `motion_ad`, `quality: "standard"`: stock footage + AI images + kinetic text + standard voice) and `motion_ad_ultra` (pipeline `motion_ad`, `quality: "ultra"`: AI-generated video scenes + ultra-realistic voice). Both `unit: "second"`, `segment_seconds` = scene length, min_plan starter.
- `addons`:
```json
"addons": {
  "music": {"name": "Background music", "unit": "second", "credits_per_unit": 0, "provider_cost_usd_per_unit": 0, "provider_kind": "music", "min_plan": "starter", "library_credits_per_unit": 0},
  "voice_ultra": {"name": "Ultra-realistic voice", "unit": "second", "credits_per_unit": 0, "provider_cost_usd_per_unit": 0, "provider_kind": "voice", "min_plan": "starter"}
}
```
  (`library_credits_per_unit` = price when the track comes from the free admin-uploaded music library; may be 0 or small.)
- `voice_tiers`: `{"standard": {"label": "Standard voice", "provider_hint": "..."}, "ultra": {"label": "Ultra-realistic voice", "provider_hint": "..."}}`.

### Job input (backend B owns)
- Any video type that has audio accepts `music: {enabled: bool, mood: "upbeat"|"chill"|"cinematic"|"corporate"|"hiphop"|"emotional", source: "ai"|"library"}` and `voice_tier: "standard"|"ultra"`.
- Quote adds addon credits × seconds; the profit guard includes addon provider costs.
- `motion_ad` input: `product`, `duration` (10–60), `aspect` (9:16 | 1:1 | 16:9), `style` ("bold" | "clean" | "luxury" | "playful" | "tech"), `brand_color`, optional `logo_url`, `image_url` (product photo), `script` or `write_script`, `language`, `cta`, `music`, `voice_tier`.
- Pipeline: AI writes a scene plan (4–8 scenes: on-screen headline ≤ 6 words, VO line, visual query) → visuals per scene: standard = stock video from provider kind `stock` (Pexels API, Pixabay API; free keys) falling back to AI images with Ken Burns; ultra = AI video per scene (provider kind `video`) → voiceover (provider kind `voice`, tier chosen) → music (provider kind `music`: adapters `elevenlabs_music`, generic `http`, or `library` = random track of the chosen mood from media the admin uploaded) → ffmpeg compose: scene cuts with short transitions, kinetic headline text (drawtext, bold font, brand colour bars), product photo/logo end card with CTA, VO on top, music ducked under voice (sidechaincompress) at about -18 dB, loudness normalised (loudnorm -14 LUFS), captions SRT. Without ffmpeg: return scenes + audio as a playlist with a note.
- Demo/mock mode returns sample outputs for all of this.

### Pronunciation dictionary
- Setting `pronunciations`: `[{"word": "Vooads", "say": "Voo-ads"}, {"word": "VooSquare", "say": "Voo-square"}, {"word": "Zedapex", "say": "Zed-a-pex"}, ...]`, editable in admin; applied case-insensitively on whole words to EVERY text sent to a TTS provider (UGC voice, motion ads, dub, training narration). Exposed read-only in `GET /api/public/config` as `pronunciations` so the trainer's speechSynthesis fallback applies it too. Also tell the script writer (AI brain) to spell the brand exactly as given.

### Admin (admin UI owns)
- Pronunciation dictionary editor (add/remove rows, "test" button that speaks the line with speechSynthesis).
- Music library: upload mp3 tracks with a mood tag (stored as media), list/delete; music provider settings live in AI providers (kind `music`); stock footage providers (kind `stock`) with key fields.
- Pricing: edit `addons` and the two new video types with live margin preview.

### Studio (frontend owns)
- Builder: "Animated ad" type cards (Standard / Ultra-realistic with clear price difference shown per 15s), style picker, aspect, brand colour, logo/product photo upload, CTA; "Background music" toggle with mood chips and price per second; "Voice" toggle Standard / Ultra-realistic with price; summary shows add-on lines.
- Site: "Animated ads" section showing the new promo ads (`/samples/promo-*.mp4`, see below) and the two quality tiers.

### New media (being produced now; names under /samples/)
`promo-motion-sample.mp4` (1:1 sample animated product ad). Label the product sample "AI-generated sample". The two promos are Vooads' own ads.

## 13. v2.2: quality levels (owner approved 4 Oct 2026)
Customers choose a quality level and model for video, each with its own price and API, never at a loss.

### pricing.json → `video_types[].levels` (optional; types without it behave exactly as before)
```json
"levels": [
  {"id": "standard", "name": "Standard", "model_label": "Kling Avatar v2", "benefit": "...", "provider_tag": "kling-avatar-v2-pro", "credits_per_unit": 15, "provider_cost_usd_per_unit": 0.115, "min_plan": null, "segment_seconds": null, "enabled": true, "notes": "source + date"},
  {"id": "pro", "name": "Pro realistic", "model_label": "OmniHuman 1.5", "provider_tag": "omnihuman-1.5", "credits_per_unit": 22, "min_plan": "pro", ...},
  {"id": "ultra", "name": "Ultra cinematic", "model_label": "Google Veo 3.1", "provider_tag": "veo-3.1", "credits_per_unit": 45, "min_plan": "scale", "segment_seconds": 8, ...}
]
```
- `id` is `standard` | `pro` | `ultra` (also the cost rank). `credits_per_unit`, `provider_cost_usd_per_unit` (fallback when no provider row has a cost) and `segment_seconds` replace the type's own values for that level. `min_plan: null` = same as the type.
- Levels exist on types whose `provider_kind` is `ugc` or `video`: the three UGC types and hook remix (ugc), product b-roll, photo to video and Animated ad Ultra scenes (video). Saved pricing without `levels` gets them from the file once (`settings.mergePricing`); `"levels": []` keeps none.

### Provider rows (`server/seed.js`, kinds `ugc` / `video`)
- `config.level` (`standard` default) and `config.tag` (e.g. `veo-3.1`). Optional `config.clip_durations` (fixed clip lengths the model bills, e.g. `[4, 6, 8]`), `config.duration_suffix` (`"s"` → Veo wants `"8s"`), `config.input: "dialogue"` (a video model that speaks the line itself: Veo 3.1 for UGC Ultra; the presenter photo is the first frame).
- Seeded for new and existing databases (by name): OmniHuman v1.5 (ugc, pro), Veo 3.1 (ugc, ultra), Kling 3.0 Pro (video, pro), Veo 3.1 (video, ultra), Veo 3.1 Fast (video, pro, **off**), Seedance 2.0 (video, ultra, **off**). Existing rows are tagged standard once (flag `levels_v22`).
- One fal key: a fal row without its own key uses the key saved on another fal row (`providers.chain`).

### Logic (`server/levels.js`, pure, also embedded in the demo)
- `available(vt)`: enabled levels with at least one enabled model (standard is always there). Unavailable levels are hidden.
- Quote: `baseQuote` applies the level; `clipsFor` splits the length into the clips the model renders (cheapest covering set of fixed lengths for Veo). `quoteFull` returns `level`, `level_name`, `model_label`, `clips`, `main_cost_usd`.
- Guard (`server/guard.js`): the main render is priced on `levels.mainCost` = the **most expensive enabled row of the level** (main model + same-level fallbacks), billing fixed clip lengths. Jobs without a level price on standard rows. Animated ad Ultra prices each scene's real shot length.
- Run time (`jobs.levelChain`): the level's main model, then other same-level rows, then higher-level rows only while `job credits × worst $/credit × (1 − min margin)` still covers the rest of the job plus that model. Never a cheaper level; nothing left → the job fails and is refunded.

### API
- `POST /api/quote` and `POST /api/jobs` accept `level` (default `standard`). Unknown or unavailable level → 400. Level above the plan → **403** `{error, locked: true, level, min_plan, upgrade: {plan_id, plan_name, price_month}}`. Plan max seconds still apply.
- Jobs store `input.level`, `level_name`, `model`, `level_tag`, `clips`; `GET /api/jobs` returns `level`, `level_name`, `model`.
- `GET /api/video-types` → each type has `levels: [{id, name, model_label, benefit, credits_per_unit, min_plan, min_plan_name, segment_seconds, locked, locked_reason}]` (available ones only).
- `GET /api/admin/margins` adds rows `kind: "video_type_level"` (`id` = `type:level`, `provider` = model, `credits_per_unit`, `sample_units`, `safe_credits_per_unit`). `PUT /api/admin/pricing` validates levels, raises any enabled level below the minimum margin to the guard's safe price and returns `raised: [{type, level, from, to}]`.

### Studio and admin
- Studio: after a video type is picked, a **Quality** picker (3 tiles: badge, level, model, one-line benefit, credits/s chip, lock chip with the plan; Ultra has a light sweep) and a live total ("30 sec · 450 credits"). Locked tiles open the upgrade sheet. The summary shows the level and model; My ads cards show the level.
- Admin → Pricing → Video types: per level the model menu (rows of that kind and level), customer-facing model name, credits, lowest plan, on/off and the guard's live margin. Admin → Profit guard lists every level.


## 14. v2.3: editing tools (owner approved 4 Oct 2026)
Three video types that work on the customer's own footage or make brand audio. Prices and margins: `content/pricing.md` §14.

| id | pipeline | Input | Steps (server/videotools.js) |
|---|---|---|---|
| `bg_swap` | `bg_swap` | `upload_id`, `bg_kind` color/image/ai/stock, `bg_color`, `bg_image_url`, `bg_prompt`, `bg_query`, `aspect` original/9:16/4:5/1:1/16:9 | prep (>60 fps or >1080p is re-timed/scaled) → background (image / stock provider) → `matting` provider (fal VEED, signed link to the upload) → ffmpeg composite (original audio kept) |
| `auto_edit` | `auto_edit` | `upload_id`, `aspect` 9:16/4:5/1:1, `caption_style` bold/clean/boxed, `captions`, `remove_silences`, `hook_first`, `end_card`, `cta`, `logo_url`, `brand_color`, `music` | audio (ffmpeg) → `stt` provider (word timings) → AI edit plan (text provider, JSON) validated by `editkit.validatePlan` → cut list → ffmpeg render (per-piece accurate cuts + reframe + punch-ins, 0.08 s crossfades up to 24 pieces, ASS captions, music ducking, −14 LUFS, end card) + SRT |
| `brand_music` | `brand_music` | `product` (brief), `brand_name`, `duration` 15/30/60/120, `vocals`, `lyrics`, `mood`, `genre`, `tempo` | AI `music` rows only (never the library) → saved in `brand_tracks` |

- **Uploads** (`server/uploads.js`, `POST /api/uploads/video?for=bg_swap|auto_edit`): streamed to `DATA_DIR/uploads/<user>/`
  with a byte cap, magic bytes (ftyp/QuickTime atoms/EBML), then ffprobe (duration, streams, size, fps). Paid plans only.
  Private: providers get `APP_URL/u/<id>.<ext>?e=&s=` (HMAC, expires). Quota `limits.upload_quota_mb`, deleted after
  `limits.upload_keep_days` (hourly sweep). The video type's `upload: {max_seconds, max_mb}` overrides the defaults.
- **Edit plan safety**: the AI returns `{remove:[{start,end}], hook:{start,end}, emphasis:[t]}`. Non-numbers, reversed,
  out-of-range and half-video cuts are dropped, the rest clamped, merged and snapped to word edges; AI cuts that remove more
  than 70% are ignored; silences > 0.6 s and fillers are cut by our own code; the video is never cut to nothing.
- **ffmpeg safety**: user text only reaches ffmpeg through files we write (ASS captions with `{}`/`\` removed, drawtext
  `textfile=`). Filter-path values are quoted. `FFMPEG_CONCURRENCY` (default 1), `FFMPEG_THREADS` (2), `-preset veryfast`,
  1080p cap, per-step timeouts, temp folders always deleted.
- **Brand tracks**: `GET/PUT/DELETE /api/brand-tracks`. Any video with music can use `music: {source: 'brand', track_id}`:
  0 credits, checked to be the customer's own track at quote, at create and again at run time.
- **Provider kinds** added: `matting`, `stt`, `autoedit` (an enabled live `autoedit` row hands the whole auto-edit to that
  service; Submagic preset seeded off). Demo provider: green colour-key matting, a fake transcript, a deterministic plan,
  a synthesised music file, so every pipeline runs end to end without keys.
- **Refunds**: every failure (upload gone, provider down, ffmpeg error) fails the job and refunds through `jobs.failJob`.
