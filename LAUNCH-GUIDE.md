# Vooads launch guide for Ade

Vooads is a Node 22 app with no npm dependencies. It stores its data in SQLite, in `DATA_DIR`, and needs `ffmpeg` (Railway installs it from `nixpacks.toml`).

## 1. Deploy

1. Unzip `vooads.zip` and push it to the Vooads GitHub repo, or upload it to Railway.
2. On Railway:
   - Attach a **Volume** (for example at `/data`). The database and finished videos live there.
   - Start command: `node server/index.js` (already set in `railway.json`).
3. Set the **Variables**:
   - `APP_SECRET`: 64+ random characters. Make it with `openssl rand -hex 48`. **Never change it after launch.**
   - `OWNER_EMAIL`: the owner's email. That email logs in at `/admin`.
   - `APP_URL=https://vooads.com`: needed if Railway's domain isn't the real one.
4. Point the domain at Railway. Open `https://vooads.com/healthz`; it should say ok.

Database updates run by themselves at start, and a backup is made first (`BACKUP_ON_BOOT=1`).

## 2. Keys (all in /admin, not in Variables)

Do each of these in `/admin`, in this order:

1. **Integrations → Email (Resend):** add `RESEND_API_KEY`, `FROM_EMAIL` (`Vooads <hello@vooads.com>`) and `SUPPORT_EMAIL`. Verify the domain in Resend. Then send yourself a test email.
2. **AI providers:** add the fal.ai key (Kling and Veo video), the ElevenLabs key (voices) and the Anthropic key (scripts). Press **Test** on each.
3. **Payment methods → Bachs:**
   - Paste the **live** secret key and the webhook secret.
   - Leave **max per payment** at **5000** USD (Bachs's limit).
   - Customer fee: 4% by default. It's built into the price and customers never see it as a separate line.
   - Press **Test connection**.
4. **Payment methods → Gatevoo** (customer fee 0%), and Stripe if used.
5. **Integrations → VooSquare:** press **Connect VooSquare**, or set `VOO_BASE`, `VOO_CLIENT_ID`, `VOO_CLIENT_SECRET`, `VOO_API_KEY` and `VOO_WEBHOOK_SECRET` from VooSquare → Admin → Products → Vooads.

## 3. Bachs dashboard

1. **Webhook URL:** `https://vooads.com/api/webhooks/bachs`.
2. **Events to send:**
   - `checkout.completed`, `checkout.expired`
   - `collection.succeeded`, `collection.failed`
   - `invoice.paid`, `invoice.payment_failed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
3. **Auto-renew settings:**
   - The key must have subscription (recurring product) access.
   - Turn on Bachs's card retry schedule and the customer portal.
   - Vooads creates the recurring products itself.

## 4. Test before announcing (real money, small amounts)

1. Sign up as a new user. You should see **60 free credits**, and videos stay locked until a plan is bought.
2. Buy the smallest credit pack with **Bachs** (card). Credits should arrive once Bachs confirms.
3. Buy the cheapest monthly plan with **"Renew automatically"** on. In Admin → Payments → Subscriptions it should show as active. Then press **Cancel auto-renew** in the wallet. The plan should stay active until its end date.
4. Pay once with **Gatevoo** (USDT).
5. Make **one video** from the studio. It should finish and land in My ads.
6. **Actor previews:** after deploy, run the step in `docs/DEV-GUIDE.md` ("actor previews") once. It makes the moving previews for the 10 original actors, which need the live site address.
7. Admin → give yourself credits (Customers → your account → Credits → **Top-up**) to check the ledger.

These need a fix before launching publicly. If any of them happen, send a screenshot:
- An auto-renew field doesn't match Bachs's real webhook.
- A video job fails.
- An email doesn't arrive.

If something fails, the app falls back safely (one-off payments, a "needs attention" job), so nothing breaks for other users.

## 5. Safety switches (already on, leave them)

These are already on. Leave them as they are:
- the margin guard (60% minimum)
- the cost watchdog, which raises prices if provider costs rise and stops at 40%
- the free trial with no videos
- the FX guard for naira
