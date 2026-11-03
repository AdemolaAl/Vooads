# Vooads developer guide

For developers working on Vooads (the AI ad studio by Zedapex). Owner-facing setup is in `README.md` (section 1: deploy, staging, backups). Product rules are in `docs/SPEC-v2.md`, prices in `content/pricing.md`.

**The short version:** Node 22.13+, no npm packages, `node:http` + `node:sqlite`. `npm start` runs it, `npm run check` tests it end to end, `npm run check:syntax` parses every file. Build on the `staging` branch; `main` is the live site.

---

## 1. Architecture map

```
server/
  index.js          HTTP server: security headers → CSRF check → router → static files → error handler; starts the workers
  config.js         environment (APP_SECRET, APP_ENV production|staging|development, DATA_DIR, version, ...)
  db.js             SQLite file DATA_DIR/vooads.db, WAL mode, boot backup, core schema, helpers get/all/run/tx/J
  backups.js        VACUUM INTO copies in DATA_DIR/backups (boot + owner "Back up now"), newest 10 kept
  staging.js        staging guards: email allowlist, test-only payments, banner, sample data
  seed.js           first-run rows: roles, AI provider slots, payment slots, email templates, blog posts (idempotent)
  settings.js       key/value settings (pricing, limits, site, voices, presenters...) with defaults from content/
  auth.js           email-code login, sessions (hashed ids, 30-day "keep me signed in"), staff PERMISSIONS, can()
  roles.js team.js  role builder: permission groups, presets, per-role limits (credit grants, refunds)
  credits.js        three buckets (trial / plan / top-up), quote(), spend(), refund(), grant(), ledger
  guard.js          profit guard (minimum margin on every price) + abuse limits (signups per IP, concurrent jobs)
  levels.js         quality levels standard / pro / ultra: which provider row (model) and price each level uses
  videotypes.js     video type registry (pricing.video_types) and its 10 pipelines
  addons.js         music and ultra-voice add-ons
  jobs.js           job creation, validation, pricing, and the worker that advances every job step by step
  stitch.js         ffmpeg: join segments, slideshows, hook splicing, motion ads, music mixing
  videotools.js     bg_swap (Change background), auto_edit (Auto-edit), brand_music (Brand tracks)
  editkit.js        ffmpeg toolkit for those tools (captions files, filters; user text never reaches a command line)
  uploads.js        private customer video uploads: magic bytes + ffprobe checks, quotas, signed /u/ links, 7-day cleanup
  media.js          generated files in DATA_DIR/media, served at /media/<id>; mirrors provider links (MIRROR_MEDIA)
  providers/        AI adapters (see §4)
  payments/         payment adapters (see §5)
  paysandbox.js     "Test (sandbox)" for payment methods: signed fake webhooks inside a rolled-back savepoint
  billing.js        checkout, markPaid (idempotent), plan activation, renewals, discount codes
  finance*.js       revenue, MRR, customer spend, CSV export (formula-injection safe)
  email/            transactional emails (templates in DB, Resend, queue, sequences)
  mail/             campaigns: composer blocks → HTML, audiences, throttled sender, tracking, unsubscribe, suppression
  support.js        tickets, SLA, bot reply, macros, VooSquare support events
  aitools*.js       no-code AI tools (Draft → Testing → Live, versions)
  aimodels.js       "Add AI model" wizard (any fal / Replicate / OpenAI-compatible / HTTP model, dry run)
  integrations.js   Admin → Integrations overview and Test buttons
  voosquare.js vooconnect.js oidc.js   VooSquare events, connection wizard, "Continue with Voo ID" login
  shield.js         Ban Shield rules
  ai/brain.js       creative knowledge (content/ai/*) that briefs every text prompt
  routes/           api.js (customer), admin.js, business.js, studio.js, support.js, mail.js, videotools.js, pages.js
  lib/              http.js (router, body limits, static files, rate limits), util.js (crypto, ids), markdown.js
  selfcheck*.js     npm run check
public/             index.html (site, owned by the copy/design team), app.html (studio), admin.html (admin), assets/
content/            pricing.json/.md, legal/, blog/, emails/, ai/, training/
docs/               SPEC-v2.md, GATEVOO-API.md, VOOSQUARE-SUPPORT-API.md, this guide
.github/workflows/check.yml   CI: syntax + npm run check on every PR and push to main/staging
railway.json nixpacks.toml    Railway: Node 22 + ffmpeg, npm start, health check /healthz (180 s)
```

