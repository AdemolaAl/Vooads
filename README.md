# Vooads, by Zedapex

Realistic AI UGC video ads for media buyers. One product line in; UGC presenter videos, product videos, image sets, hook packs and scripts out, in 24 languages.

This folder is the whole product:

| Part | Where | What it is |
|---|---|---|
| Website | `/` | Landing page, examples, free Ban Shield tool, pricing, Zedapex apps |
| Studio | `/app` | Customer dashboard: live guide, ad builder, library, wallet, referrals, support chat |
| Admin | `/admin` | Customers, payments, AI providers, payment methods, pricing, blog, emails, team and roles, audit log |
| Blog | `/blog` | Ten posts already written. Edit them in Admin → Blog |
| Legal | `/legal/terms` and others | Terms, Privacy, Acceptable Use, Refunds, Cookies, AI Content, Copyright Takedown |
| Health check | `/healthz` | Checks the database is writable and ffmpeg is installed; returns `{"ok":true,"env":"production","version":"<git sha>",...}` (503 when something is wrong) |

**No npm install.** It runs on Node 22.13 or newer and uses Node's built-in SQLite. There are no packages to break.


---

## What's new in v2 (read this first)

The full step-by-step setup is in the **Vooads Developer Guide** (shared as a doc with this code). Short version of what v2 adds:

- **10 video types** (`content/pricing.json` → `video_types`): UGC talking, green-screen, podcast clip, product b-roll, photo to video, slideshow, dub, hook remix, **animated ad Standard** and **animated ad Ultra-realistic**. Long videos are rendered in parts and joined with ffmpeg (`server/stitch.js`; ffmpeg comes from `nixpacks.toml`).
- **Add-ons:** background music (free library tracks, or ElevenLabs Music at +2 credits/s) and ultra-realistic voice (+1 credit/s).
- **Profit guard** (`server/guard.js`): every quote and job is priced from the real provider cost so nothing runs under the minimum margin (60%). Abuse limits in Admin → Profit guard.
- **Pronunciation dictionary** (`server/pronounce.js`, Admin → Voice & pronunciation): "Vooads" is spoken "Voo-ads" in every voiceover.
- **Support tickets** with calls, macros, roles and limits (`server/support.js`), connectable to **VooSquare** (`docs/VOOSQUARE-SUPPORT-API.md`).
- **Payments:** Gatevoo (`docs/GATEVOO-API.md`) and no-code custom payment methods, alongside Stripe, Paystack, Flutterwave and NOWPayments.
- **AI brain** (`content/ai/*`, Admin → AI brain): playbook, 22 niches, trends and script templates that brief the script/hook model.
- **Learn center:** narrated, animated walkthroughs (`content/training/lessons.json`, `public/assets/js/trainer.js`).
- **Content:** 30 email templates incl. a 12-day sales sequence, 10 blog posts, `content/sales/sales-playbook.md`.
- **Quality levels (4 Oct 2026):** customers pick **Standard / Pro realistic / Ultra cinematic** for every video type that renders footage. Each level is one model with its own price: Kling Avatar v2 / OmniHuman 1.5 / Google Veo 3.1 for talking presenters (15 / 22 / 45 credits/s), Kling 2.5 Turbo / Kling 3.0 / Veo 3.1 for footage (10 / 18 / 45 credits/s). Pro needs the Pro plan, Ultra needs Scale. The profit guard prices every job on the chosen model (`server/levels.js`, `content/pricing.md` §13, `docs/SPEC-v2.md` §13).
- **Editing tools (4 Oct 2026):** **Change background** (upload a video, put it on a colour, your picture, an AI scene or stock footage; fal VEED background removal, $0.024/s at 60 fps → 3 credits/s), **Auto-edit my video** (silences, fillers and bad takes cut, best line first, animated captions, music, end card, reframed; ElevenLabs Scribe speech-to-text → 2 credits per raw second, min 30) and **Brand music** (instrumental or a jingle that sings the brand name, 60 credits up to 60 s, 110 for 120 s, saved to "My brand tracks" and free to reuse as the music of any video). Uploads are private (signed links), checked by bytes and ffprobe, 2 GB per customer, deleted after 7 days. Details: `content/pricing.md` §14, `docs/SPEC-v2.md` §14.
- **Checks:** `npm run check` runs the end-to-end checks (`CHECK_ONLY=videotools npm run check` for one group). The editing-tool checks render real ffmpeg output on generated footage.

Only `APP_SECRET` is required on Railway. Email, VooSquare and the site URL are set in Admin → Integrations.

**4 October 2026 (ops):** a **staging** environment that updates itself from the `staging` branch and can never email customers or take real money (`server/staging.js`), GitHub Actions checks on every pull request (`.github/workflows/check.yml`), a stronger `/healthz` (database writable, ffmpeg, git version), automatic database backups before every start with an owner-only download, and the beginner deploy guide below.

**October 2026 update:** Admin → Integrations (status + Test for every outside service), "Keep me signed in" (30-day rolling sessions, Settings → Sign out of all devices), a one-time owner setup link, the support chat fixed on phones, and rewritten legal pages.

---

## 1. Deploy in 30 minutes (Railway), step by step

You need: a **GitHub** account, a **Railway** account (railway.com, the Hobby plan is enough to start), and access to your domain's **DNS** (where you bought vooads.com). You do not need to install anything on your computer.

How it fits together:

```
GitHub repo "vooads"                     Railway project "Vooads"
  main    branch ── push ──► auto-deploy ──► production environment ──► vooads.com          (live site)
  staging branch ── push ──► auto-deploy ──► staging environment    ──► staging.vooads.com  (safe test copy)
  pull requests  ── GitHub Actions runs "npm run check" ── only green code can be merged into main
```

Each environment has its **own** server, **own** Volume (database and videos), **own** `APP_SECRET`, **own** keys and **own** web address. Nothing you do on staging touches the live site.

### Step 1. Put the code on GitHub (5 min)
1. github.com → **New repository** → name `vooads` → **Private** → Create.
2. Upload this folder (everything except `data/`, which `.gitignore` already skips):
   - Easiest: on the empty repo page click **uploading an existing file**, drag the folder contents in, **Commit changes**.
   - Or from a terminal: `git init && git add . && git commit -m "Vooads" && git branch -M main && git remote add origin https://github.com/<you>/vooads.git && git push -u origin main`
3. Make the `staging` branch: on the repo page click the branch menu (says `main`) → type `staging` → **Create branch staging from main**.
4. Protect `main` so only checked code goes live: repo **Settings → Branches → Add branch protection rule** → Branch name `main` → tick **Require a pull request before merging** and **Require status checks to pass** → search and pick **check** (it appears after the first GitHub Actions run, see step 10) → Create.

The file `.github/workflows/check.yml` runs the full self-check (`npm run check`, Node 22 + ffmpeg) on every pull request and every push to `main` and `staging`. Green tick = safe to merge.

### Step 2. Create the Railway project (3 min)
1. railway.com → **New Project → Deploy from GitHub repo** → allow Railway to see the `vooads` repo → pick it.
2. Railway creates one service in the **production** environment and starts building. It reads `railway.json` and `nixpacks.toml` by itself: Node 22, ffmpeg, start command `npm start`, health check `/healthz`.
3. The first build will **fail its health check or stop at once** because `APP_SECRET` is missing. That is expected; steps 3 and 4 fix it.
4. Service → **Settings → Source**: check the branch is **`main`**. Leave **Auto deploy** on. If you see **Wait for CI**, switch it on: Railway then waits for the GitHub check to pass before deploying.

### Step 3. Add a Volume (2 min)
The database (`vooads.db`), backups, uploads and generated videos must survive redeploys.
1. In the service: right-click the service (or the **+ Create** button) → **Volume** → attach it to the Vooads service.
2. **Mount path: `/data`** (exactly that).
3. Vooads finds the Volume by itself (Railway tells it the mount path). No `DATA_DIR` variable is needed.

### Step 4. Add `APP_SECRET` (2 min)
1. Make a secret. Any one of these works:
   - On any computer with Node: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - On Mac/Linux: `openssl rand -hex 48`
   - Or let a password manager generate a **64+ character** random password (letters and numbers).
2. Service → **Variables → New Variable** → name `APP_SECRET`, value = the secret → **Add**.
3. Optional: `OWNER_EMAIL=you@yourcompany.com` (the first admin). Without it, step 6 uses a one-time link.
4. Save the secret in your password manager. **Never change it after launch**: saved API keys are encrypted with it.
5. Not needed on Railway: `NODE_ENV`, `APP_URL`, `DATA_DIR`, `PORT` (all automatic).

Railway redeploys after a variable change. Wait for the green **Active** tick.