### Request flow
1. `server/index.js` sets security headers (CSP, nosniff, frame options; HSTS in production; `noindex` on staging).
2. `lib/http.js decorate()` parses the URL, cookies and client IP, and adds `res.json/html/redirect/cookie`.
3. **CSRF:** any non-GET `/api/*` request (except `/api/webhooks/*`) with a foreign `Origin`, a cross-site `Sec-Fetch-Site`, or a foreign `Referer` is refused with 403. Session cookies are `HttpOnly; SameSite=Lax` (`Secure` in production).
4. The router runs the handler. Handlers call `auth.requireUser(req)` or `auth.requireStaff(req, 'permission')` first; they throw `fail(status, message)` for clean errors.
5. Not an API route: static file from `public/`. Errors: JSON `{error}`; 5xx messages are hidden in production; 413 closes the connection.
6. Bodies: `parseJson` reads at most 2 MB (`readBody(req, limit)` for uploads; videos stream to disk in `uploads.js`).

### Jobs and the worker
- `POST /api/jobs` → `jobs.create(user, type, input)`: cleans the input per pipeline, checks plan, level and limits (`guard.checkJobLimits`), prices it (`credits.quote` + `guard`), spends credits in a transaction and inserts a `queued` job.
- `jobs.start()` runs `tick()` every `JOB_TICK_MS` (2.5 s). `advance(job)` moves a job through its steps (script → voice → video segments → stitch → music → done). Each provider call is `runStep()`: submit, then poll on later ticks; state lives in `jobs.state` so a restart resumes where it was.
- Provider failure → the next provider of the same kind/level (`providers.chain`, `levels.levelChain`); nothing left → `failJob()` refunds every credit.
- Long videos are made in segments and joined by `stitch.js` (ffmpeg); without ffmpeg the output is a playlist.