### Step 5. Open the site (1 min)
1. Service → **Settings → Networking → Generate Domain**. You get `something.up.railway.app`.
2. Open it: you should see the website.
3. Open `https://something.up.railway.app/healthz`. You should see `{"ok":true,"env":"production","version":"<git sha>","db":"writable","ffmpeg":true,...}`.
   - `db` must be `writable` and `ffmpeg` must be `true`. Railway only switches traffic to a new deploy after this page answers OK.

### Step 6. First owner login (2 min)
1. Go to `/admin`.
2. **With `OWNER_EMAIL`:** type that email → you get a 6-digit code by email, or in the logs (Railway → service → **Deployments → View logs**) until email is set up.
3. **Without it:** open **View logs** and find the line `No admin account yet. Open this link within 24 hours…` → open that `…/admin#setup=…` link → enter the email you want as owner.
4. Tick **Keep me signed in** on your own devices only.

### Step 7. Connect the outside services in Admin → Integrations (10 min)
One page lists every service with a status (**Connected / Not connected / Error**) and a **Test** button. Keys are stored encrypted and never shown again (only a hint like `sk_…4f2a`). Until you add keys, nothing costs money: AI runs in demo mode, emails go to the logs, and no payment method is on.

1. **fal.ai: one key for every video, image and editing model.** fal.ai → sign up → **Dashboard → Keys → Add key** → copy. Admin → **AI providers** → open any fal row (for example *Kling 2.5 Turbo Pro on fal*) → paste the key → Save → **Test**. Every other fal row says "uses the shared fal key". This one key covers: UGC presenters (Kling Avatar v2, OmniHuman 1.5, Veo 3.1), product videos (Kling 2.5 Turbo, Kling 3.0, Veo 3.1, optional Veo 3.1 Fast and Seedance 2.0), images (Seedream V4), lip-sync dubbing, background removal (VEED), Whisper speech-to-text backup and the optional ElevenLabs-Music-on-fal. Add credit in fal → **Billing** first.
2. **ElevenLabs: voices, music and speech-to-text.** elevenlabs.io → profile → **API Keys → Create** (give it access to Text to Speech, Music and Speech to Text) → paste into the *ElevenLabs Flash (voices)* row → Test. The same key powers the ultra-realistic voice, ElevenLabs Music (switch that row on) and Scribe (Auto-edit).
3. **Text AI (scripts, hooks, AI tools): Anthropic or OpenAI.** console.anthropic.com → **API Keys → Create Key** → paste into *Claude Sonnet* → Test. Prefer OpenAI? Admin → AI providers → **Add** → adapter **OpenAI-compatible** → model (for example `gpt-4.1-mini`) → key from platform.openai.com → make it **Default** for *text*.
4. **Email (Resend).**
   1. resend.com → **Domains → Add Domain** → `vooads.com` → add the DNS records it shows (an MX and TXT for sending, a DKIM TXT, and optionally DMARC) at your DNS provider → wait for **Verified**.
   2. Resend → **API Keys → Create** (Sending access) → Admin → Integrations → **Email** → paste the key, set **From** to `Vooads <hello@vooads.com>` → Save → **Test** (it emails you).
   3. Resend → **Webhooks → Add endpoint** → URL `https://vooads.com/api/webhooks/mail/resend` → events *email.delivered, email.bounced, email.complained, email.opened, email.clicked* → copy the **signing secret** → paste into **Email webhook secret** → Save. This powers bounce protection and campaign stats.
5. **Payments** (Admin → **Payment methods → Add payment method**: the wizard asks for the keys, runs a sandbox test that moves no money, then switches the method on). Copy each **webhook URL** shown into the provider's dashboard.
   - **Gatevoo** (crypto, USDT/BTC): API key + webhook signing secret from your app in Gatevoo; set the app's webhook URL in Gatevoo to `https://vooads.com/api/webhooks/gatevoo`, then press Gatevoo's Test button. Signature: hex HMAC-SHA256 of `<X-Gatevoo-Timestamp>.<raw body>`, 5-minute window. Details: `docs/GATEVOO-API.md`.
   - **Bachs** (Africa: naira for Nigeria, cards, bank, mobile money): Admin → Payment methods → **Bachs** (already listed, switched off) → Secret key `sk_live_…`, Webhook secret `whsec_…`, **Naira per 1 US dollar**, countries → Test → switch on. Webhook URL in Bachs: `https://vooads.com/api/webhooks/bachs`. Details: `docs/BACHS.md`.
   - **Stripe** (cards, auto-renew): dashboard.stripe.com → Developers → **API keys** → Secret key `sk_live_…`; **Webhooks → Add endpoint** `https://vooads.com/api/webhooks/stripe`, events `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted` → signing secret `whsec_…`.
   - **Paystack**, **Flutterwave**, **NOWPayments**, **Bank transfer** and **Custom API** (any other checkout, no code): see section 3.
   - Set the **countries** for each method. Then press **Test** on its row in Integrations (read-only call to the provider).
6. **VooSquare.** VooSquare → Admin → Products → Vooads: URL `https://vooads.com`, Launch path `/app`, SSO on, Redirect URIs `https://vooads.com/auth/voosquare/callback` and `https://vooads.com/`, Summary URL `https://vooads.com/api/voosquare/summary` → Save → Credentials. Then Admin → Integrations → VooSquare: **VooSquare address**, **client ID** (`vsc_…`), **client secret** (`vss_…`), **API key** (`vsk_…`), **signal secret** (make once with `openssl rand -hex 32`) → Save → **Test**. "Continue with VooSquare" appears next to the email login. For the support inbox, also run **Connect VooSquare** (service key and signing secret). Details: `docs/VOOSQUARE.md`.
7. **Storage** → **Test**: confirms the Volume is writable and ffmpeg is installed.

### Step 8. Connect your domain (5 min + DNS time)
1. Railway → service → **Settings → Networking → Custom Domain** → `vooads.com`, then again `www.vooads.com`.
2. Add the records Railway shows (a CNAME, or the ALIAS/ANAME/flattened CNAME your DNS provider offers for the root domain) → wait until Railway shows a green check (minutes to a few hours).
3. Admin → Integrations → **Public site URL** → `https://vooads.com` → Save (no redeploy needed). Update webhook URLs in Stripe/Gatevoo/Resend if you set them up with the Railway address.

### Step 9. Set up staging (the safe building copy) (10 min)
Staging is where you and your developers build and try new code and AI features. It updates itself on every push to the `staging` branch and can never email your customers or take real money.

1. Railway → top bar environment menu (says **production**) → **New Environment** → name **`staging`** → choose **Duplicate production** → Create.
2. In the **staging** environment open the Vooads service:
   - **Settings → Source → Branch: `staging`** (Auto deploy on; **Wait for CI** on if offered).
   - **Variables:** set a **new, different `APP_SECRET`** (step 4 again). Set `OWNER_EMAIL` to you. Add `STAGING_EMAIL_ALLOWLIST=you@zedapex.com,@zedapex.com` (people who may get real emails from staging besides staff). **Delete** any copied live keys or `VOO_*` variables.
   - **Volume:** check staging has its **own** Volume at `/data` (duplicating creates a new, empty one; add one if not). Never share production's Volume.
   - **Networking:** Generate Domain, or Custom Domain `staging.vooads.com` (CNAME at your DNS).
3. Deploy. Open `https://staging.vooads.com/healthz` → `"env":"staging"`. Studio and admin show a yellow **"Staging — test data"** bar.
4. What staging does by itself (code: `server/staging.js`, checked by `npm run check`):
   - Detects it is staging from Railway's environment name (any name except `production`). You can force it with `APP_ENV=staging`.
   - **Emails** go only to active staff, `OWNER_EMAIL` and `STAGING_EMAIL_ALLOWLIST`. Every other email (including customer login codes) is printed in the staging logs.
   - **Payments are test-only:** a "Test payment (staging, no real money)" method is always offered; Stripe and Paystack accept only `sk_test_…` keys, Flutterwave only `FLWSECK_TEST-…`, NOWPayments talks to its sandbox, Gatevoo and custom APIs need a sandbox/test address. Methods with live keys are hidden and refused at checkout.
   - **Sample data:** an empty staging database gets 3 sample customers, jobs and a support ticket.
   - Search engines are told not to index it (`robots.txt` and `X-Robots-Tag: noindex`).
5. In staging's admin, add **test** keys: Stripe test keys, Paystack test keys, a separate fal/ElevenLabs/Anthropic key with a low spending limit (AI calls are real and cost real money on staging too), Resend can reuse the same domain.
6. **Optional: PR preview environments.** Railway → Project **Settings → Environments → Enable PR Environments** (base it on `staging`). Every pull request gets its own temporary copy with its own URL; it is treated as staging automatically and is deleted when the PR closes.

### Step 10. The everyday way to ship changes
1. Build on the `staging` branch (or a feature branch with a pull request into `staging`). Push.
2. GitHub Actions runs the checks; Railway redeploys **staging** automatically. Try it at `staging.vooads.com`.
3. Happy? On GitHub: **Pull requests → New → base `main` ← compare `staging`** → wait for the green **check** → **Merge**.
4. Railway builds `main` and deploys **production**. The new version only takes traffic after `/healthz` answers OK within 3 minutes (database writable, ffmpeg present). A build that fails to compile never touches the live site.
5. Every deploy first copies the database to `/data/backups` (step 12), then runs migrations.