### Pricing, profit guard and levels
- Prices live in the `pricing` setting (`content/pricing.json` on first boot, then Admin → Pricing). `credits.quote(type, input, user)` gives the credit price.
- `guard.js` checks every price against the **cheapest price a customer can pay for a credit** and the **real provider cost** (provider rows' `cost_usd`). If the margin would drop below `min_margin_pct` (60%), the price goes up. It never runs a job at a loss. Admin → Profit guard shows every row.
- `levels.js`: a video type can offer `standard`, `pro`, `ultra`. Each level = provider rows tagged `config.level`. A job is priced on the most expensive enabled model of its level. Pro needs the Pro plan, Ultra the Scale plan.

### Uploads, media, mail, business, video tools
- **Uploads** (`uploads.js`): `POST /api/uploads/video?for=bg_swap|auto_edit` streams to `DATA_DIR/uploads/<user>/`, hard size cap per purpose, magic bytes + ffprobe check, 2 GB quota, deleted after 7 days. AI providers fetch them through signed, expiring `/u/<id>?e=&s=` links.
- **Media** (`media.js`): outputs in `DATA_DIR/media`, served at `/media/<id>` with `nosniff`. Images uploaded by customers are checked by bytes (`util.isImage`), SVG is refused.
- **Mail** (`server/mail/`): composer blocks → sanitized HTML (`sanitize.js`, `render.js`), audiences (`audience.js`), a throttled worker (`sender.js`) with retries and idempotency keys, open/click tracking, one-click unsubscribe (`/m/u/<token>`), Resend webhook for bounces/complaints → suppression list.
- **Business** (`routes/business.js`, `finance*.js`, `aitools*.js`, `aimodels.js`, `vooconnect.js`): money views and CSV, payment wizard + sandbox, bank transfers with receipt review, AI model wizard, AI tools builder, Connect VooSquare.
- **Video tools** (`videotools.js` + `editkit.js`): bg_swap (matting provider + ffmpeg composite), auto_edit (speech-to-text word timings → cut list validated by code → captions → music → end card), brand_music (music provider → "My brand tracks", reusable for free).

### Environments
`config.appEnv` is `production`, `staging` or `development` (APP_ENV, else Railway's environment name, else NODE_ENV). `config.isProd` (secure cookies, hidden error details) is true on Railway for both production and staging. `config.testPayments` is true on development and staging only. Staging guards: `server/staging.js` (README step 9).

### Database and migrations
- One SQLite file. Each module creates its own tables with `CREATE TABLE IF NOT EXISTS` and adds columns only after checking `PRAGMA table_info` (see `finance.js`, `auth.js`, `support.js`). This runs at every boot.
- **Rules:** forward-only and additive. Never drop or rename a table or column, never change a column's meaning; add a new one instead. Old code must keep working on the new schema (Railway rollback does not roll back the Volume).
- Before any of it runs, `db.js` copies an existing database to `DATA_DIR/backups/vooads-<date>-<time>-boot.db` (`BACKUP_ON_BOOT=0` turns it off). The staging self-check boots twice and asserts the schema is unchanged by the second boot.

---

## 2. Add a new video type

**No code (reuses an existing pipeline):** Admin → Pricing → Video types → **Add a video type** → pick the pipeline (`ugc`, `video`, `image_to_video`, `slideshow`, `dub`, `hook_remix`, `motion_ad`, `bg_swap`, `auto_edit`, `brand_music`), set id, name, credits per unit, real provider cost, limits per plan and levels → switch it on. The profit guard checks it when you save. Example: a "Testimonial" type that is the `ugc` pipeline with a different description and price.

**Code (a new pipeline):**
1. `server/videotypes.js`: add the pipeline to `PIPELINES` and a `BUILTIN` entry (safety-net defaults).
2. `server/jobs.js`: add it to `VIDEO_PIPELINES`; validate and clean its input in `create()`; add its steps in `advance()` using `runStep()` / `background()` so it survives restarts; call `failJob()` on errors (it refunds).
3. `server/guard.js`: make sure `costParts()` knows its provider cost (so the margin check is right).
4. Studio form: `public/app.html` (create flow) or `public/assets/js/voo-studio-x.js`; library card in the result view.
5. `content/pricing.json` → `video_types` entry; `content/pricing.md` arithmetic.
6. Self-check in `server/selfcheck-studio.js` (or a new `selfcheck-<group>.js` registered in `selfcheck.js`). Keep the demo green (`/home/claude/vooads-demo`: its fake backend may need the new route).

## 3. Add a new AI tool (text, image, video or audio from a prompt)

**No code (preferred):** Admin → **AI tools → New AI tool**: inputs, a prompt template with `{{field}}` placeholders, a model kind, a price. It starts as **Draft** (staff use **Try it**), then **Testing** (only listed tester emails see it in the studio), then **Publish / Go live**. Every edit is a new version; live customers keep the published version until you publish again; old versions can be restored. The profit guard raises the price if the model cost needs it. Customers run tools at `POST /api/tools/:slug/run`.

**Code:** tool rules are in `server/aitools-core.js` (pure, shared with the demo), storage and versions in `server/aitools.js`, routes in `routes/business.js`.

## 4. Add a new AI provider (adapter)

**No code:** Admin → AI providers → **Add AI model** wizard: fal (any model id), Replicate, OpenAI-compatible (OpenRouter, Together, Groq, OpenAI), ElevenLabs, or **Custom HTTP** (`providers/http.js`: URL, headers and JSON body templates with `{{prompt}}`, `{{key}}`, output path). Enter the real cost, press the dry-run test, choose where it is used (default / backup / a level).

**Code:** create `server/providers/<name>.js` exporting:
```js
async function submit(provider, kind, input) { /* return { done: true, result } or { done: false, id } */ }
async function poll(provider, kind, id) { /* return { done, result } */ }   // only for async APIs
async function test(provider) { return { ok, note }; }                         // used by the Test button
module.exports = { submit, poll, test };
```
Then list it in `ADAPTERS` and `CAPABILITIES` in `server/providers/index.js`, add its label in `ADAPTER_INFO` in `public/admin.html`, and seed a row in `server/seed.js` (new rows go in a versioned list so existing databases get them once). Use `providers/net.js req()` (timeouts, readable errors). Never put the key in a URL that is logged.

## 5. Add a new payment adapter

**No code:** Admin → Payment methods → **Add payment method → Custom API**: create-payment URL, headers/body templates, where the payment link is in the answer, the webhook signature header and algorithm, the "paid" field and value, and where the payment id is. The sandbox test signs a fake webhook and runs it through the real webhook code in a rolled-back transaction.

**Code:** create `server/payments/<name>.js` exporting `{ label, checkout, webhook, recurring, fields, config_fields, help }`:
- `checkout(method, { payment, user, amountUsd, description, successUrl, cancelUrl, recurring })` → `{ url, ref }`. Throwing is fine: `billing.startCheckout` marks the payment failed and shows the customer a clean "not available right now".
- `webhook(method, req)` → verify the signature over `req.rawBody` with `safeEqual` **before** trusting anything, then return `{ type: 'paid'|'renewed'|'cancelled'|'ignore', paymentId, ref, raw }`. Check the amount against the payment row. `billing.markPaid` is idempotent.
- Register it in `ADAPTERS` (`payments/index.js`), add a rule to `staging.paymentProblem()` (how to tell a test key or sandbox address), a sandbox case in `paysandbox.js`, and a read-only key check in `integrations.testMethod()`.
- Webhook URL: `{APP_URL}/api/webhooks/<name>`. Document it in README section 3.

## 6. Testing

| Command | What it does |
|---|---|
| `npm run check` | Boots the real app on a throwaway database (demo AI providers, emails to the log) and runs about 130 end-to-end checks: signup, jobs of every pipeline with real ffmpeg output, credits and refunds, payments and forged webhooks, roles and limits, support, mail, security (sessions, IDOR, XSS escaping, uploads), staging guards (in a second server started with `APP_ENV=staging`), backups and migrations (two boots), QA regressions. About 2 minutes. |
| `CHECK_ONLY=staging,qa npm run check` | Core checks plus only those groups (`support, studio, levels, security, business, voo, bachs, showcase, phase2, mail, videotools, staging, qa`). |
| `npm run check:syntax` | `node --check` on every `.js` file and a parse of every inline `<script>` in the HTML. |
| Demo e2e | `cd /home/claude/vooads-demo && ./build-demo.sh && (python3 serve.py out/artifact <port> artifact &) && node test/e2e.js http://localhost:<port> artifact` → `ALL OK`. Playwright clicks through site, studio, support (tapping on a phone), admin, mail and business at 390 px and 1440 px. |
| GitHub Actions | `.github/workflows/check.yml`: Node 22 + apt ffmpeg, `check:syntax` + `check` on every PR and push to `main`/`staging`. Make the **check** status required on `main`. |

Write a self-check for every bug you fix (see `server/selfcheck-qa.js`).

## 7. Coding rules

- **No dependencies.** Only Node built-ins. No `npm install`, no build step. Front-end scripts are plain browser JS.
- **Every route checks access first:** `auth.requireUser` / `auth.requireStaff(req, 'perm')`. Owner-only features check `auth.can(staff, '*')`. Customer resources are always looked up with `... AND user_id = ?` (404, not 403, for someone else's).
- **Escape on output.** Admin and studio build HTML with template strings: wrap every value in `esc()`. Never put user text in `innerHTML` unescaped, in `on*=` attributes, or in `href` without a scheme check. Markdown goes through `lib/markdown.js`, email HTML through `mail/sanitize.js`.
- **Never pass user text to a shell or ffmpeg argument.** Write it to a file we create (`editkit.js`) or use argument arrays with fixed options.
- **Webhooks:** verify the signature on the raw body before parsing or acting; make handlers idempotent.
- **Money:** prices only from server settings; the guard decides the final credits. Never trust an amount, plan or credit count from the browser.
- **Secrets:** stored with `util.encrypt` (APP_SECRET); shown only as `mask()` hints; never logged; never sent to the browser.
- **Migrations:** additive and idempotent (§1). **Staging:** anything that emails or charges must go through `email.deliver`, `mail/sender.deliver` or `billing.startCheckout` so the staging guards apply.
- **Copy:** plain, friendly English for customers; errors say what to do next.
- `public/index.html` and `public/assets/css/site.css` belong to the site copy/design team: coordinate before editing.

---

## 8. Outside services, keys and prices

Prices are list prices **as checked on 4 October 2026**. They change: check the provider's page, then update the provider row's cost in Admin → AI providers (the profit guard re-prices from it).

| Service | What it powers in Vooads | Where to get the key | Price (4 Oct 2026) |
|---|---|---|---|
| **fal.ai** (one key for all rows below) | Every video, image, matting and fal music/STT model | fal.ai → Dashboard → **Keys**; add credit under Billing | pay per use, per model: |
| · Kling AI Avatar v2 Pro | UGC talking / green-screen / podcast, **Standard** level | same fal key | **$0.115 / s** |
| · OmniHuman 1.5 (ByteDance) | UGC, **Pro realistic** level | same fal key | **$0.16 / s** |
| · Google Veo 3.1, 1080p with audio | UGC and product video, **Ultra cinematic** level | same fal key | **$0.40 / s** |
| · Veo 3.1 Fast | product video, Pro alternative (off by default) | same fal key | **$0.15 / s** |
| · Kling 3.0 Pro with audio | product video / b-roll, **Pro realistic** level | same fal key | **$0.168 / s** |
| · Kling 2.5 Turbo Pro | product video, b-roll, photo to video, animated ad scenes, **Standard** | same fal key | **$0.07 / s** |
| · Seedance 2.0, 1080p | product video, Ultra alternative (off by default) | same fal key | **$0.682 / s** |
| · VEED background removal (fast, refined) | Change background (bg_swap) | same fal key | **$0.012 per 30 frames** ($0.024/s at 60 fps) |
| · ElevenLabs Music on fal | Brand music / AI background music, alternative (off) | same fal key | **$0.60 / minute** (rounded up) |
| · Seedream V4, Sync Lipsync v2, Whisper, Kling Avatar v2 Standard, Wan 2.5 | images, dubbing, STT backup, cheaper backups | same fal key | see each row's cost in Admin → AI providers |
| **ElevenLabs** (direct) | Voices (Flash v2.5; Multilingual v2 for ultra-realistic voice), Music API, Scribe speech-to-text (Auto-edit) | elevenlabs.io → profile → **API Keys** | per your ElevenLabs plan (credits per character / per minute of music / per hour of audio); seeded estimates: $0.05 per 1k chars, $0.10 ultra, $0.15/min music, $0.40/h Scribe |
| **Anthropic** | Scripts, hooks, angles, slides, translations, AI tools (text) | console.anthropic.com → **API Keys** | per token, per Anthropic's price list; seeded estimate $0.062 per script (Sonnet), $0.02 (Haiku) |
| **OpenAI** or any OpenAI-compatible API (optional) | Same text jobs, as default or backup | platform.openai.com → API keys (or OpenRouter/Together/Groq) | per token, per provider |
| **Pexels / Pixabay** (optional) | Free stock footage for animated ads and backgrounds | pexels.com/api, pixabay.com/api/docs | free |
| **Resend** | Login codes, receipts, lifecycle emails, campaigns; webhook for bounces, complaints, opens, clicks | resend.com → **API Keys**; Domains (DNS records); Webhooks (signing secret) | free tier, then monthly plans by email volume (resend.com/pricing) |
| **Stripe** | Card payments, auto-renewing plans | dashboard.stripe.com → Developers → API keys (`sk_live_`/`sk_test_`) + Webhooks (`whsec_`) | per-transaction card fees (stripe.com/pricing) |
| **Paystack / Flutterwave** | African cards, bank, USSD, mobile money (local currency) | Paystack: Settings → API Keys & Webhooks; Flutterwave: Settings → API Keys + Webhooks secret hash | per-transaction fees per provider |
| **NOWPayments** | Crypto (300+ coins) | nowpayments.io → Store settings → API key + IPN secret (sandbox account for staging) | per-transaction fee per provider |
| **Gatevoo** (Zedapex) | Crypto checkout USDT/BTC (non-custodial) | Gatevoo dashboard → API key + webhook signing secret; contract `docs/GATEVOO-API.md` | Zedapex's own |
| **VooSquare** (Zedapex) | Voo ID login, dashboard events, support inbox | Admin → Integrations → **Connect VooSquare** (paste the connection code) | Zedapex's own |
| **Railway** | Hosting, Volume, environments, deploys, rollback | railway.com | per your Railway plan (usage based) |
| **GitHub** | Code, branches, pull requests, Actions CI | github.com | free for private repos within Actions minutes |

## 9. Endpoints you will touch most

- Customer: `/api/auth/code|verify|logout|logout-all`, `/api/me`, `/api/jobs`, `/api/quote`, `/api/video-types`, `/api/uploads/video`, `/api/brand-tracks`, `/api/billing`, `/api/billing/checkout`, `/api/tickets`, `/api/tools`, `/api/referral`.
- Admin: everything under `/api/admin/*` (permission per route; enumerate with `grep -rhoE "\.(get|post|put|del)\('/api/admin[^']*'" server`).
- Webhooks: `/api/webhooks/<adapter>`, `/api/webhooks/custom/<id>`, `/api/webhooks/mail/resend`.
- VooSquare inbound (service key): `/api/voosquare/summary`, `/api/voosquare/support/*`.
- Health: `/healthz` → `{ ok, env, version, db, ffmpeg, ffprobe, uptime_s }`, 503 when the database is not writable or (on Railway) ffmpeg is missing.
- Backups (owners): `GET/POST /api/admin/backups`, `GET /api/admin/backups/<name>`.

## Phase 2: chat editing, new video types, actors, profit

| Area | Files | Notes |
|---|---|---|
| Chat editing | `server/chatedit.js`, `server/editops.js`, `public/assets/js/voo-phase2.js` | Planner (Anthropic via the text provider chain, rule planner in demo mode) → validated op list → exact credits → confirm → new version (`jobs.type = 'edit'`). Local ops are free; generation ops run as normal priced jobs at the video's own level. Versions in `video_versions`, thread in `chat_edit_messages`. |
| AI bill | `server/llmbill.js`, setting `llm` | Every text call is metered (`llm_usage`). Chat planning: free messages per plan per day, then `credits_per_message`; per-minute and per-day limits; house daily cap with admin alerts (`admin_alerts`). Admin → Business → Profit edits it. |
| Profit view | `server/profit.js`, `public/assets/js/admin-profit.js` | Revenue vs payment fees vs real provider cost (jobs meter each finished step, failed jobs included) vs free AI steps, per day and per video type; types below the minimum margin are flagged. |
| Payment fees | `guard.feeFor/worstFee`, `pricing.payment_fees`, method config `fee_pct`, `fee_fixed_usd` | The worst switched-on method's fee is taken off every credit price before the 60% check. |
| Street interview | `jobs.js streetAdvance`, pricing `street_interview` | Q&A script → clips with native dialogue audio (Kling 3.0 Pro / Veo 3.1) → stitched. `ai_label` on by default. |
| Mad edit | `server/madedit.js`, `server/sfx.js` | Beat grid, punch-ins, generated whoosh/impact/riser/beat, kinetic captions, text hits. AI shots or the customer's own uploads (cheaper). |
| Actors | `server/actors.js` | House actors (settings presenters), generated actors (4-face `actor` job), own face (consent box + consent clip + staff approval in Admin → Support → Actor consent). Real-person filter on every name and description. |
| Hook factory | `credits.maxHooks/bulkPct`, pricing `hook_remix.bulk_discounts` | 1 to 10 hooks, 5% off from 5, 10% off at 10 (guard-checked). `GET /api/jobs/:id/export.zip`. |
| Naira rate | `payments/bachs.js staleness()` | Warning after 7 days, optional pause of naira checkout after 30 days (`block_when_stale`). |
| Learn | `public/learn/*.webp`, `index.json` | Real studio screenshots per lesson step. Re-make them after UI changes with the capture script (Playwright: one screenshot per lesson scene at 390px). |
| Security | `server/lib/netguard.js`, `stitch.guardArgs`, `billing.markPaid` | One guarded fetch (pinned DNS, private ranges refused, redirects re-checked); ffmpeg inputs forced to their sniffed demuxer and file/pipe only; uploads resolve for their owner only; refunded payments never re-credited; Stripe session and amount checked; CSP `script-src 'self'`. |