**No-code path for AI features:** you do not need a developer or staging for a new AI tool. Admin → **AI tools → New AI tool** starts as **Draft** (only staff can try it with **Try it**), move it to **Testing** with a list of tester emails (only they see it in the studio), then **Publish / Go live** to make it **Live** for everyone. Every version is kept and can be restored, and the profit guard prices it automatically. The same goes for new models (Admin → AI providers → **Add AI model**, with a dry-run test) and new payment methods (the payment wizard with its sandbox test).

> Railway note: a service with a Volume cannot run two copies at once, so every production deploy has a few seconds of downtime while the old copy stops and the new one starts, even with the health check. Deploy at quiet hours.

### Step 11. Going-live checklist
- [ ] `https://vooads.com/healthz` shows `"ok":true`, `"env":"production"`, `"db":"writable"`, `"ffmpeg":true`.
- [ ] `APP_SECRET` saved in your password manager; staging uses a different one.
- [ ] Volume attached at `/data` (Admin → Integrations → Storage shows **Persistent**).
- [ ] Owner logged in; **Team & roles**: every staff member has the smallest role that works.
- [ ] Integrations: fal, ElevenLabs, Anthropic (or OpenAI), Resend all **Connected** after **Test**. Resend domain **Verified**, webhook secret set.
- [ ] Payment methods: live keys (not test keys) on production, webhook URLs pasted into each provider, countries set, one real small purchase made and refunded.
- [ ] Public site URL is `https://vooads.com`; old Railway URL no longer used in webhooks.
- [ ] Pricing reviewed (Admin → Pricing); profit guard shows no red rows (Admin → Profit guard).
- [ ] Legal pages read by a lawyer (section 6).
- [ ] GitHub: branch protection on `main` with the **check** status required.
- [ ] Download a first backup (Admin → Integrations → **Database backups → Download**) and keep it somewhere safe.

### Step 12. Backups and rollback
**Automatic database backups.** Every time the server starts (every deploy and restart) it copies `vooads.db` to `/data/backups/vooads-<date>-<time>-boot.db` **before** any database change runs. The newest 10 are kept. Owners can make one any time and download it: Admin → Integrations → **Database backups → Back up now / Download**. Only owners can see or download backups (they contain every customer and every encrypted key).
- Backups cover the database only. Generated videos and uploads live in `/data/media` and `/data/uploads`: switch on Railway's volume backups for the Volume if your plan offers them.
- Keep a copy outside Railway now and then (download it).

**Rollback (bad code).** Railway → production → service → **Deployments** → the last good deploy → **⋯ → Rollback**. It takes seconds (no rebuild). It restores the code and the variables of that deploy. It does **not** roll back the Volume: the database stays as it is. That is safe because every database change in Vooads only **adds** tables or columns and never removes or renames anything, so older code runs fine on a newer database. Then fix the code on `staging` and ship again.

**Restore the database (bad data).** Rare, and loses everything since the backup:
1. Railway → service → **Settings → Deploy → Custom start command**: `sleep 600` (keeps the server stopped but the Volume reachable) → redeploy, or use **⋯ → Remove** on the active deployment.
2. Open a shell on the service (Railway CLI `railway ssh`, or the service's **Shell** tab if your plan has it) and run: `cd /data && cp vooads.db vooads-before-restore.db && cp backups/<the backup>.db vooads.db && rm -f vooads.db-wal vooads.db-shm`.
3. Remove the custom start command → redeploy. Check `/healthz` and log in.

### Step 13. Troubleshooting
| What you see | Why | Fix |
|---|---|---|
| Deploy fails, log says `APP_SECRET is not set` | Variable missing in this environment | Step 4 (each environment needs its own) |
| Deploy fails the health check | `/healthz` answered 503: database not writable or ffmpeg missing | Check the Volume is mounted at `/data`; check `nixpacks.toml` was not changed; open `/healthz` on the old deploy to compare |
| Everything resets after a deploy | No Volume | Step 3 |
| "Login code" emails never arrive | Resend key missing or domain not verified; on staging the address is not staff/allowlisted | Codes are printed in **View logs**; finish step 7.4; add the address to `STAGING_EMAIL_ALLOWLIST` |
| Customers see "… is not available right now" at checkout | The payment provider refused the key or is down | Admin → Integrations → payment method → **Test**; the reason is in Admin → Payments (failed payment note) |
| Paid but no credits | Webhook not reaching Vooads or wrong signing secret | Provider dashboard → webhook delivery log; re-copy the webhook URL and secret from Admin → Payment methods |
| Videos say "Demo" | No AI key or the provider test fails | Step 7.1 to 7.3, then **Test** |
| UGC videos fail with a download error | fal cannot reach your server | Public site URL must be the real `https://` address (not localhost) |
| Long videos come out as several parts | ffmpeg missing | `/healthz` → `"ffmpeg":false`; redeploy with the stock `nixpacks.toml` |
| Staging sent nothing to a tester | Staging blocks non-staff emails on purpose | Add them to `STAGING_EMAIL_ALLOWLIST` or invite them as staff |
| A checkout on staging is refused | Live keys on staging | Use test keys (`sk_test_…`) or the Test payment method |
| "Too many tries" | Login rate limits (5 codes per email per 10 min) | Wait 10 minutes |

### Run it on your own computer
```bash
node -v                       # must be 22.13 or newer
npm start                     # http://localhost:3000
npm run check                 # end-to-end checks on a throwaway database (about 2 minutes)
npm run check:syntax          # every .js file and inline <script> parses
```
- In development, login codes appear on screen, and a "Test payment" method lets you buy plans without money.
- The test method is switched off automatically on production. Developer guide: `docs/DEV-GUIDE.md`.

---

## 2. AI providers: where to get each key

Add keys in **Admin → AI providers**: click a provider → paste the key → switch it on → press **Test**.

| Job | Provider (already set up) | Get the key | Rough cost to you |
|---|---|---|---|
| Hooks, scripts | Claude Sonnet (backup: Claude Haiku) | console.anthropic.com → API Keys | about $0.06 per script |
| Images | Seedream V4 on fal | fal.ai → Dashboard → Keys | about $0.03 per image |
| Product videos | Kling 2.5 Turbo Pro on fal (backup: Wan 2.5) | same fal key | about $0.07 per second |
| UGC presenter videos | Kling AI Avatar v2 Pro on fal (backup: Standard) | same fal key | $0.115 per second (Standard: $0.056) |
| UGC, **Pro realistic** level | OmniHuman v1.5 on fal | same fal key | $0.16 per second |
| UGC, **Ultra cinematic** level | Google Veo 3.1 (1080p, native dialogue) on fal | same fal key | $0.40 per second |
| Videos, **Pro realistic** level | Kling 3.0 Pro with audio on fal (optional: Veo 3.1 Fast, off) | same fal key | $0.168 per second |
| Videos, **Ultra cinematic** level | Google Veo 3.1 (1080p, audio) on fal (optional: Seedance 2.0, off) | same fal key | $0.40 per second |
| Voices | ElevenLabs Flash (Ultra-realistic voice: Multilingual v2) | elevenlabs.io → Settings → API Keys | about $0.05 per 1,000 characters |
| Background music | ElevenLabs Music (or your uploaded library, free) | same ElevenLabs key | $0.15 per minute |
| Brand music, alternative (off) | ElevenLabs Music on fal | same fal key | $0.60 per minute, rounded up |
| Change background | VEED background removal (fast) on fal | same fal key | $0.012 per 30 frames ($0.024/s at 60 fps) |
| Auto-edit speech-to-text | ElevenLabs Scribe (backup: Whisper on fal) | same ElevenLabs key | about $0.22–0.40 per hour of audio |
| Outside auto-edit (optional, off) | Submagic API (Custom API preset) | submagic.co → API | $69/month for 100 videos |

- **API keys you need:** one **fal.ai** key covers every image and video model (all three quality levels), one **ElevenLabs** key covers voices and music, one **Anthropic** key covers scripts and hooks. Optional: free Pexels/Pixabay keys for stock footage.
- **One fal key covers images, videos and UGC.** Paste it into any one fal provider: fal rows without their own key use it automatically (Admin → AI providers shows "uses the shared fal key").

### Choosing models (quality levels)

- Customers pick a level per video. Each level runs on models tagged with that level (`config.level`: `standard`, `pro` or `ultra`, plus a short `config.tag`). Change a level's main model in **Admin → Pricing → Video types → Quality levels → Model**; switch alternatives on or off in **Admin → AI providers**.
- The profit guard prices a job on the **most expensive enabled model of its level**, so switching on a pricier alternative raises prices by itself, and saving pricing raises any level below the minimum margin.
- If a level's main model fails, the job falls back to another model of the same level, or to a pricier level only while the price still covers it. Never to a cheaper model. If nothing is left, the credits are refunded.
- A level whose models are all off disappears from the studio. Prices and the arithmetic: `content/pricing.md` §13.
- **Switching providers:**
  - The provider marked **Default** for a job runs first.
  - If it fails, the next one by priority runs automatically.
  - If every provider fails, the customer's credits are refunded automatically.
- **Adding a new provider:** Admin → AI providers → Add. Pick an adapter:
  - **Anthropic.**
  - **OpenAI-compatible:** any API that speaks the OpenAI format, such as OpenAI, OpenRouter, Together or Groq. Set the base URL.
  - **fal:** paste any model ID from fal.ai.
  - **ElevenLabs.**
  - **Custom HTTP:** any other API, with a templated request.
- **Voices:** change the ElevenLabs voice IDs in Admin → Settings → Voices. Pick voices from the ElevenLabs Voice Library.
- **Presenters:** change names and photos in Admin → Settings → Presenters.
- **UGC videos need a public `APP_URL`.** fal downloads the voice audio and presenter photo from your server, so this won't work on `localhost`.
- **Finished videos are copied to your Volume** (`/data/media`), so they don't disappear when provider links expire. Set `MIRROR_MEDIA=0` to turn this off.

---

## 3. Payments: where to get each key

Add keys in **Admin → Payment methods**: switch on → paste keys → copy the **webhook URL** shown there into the provider's dashboard.

| Method | Key | Webhook URL to paste | Events |
|---|---|---|---|
| Stripe (cards worldwide, auto-renew) | dashboard.stripe.com → Developers → API keys → Secret key (`sk_live_...`) | `https://vooads.com/api/webhooks/stripe` | `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`. Copy the signing secret (`whsec_...`) into Admin |
| Paystack (Africa) | dashboard.paystack.com → Settings → API Keys & Webhooks → Secret key | `https://vooads.com/api/webhooks/paystack` | all (it checks `charge.success`) |
| Flutterwave | dashboard.flutterwave.com → Settings → API Keys → Secret key. Also set a **Secret hash** under Webhooks and paste the same value in Admin | `https://vooads.com/api/webhooks/flutterwave` | all (it checks `charge.completed`) |
| Crypto (NOWPayments) | nowpayments.io → Store settings → API key, plus IPN secret | `https://vooads.com/api/webhooks/nowpayments` | IPN |
| Crypto (Gatevoo, Zedapex's own) | Gatevoo → API key, plus the webhook signing secret | `https://vooads.com/api/webhooks/gatevoo` | `invoice.paid` (contract: `docs/GATEVOO-API.md`) |
| Bank transfer | No key: bank name, account name and number, currency and rate | none (customers upload a receipt; staff approve in Admin → Payments → Waiting for review) | none |
| Custom API (any other checkout) | The provider's secret key, its create-payment URL and where the payment link is in its answer (the wizard asks) | `https://vooads.com/api/webhooks/custom/<method id>` (shown in the admin) | the provider's "paid" event, checked with its signature header |

- **Only Stripe renews automatically.** Every other method sells a prepaid 30-day or 365-day plan. Customers get a reminder email before it ends.
- **Which methods customers see** depends on their country. Set the countries per method in the admin.
- **Local currencies:**
  - Paystack charges in NGN at the exchange rate saved in the admin (it starts at 1550 NGN per USD).
  - **Update the rate regularly**, or you'll undercharge.
- **Webhooks are checked:**
  - Fake webhooks are rejected by signature checks.
  - Paying twice for the same checkout never doubles the credits.

---

## 4. Team and permissions

Admin → Team & roles → Invite. Pick a role, then send the person the invite link (it works for 14 days).

- People who manage the team can only give out permissions their own role has, and cannot change their own role.

| Role | Can do |
|---|---|
| Owner | Everything |
| Viewer | See everything except the support inbox, change nothing |
| Support | See customers, reply to chats, give up to 500 credits per grant |
| Blog editor | Blog only |
| Manager | Customers, payments, pricing, emails, blog, support (not providers, team or settings) |

- You can also create your own roles by ticking permissions.
- Every staff action goes into the Audit log.

---

## 5. Pricing (already set)

Plans (yearly = 10 × monthly, so 2 months free):

| Plan | Monthly | Yearly | Credits a month | Max UGC video | Max product video | AI script writer |
|---|---|---|---|---|---|---|
| Starter | $49 | $490 | 1,000 | 30s | 15s | No |
| Pro | $149 | $1,490 | 3,500 | 60s | 30s | Yes |
| Scale | $349 | $3,490 | 8,500 | 90s | 45s | Yes |
| Agency | $799 | $7,990 | 20,000 | 120s | 60s | Yes |

Top-ups: $19 for 350 credits, $49 for 1,000, $99 for 2,200, $249 for 5,800.

What things cost in credits:

| Item | Credits |
|---|---|
| UGC video (talking, green-screen, podcast) | 15 per second (a 15s video is 225) |
| Product b-roll / photo to video | 10 per second, in 5-second steps |
| Slideshow with voiceover | 3 per second |
| Dub into another language | 12 per second, per language |
| Hook remix | 75 per new hook |
| Image set (3 sizes) | 12 |
| 20 hooks | 6 |
| 10 angles | 6 |
| AI script | 8 |

- **Free trial:** 60 credits, which can't be spent on video.
- **Margins:** the profit guard keeps every job at or above `min_margin_pct` (60%) at the cheapest price a customer can pay for a credit, raising the credit price of a job if a provider gets dearer. The full working is in `content/pricing.md`.
- **Change prices** in Admin → Pricing. Existing plan IDs are locked so current subscribers aren't broken.

---

## 6. Things to fill in before launch

- [ ] **Legal pages** (`content/legal/*.md`) were updated on 4 October 2026 to match the product: AI video, voice and music, likeness and voice consent, no scams or illegal use (ban, no refund), credits and plan rules, top-ups, Gatevoo and card payments, VooSquare data sharing, the AI provider list, the "Keep me signed in" cookie, data retention and GDPR/NDPR rights. The company is shown as "Zedapex Limited, Lagos". Terms choose the laws of Nigeria and the courts of Lagos State. Have a lawyer read them, then redeploy if you change anything.
- [ ] **Domain email:** verify `vooads.com` in Resend (add the DNS records it gives you) so emails don't land in spam.
- [ ] **Zedapex app buttons:** links for Joinvoo, Replyvoo, Castvoo, Affleego and Landvoo are at the top of `public/assets/js/voo-apps.js`. They all point to voosquare.com right now.
- [ ] **Sample videos and photos** on the website are AI-generated and loaded from the Higgsfield CDN. At boot the server copies them to the Volume.
  - For extra safety, download them once into `public/samples/` with the names listed in `server/samples.js`, then they ship with the code.

---

## 7. How it's built (for the developer)

```
server/
  index.js          HTTP server, security headers, background workers
  config.js         environment variables
  db.js             SQLite schema (auto-created) and helpers
  auth.js           email-code login, sessions, staff permissions
  credits.js        balances, spending, refunds (trial / plan / top-up buckets)
  jobs.js           generation pipelines (hooks, script, image, video, UGC), runs every 2.5s
  providers/        AI adapters: anthropic, openai, fal, elevenlabs, http, mock (demo)
  payments/         stripe, paystack, flutterwave, nowpayments, test (dev only)
  billing.js        checkout, plan activation, renewals, reminder and win-back emails
  email/            Resend sender, templates (content/emails/emails.json), queue and sequences
  shield.js         Ban Shield rules (add rules to the RULES list)
  routes/api.js     customer API
  routes/admin.js   admin API
  routes/pages.js   blog, legal, sitemap, media
  selfcheck.js      end-to-end test: npm run check
public/
  index.html        website
  app.html          studio
  admin.html        admin
  assets/           shared CSS, eyes animation, Zedapex app cards, email GIFs, favicon
content/            pricing, legal pages, blog posts, email copy
```

- **Backups:** the database is copied to `/data/backups` before every start (newest 10 kept); owners download them in Admin → Integrations. Back up `/data/media` with Railway volume backups. See section 1, step 12.
- **Developer guide** (architecture, adding video types/providers/payment adapters/AI tools, testing, API keys and prices): `docs/DEV-GUIDE.md`.
- **Logs:** Railway → Deployments → View logs.
  - Without Resend, every email (with login codes) is printed there.
- **Not built yet:**
  - team seats inside a customer account (the plans no longer advertise seats)
  - brand kits and client workspaces
  - automatic referral payouts (support pays them by hand from Admin → Customers)
  - re-sending a staff invite link (remove the person and invite them again)
  - switching to a different plan mid-term starts the new plan from today; unused time on the old plan is not credited (handle by hand with a credit grant if a customer asks)
