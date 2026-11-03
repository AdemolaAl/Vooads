# Vooads: Pricing & margin breakdown

Prepared 3 October 2026. All money is in USD. The machine-readable version is `pricing.json` next to this file; every number here matches it. Raw research and source links are in `research/video-types-2026.md`.

---

## 1. The short version

- **8 video types**, all profitable. Even if a customer pays the **lowest price anyone can pay** for a credit, every type keeps **62–76% gross margin**. Our floor (`min_margin_pct`) is **60%**.
- **Plan prices do not change.** Starter $49, Pro $149, Scale $349, Agency $799 (yearly = 10 months' price). Top-ups do not change.
- **Longer videos on bigger plans:** UGC up to 30 / 60 / 90 / 120 seconds (Starter / Pro / Scale / Agency), b-roll up to 15 / 30 / 45 / 60 seconds. This is safe because price is the same per second at any length.
- **Small credit changes:** Remix 2 → **3** credits. Hook pack and the new 10-angles job are **6** credits each (see "Final adjustments").
- **One rule the code must enforce:** a discount code must never push any job below 60%. The loss guard (section 7) does this automatically.

---

## 2. The 8 video types

| # | Video type | What the customer gets | Credits | Our cost | Lengths |
|---|---|---|---|---|---|
| 1 | **UGC talking video** (Most used) | AI creator talks to camera about the product | **15 per second** | $0.1165/s + $0.03 per video | 5s up to 30 / 60 / 90 / 120s |
| 2 | **Green-screen reaction** | AI creator reacts in front of a screenshot, product page or review | **15 per second** | $0.1165/s + $0.07 per video | 5s up to 30 / 60 / 60 / 60s |
| 3 | **Podcast clip** | AI host at a studio mic, cut like a viral podcast clip | **15 per second** | $0.1165/s + $0.03 per video | 5s up to 30 / 60 / 90 / 120s |
| 4 | **Product b-roll** | Product shots, lifestyle, unboxing, app demo from a prompt | **10 per second**, sold in 5s steps | $0.07/s | 5s up to 15 / 30 / 45 / 60s |
| 5 | **Photo to video** | The customer's own product photo, brought to life | **10 per second**, sold in 5s steps | $0.07/s | 5s up to 10 / 15 / 20 / 30s |
| 6 | **Slideshow ad with voiceover** (Cheapest) | Images with motion + AI voiceover + captions | **3 per second** | $0.017/s | 10s up to 60 / 90 / 120 / 120s |
| 7 | **Dub into another language** (New) | A working video re-voiced in a new language with lips re-synced | **12 per second, per language** | $0.09/s + $0.01 per video | 5s up to 30 / 60 / 90 / 120s |
| 8 | **Hook remix** (For winners) | A new spoken opening (up to 5s) from the same creator, stitched onto a winning video | **75 per variant** | $0.59 per variant | 1 new hook of up to 5s each |

Extras on any video: **AI script +8 credits** (our cost $0.062), **captions free** (we burn them in on our own server, so they cost us nothing).

**Why these 8.** Research for 2025–2026 (section 10) says the formats that win for media buyers are: creator-style UGC, hooks tested in volume, slideshow/photo-style video, demos and unboxing, green-screen and reaction videos, and localized versions for other countries. Each type above covers one of those, and each one is clearly profitable. I left out premium video models (Veo 3.1, Seedance 2.0, Sora 2 Pro) as their own types. They cost $0.12–0.70 per second, so they would need 17–75 credits per second, and buyers rarely need that look for performance ads.

**Where our cost comes from** (checked 3 October 2026):
- UGC types: Kling AI Avatar v2 Pro on fal.ai, $0.115/s, plus voice at about $0.0015/s, so **$0.1165/s**. Each video also needs one presenter image ($0.03), and green-screen needs one more image edit ($0.04).
- B-roll and photo to video: Kling 2.5 Turbo Pro on fal.ai, $0.35 per 5s = **$0.07/s**. It only makes 5s or 10s clips, so a 23s request would really cost us 25s. That is why we sell these in **5-second steps** (5, 10, 15 …).
- Slideshow: about 1 image per 2 seconds ($0.03 each = $0.015/s) plus voice ($0.0015/s), rounded up to **$0.017/s**. Joining the images into a video happens on our server with ffmpeg, which costs nothing per video.
- Dub: ElevenLabs Dubbing v2 ($0.0367/s) plus sync lipsync 2.0 on fal.ai ($0.05/s), rounded up to **$0.09/s**, plus $0.01 for translating the script with Claude.
- Hook remix: a new 5-second UGC opening ($0.1165 × 5 = $0.58) plus writing the hook with Claude, so **$0.59**.

---

## 3. What a credit sells for, and the worst case

> **Update:** discount codes now work on monthly plans only, so the real worst case is **$0.0280** per credit (Agency monthly with a 30% code). Sections 3–6 still use the older, stricter $0.0233, so every margin shown there is lower than the true worst case. Section 12 uses $0.0280 and also takes off card fees.

**Price per credit** = what the customer paid ÷ how many credits they got.

| How the credit is bought | Price per credit |
|---|---|
| Top-up $19 (350 credits) | $0.0543 |
| Starter monthly / Top-up $49 | $0.0490 |
| Top-up $99 (2,200) | $0.0450 |
| Top-up $249 (5,800) | $0.0429 |
| Pro monthly | $0.0426 |
| Scale monthly | $0.0411 |
| Agency monthly | $0.0400 |
| Agency yearly (price ÷ 12 months of credits) | $0.0333 |
| Agency monthly with a 30% first-month code | $0.0280 |
| **Agency yearly with a 30% code (the cheapest possible)** | **$0.0233** |

**Worst-case revenue per credit = $0.0233.** I use this number for every margin in this report. No customer can pay less than this, so every margin below is the lowest it can ever be.

How I got it: Agency yearly is $7,990 for 240,000 credits (20,000 a month × 12), which is $0.0333 per credit. The biggest discount code is 30%, so the customer pays 70% of that: $0.0333 × 0.70 = **$0.0233**.

> **Note for the backend:** today a "first month" discount code also works on a **yearly** plan, which takes 30% off a whole year. That loophole sets the worst case. If codes are limited to monthly billing, the worst case rises to **$0.0280** and every margin goes up by about 5 points (see the last column in section 5).

---

## 4. The formulas in plain words

1. **Credits charged** = credits per second × seconds (or credits per variant × variants). Add 8 if the AI writes the script.
2. **Our cost** = our cost per second × seconds + the fixed cost per video (presenter image and so on).
3. **Worst-case revenue** = credits charged × $0.0233.
4. **Gross margin** = (worst-case revenue − our cost) ÷ worst-case revenue. Write it as a percentage.
5. **The rule:** gross margin must be at least 60%. Turn it round and you get the fewest credits we may charge:
   **minimum credits = our cost ÷ (1 − 0.60) ÷ $0.0233**, rounded up.
   In words: one credit may carry at most **$0.00932** of our cost (that is 40% of $0.0233).

Quick check for UGC: our cost is $0.1165 a second, and $0.1165 ÷ $0.00932 = 12.5. So 13 credits per second would just pass. We charge 15, which leaves room for model price changes.

---

## 5. Margins at 15, 30 and 60 seconds (worst case)

Revenue uses the worst-case $0.0233 per credit. The last column shows the margin if discount codes are limited to monthly plans ($0.0280 per credit).

| Video type | Length | Credits | Our cost | Worst-case revenue | **Margin** | Margin if codes are monthly-only |
|---|---|---|---|---|---|---|
| UGC talking video | 5s (shortest) | 75 | $0.61 | $1.75 | **65.0%** | 70.8% |
| | 15s | 225 | $1.78 | $5.24 | **66.1%** | 71.8% |
| | 30s | 450 | $3.53 | $10.49 | **66.4%** | 72.0% |
| | 60s | 900 | $7.02 | $20.97 | **66.5%** | 72.1% |
| Green-screen reaction | 5s (shortest) | 75 | $0.65 | $1.75 | **62.7%** | 68.9% |
| | 15s | 225 | $1.82 | $5.24 | **65.3%** | 71.1% |
| | 30s | 450 | $3.57 | $10.49 | **66.0%** | 71.7% |
| | 60s | 900 | $7.06 | $20.97 | **66.3%** | 71.9% |
| Podcast clip | 15s | 225 | $1.78 | $5.24 | **66.1%** | 71.8% |
| | 30s | 450 | $3.53 | $10.49 | **66.4%** | 72.0% |
| | 60s | 900 | $7.02 | $20.97 | **66.5%** | 72.1% |
| Product b-roll | 15s | 150 | $1.05 | $3.50 | **70.0%** | 75.0% |
| | 30s | 300 | $2.10 | $6.99 | **70.0%** | 75.0% |
| | 60s | 600 | $4.20 | $13.98 | **70.0%** | 75.0% |
| Photo to video | 15s | 150 | $1.05 | $3.50 | **70.0%** | 75.0% |
| | 30s (Agency max) | 300 | $2.10 | $6.99 | **70.0%** | 75.0% |
| Slideshow + voiceover | 15s | 45 | $0.26 | $1.05 | **75.7%** | 79.7% |
| | 30s | 90 | $0.51 | $2.10 | **75.7%** | 79.7% |
| | 60s | 180 | $1.02 | $4.20 | **75.7%** | 79.7% |
| Dub (per language) | 15s | 180 | $1.36 | $4.19 | **67.6%** | 73.0% |
| | 30s | 360 | $2.71 | $8.39 | **67.7%** | 73.1% |
| | 60s | 720 | $5.41 | $16.78 | **67.8%** | 73.1% |
| Hook remix | 1 variant | 75 | $0.59 | $1.75 | **66.2%** | 71.9% |
| | 3 variants | 225 | $1.77 | $5.24 | **66.2%** | 71.9% |
| | 5 variants | 375 | $2.95 | $8.74 | **66.2%** | 71.9% |
| **Extra: AI script** | per video | 8 | $0.062 | $0.19 | **66.7%** | 72.3% |

**The lowest number in the whole table is 62.7%**: a 5-second green-screen video, where the fixed $0.07 per video is shared over only 5 seconds. Everything is above 60%.

**Other actions (not video types), same worst case:**

| Action | Credits | Our cost | Margin |
|---|---|---|---|
| Image set (3 Meta sizes) | 12 | $0.09 | 67.8% |
| Hook pack (20 hooks + copy) | **6** | $0.021 | 85.0% |
| AI script | 8 | $0.062 | 66.7% |
| Remix (text/caption/crop, no new AI video) | **3** (was 2) | $0.019 | 72.8% |
| 10 angles | **6** | $0.019 | 86.4% |
| Voiceover on its own | 0.25 per second | $0.0015/s | 74.3% |

---

## 6. Worked example for each type

All examples use the worst-case price, $0.0233 per credit. A normal Pro customer pays $0.0426 per credit, so their real margin is much higher.

1. **UGC talking video, 30s, with AI script.** Credits = 15 × 30 + 8 = **458**. Our cost = $0.1165 × 30 + $0.03 + $0.062 = **$3.59**. Worst-case revenue = 458 × $0.0233 = **$10.67**. Margin = ($10.67 − $3.59) ÷ $10.67 = **66.4%**. The customer sees: "30s video = 3 parts of 10s, stitched automatically".
2. **Green-screen reaction, 15s.** Credits = 15 × 15 = **225**. Cost = $0.1165 × 15 + $0.07 = **$1.82**. Revenue = **$5.24**. Margin **65.3%**.
3. **Podcast clip, 60s.** Credits = **900**. Cost = $0.1165 × 60 + $0.03 = **$7.02**. Revenue = **$20.97**. Margin **66.5%**. It is rendered as 6 parts of 10s.
4. **Product b-roll, 20s.** 20 is a multiple of 5, so credits = 10 × 20 = **200**. Cost = $0.07 × 20 = **$1.40** (two 10s clips). Revenue = **$4.66**. Margin **70.0%**. If someone asks for 22s, the app rounds up to 25s = 250 credits, because the provider bills 25s.
5. **Photo to video, 10s.** Credits = **100**. Cost = **$0.70**. Revenue = **$2.33**. Margin **70.0%**.
6. **Slideshow, 30s, with AI script.** Credits = 3 × 30 + 8 = **98**. Cost = $0.017 × 30 + $0.062 = **$0.57**. Revenue = **$2.28**. Margin **75.0%**.
7. **Dub a 30s winner into French, Portuguese and Swahili.** Credits = 12 × 30 × 3 = **1,080**. Cost = ($0.09 × 30 + $0.01) × 3 = **$8.13**. Revenue = **$25.16**. Margin **67.7%**. Rendering a fresh UGC video in each language would cost the customer 1,350 credits, so dubbing is cheaper for them and still safe for us.
8. **Hook remix, 4 new hooks on a winning video.** Credits = 75 × 4 = **300**. Cost = $0.59 × 4 = **$2.36**. Revenue = **$6.99**. Margin **66.2%**.

---

## 7. Why you can never lose money on a user

**1. Credits are paid for first.** A customer cannot start a job without enough credits in their balance, and credits only come from a payment that has already cleared, or from the small free trial. So we never pay for AI work and then hope to get paid.

**2. Every credit is priced for the cheapest buyer.** Section 5 shows that even the cheapest credit anyone can buy ($0.0233) covers our cost at least 2.5 times over.

**3. The loss guard checks every job before it runs** (`server/guard.js`, spec §4). For each job it works out:
- the cost of the AI provider **actually selected** for that job (from the providers table; if missing, the number in `pricing.json`),
- the revenue = credits × the lowest price per credit right now (including the biggest active discount code),
- the margin.

If the margin is below 60%, the job is **not** run at that price. The guard raises the credits to the safe minimum (`minimum credits = cost ÷ 0.40 ÷ worst-case price per credit`, rounded up) and the quote shows "adjusted". This protects you if:
- you switch to a dearer model (for example Veo 3.1 Fast at $0.15/s): b-roll goes up from 10 to 17 credits per second by itself;
- a provider raises its price and you update it in the admin;
- someone creates a big discount code.

**4. Price is linear per second.** A 120s video costs exactly 8 times a 15s one. Long videos are never cheaper per second, so long videos can't be used to get cheap AI time. **No extra per-video minimum is needed:** the shortest allowed length (5s, or 10s for slideshow) already covers the fixed cost per video (lowest case 62.7%). For b-roll and photo to video, lengths go up in 5s steps so we never pay for seconds we did not charge.

**5. Long videos stay profitable.** A long video is cut into parts (10s for UGC, dub up to 60s, b-roll 10s) and joined with ffmpeg. Each part costs the same per second, and joining costs nothing. Margin at 60s and 120s is the same as at 15s (about 66% for UGC).

**6. Abuse limits** (admin → settings → limits). Recommended defaults:

| Limit | Default | Why |
|---|---|---|
| `trial_max_jobs_per_day` | **10** | A trial user can use their 60 credits in a few jobs. More than 10 a day looks like a script. |
| `max_concurrent_jobs` (per user) | **3** | Stops one account filling the render queue. |
| `daily_credit_cap` (per user) | **0 = off**, but turn on **5,000** if you see chargebacks | Credits are prepaid, so a cap is not needed for margin. It limits damage from a stolen card: 5,000 credits cost us at most about $47 a day. |
| `max_signups_per_ip_per_day` | **3** | Stops trial farming. One trial per email, device and card. |
| Biggest discount code (admin) | **30%** max | The admin form allows up to 90%. At 90% off, the guard would raise credits for **every** job by about 7 times. Keep codes at 30% or less, and use them on monthly plans. |
| Free trial | **60 credits, no video at all, watermark** | Worst cost per sign-up is a few cents (hooks, images, angles). |

**7. Failed jobs.** If a render fails, the customer gets **all** credits back. fal.ai normally does not bill a request that fails. For long videos, the backend should retry a failed part up to 2 times before giving up. If some parts succeeded and only the joining step fails, the job counts as **done** and returns the parts as a playlist, not refunded. That way the money we lose to refunds is close to zero. The rare case where we paid for some parts and still refund everything is covered by the 60%+ margin.

**The one way left to lose money: chargebacks** (someone pays with a stolen card, uses the credits, then the bank takes the money back). Defences: the daily credit cap above, 3-D Secure on Stripe, crypto payments via Gatevoo (no chargebacks), and banning the account (which already removes its credits).

---

## 8. Payment fees

Fees come off the top before margin:
- **Stripe card:** about 2.9% + $0.30 per payment (international cards plus currency conversion can reach about 5%). On the very worst case (Agency yearly with 30% off, paid by card), the $0.0233 per credit becomes about $0.0226 after fees. UGC margin drops from 66.1% to **65.7%**. At a 5% card fee it is **64.8%**. Still above 60%.
- **Small payments:** the $0.30 fixed fee hurts most on the $19 top-up (4.5% of it). Those credits sell at $0.0543, so margin there is still above 80%.
- **Crypto (Gatevoo, USDT):** about 0.5–1%, no chargebacks. Push big yearly buyers to crypto or bank transfer.
- The guard does not subtract fees. That is why I set every type at **62% or more**, not exactly 60%: the extra few points pay the fee.

---

## 9. Plans (unchanged prices, longer max lengths)

| | Starter | Pro | Scale | Agency |
|---|---|---|---|---|
| Monthly price | $49 | $149 | $349 | $799 |
| Yearly price | $490 | $1,490 | $3,490 | $7,990 |
| Credits / month | 1,000 | 3,500 | 8,500 | 20,000 |
| Seats | 1 | 2 | 5 | 15 |
| Longest UGC / podcast / dub | 30s | 60s | **90s** (was 60) | **120s** (was 60) |
| Longest green-screen | 30s | 60s | 60s | 60s |
| Longest b-roll | **15s** (was 10) | **30s** (was 15) | **45s** (was 20) | **60s** (was 30) |
| Longest photo to video | 10s | 15s | 20s | 30s |
| UGC videos (15s) per month | about 4 | about 15 | about 37 | about 88 |
| Slideshows (30s) per month | about 11 | about 38 | about 94 | about 222 |
| AI script writer | — | Yes | Yes | Yes |

**Why the longer lengths:** Meta recommends 15–60s video ads, and 30–60s explainers and dubbed versions are common for apps, fintech and courses. Stitching makes long videos possible, and because price is linear per second, a 120s video is just as profitable as a 15s one. Bigger plans get longer videos as a reason to upgrade. (This depends on the stitching in spec §3 being live. Until then the backend should cap at one segment.)

**Top-ups (unchanged):** $19 / 350, $49 / 1,000, $99 / 2,200, $249 / 5,800. Paid plans only, never expire.

**Free trial:** 60 credits. Images, hooks and angles only, watermarked. No video of any kind on the trial.

---

## 10. Market check

**Formats that perform in 2025–2026** (sources in the research file):
- Creator-style UGC beats polished brand video; UGC lowers CPA by about 23% on average.
- Hooks decide winners. Winning creative lasts 7–10 days, so buyers need 3–5 new concepts a week. That is why we have hook remix.
- Photo, carousel and slideshow-style video are "a genuine performance slot", and still-plus-motion "poster videos" lift watch time by about 18%. That is why we have slideshow and photo to video.
- Unboxing (9.8% hit rate), demo (8.1%) and testimonial (6.5%) are top Meta formats. Green-screen and reaction formats are common. That is why we have b-roll styles and green-screen.
- AI dubbing into 15+ languages is a working 2026 type. That is why we have dub.

**Competitors:**

| Tool | Price | Per video |
|---|---|---|
| Arcads | $110 / 10 videos, $220 / 20 | about $11 |
| MakeUGC | $49 / 5, $69 / 10, $119 / 20 | $6–$10, raw clips |
| Creatify | $39 / 100 credits, $99 / 200 | about $7.80, credits expire |
| HeyGen | $29 / $49 / $149 plans | general avatar tool |
| Higgsfield | $19 / $59 / $129 plans | general video generator |
| Human UGC creator | | $150–$300 |
| **Vooads Pro** | **$149 / 3,500 credits** | **15s UGC = 225 credits = $9.58**, slideshow 15s = $1.92, dub 15s = $7.66 |

Vooads sits in the same price band as MakeUGC and Arcads for UGC. It is much cheaper for slideshows, b-roll, dubs and hook remixes, and all of it comes from one credit pool.

---

## 11. Things to watch

1. **The avatar model is most of our cost.** Kling Avatar v2 Pro is $0.115/s. HeyGen's API lists Avatar IV at $0.05/s; if its quality passes a test it could be a cheaper backup. OmniHuman 1.5 ($0.16/s) would need 20 credits/s. The guard handles this automatically.
2. **Kling Avatar's longest single render is not published.** Parts are 10s to be safe. If longer audio works, raise `segment_seconds` to 20–30 for fewer joins (price is unchanged).
3. **Dub uses a lip-sync provider**, not the UGC avatar. If the guard reads the default `ugc` provider ($0.115/s) for dub jobs, it will raise dub from 12 to 13 credits/s. That is safe, just a bit dearer for the customer. The backend should use the `provider_model` in `pricing.json` (sync lipsync 2.0).
4. **Claude token use is estimated** (about 6k in / 5k out per script). Check real usage in the logs after launch.
5. **Prices change.** Re-check provider prices every quarter (links in the research file).


## Final adjustments after integration (3 Oct 2026)

- **Discount codes only work on monthly plans.** Yearly already includes 2 months free. This lifts the worst-case price per credit from $0.0233 to $0.0280 (Agency monthly with a 30% first-month code), and every margin above rises by about 5 points.
- **Hook pack: 3 → 6 credits. Angles: 3 → 6 credits.** At $0.0280 per credit, 6 credits = $0.168 against about $0.062 of Claude Sonnet cost, a 63% margin. At 3 credits it was 26%.
- **Free trial cannot make any video, slideshow included.** Trial credits cover hooks, images, angles and Ban Shield. This keeps the cost of a free sign-up at a few cents.
- **Discount codes are capped at 50%** in the admin. While a big code is active, the profit guard raises job prices automatically so margins never fall under the minimum.

---

## 12. Animated ads, music and voice tiers

Added 3 October 2026 (spec §12). Raw notes and sources: `research/music-voice-motion-2026.md`.

### 12.1 The worst case used here (now including card fees)

- Cheapest credit anyone can buy: **Agency monthly with a 30% first-month code** = $799 × 0.70 ÷ 20,000 = **$0.0280**. Discount codes no longer work on yearly plans.
- Take off the worst card fee: Stripe 2.9% + 1.5% international + 1% currency conversion = **5.4%**, plus $0.30 per payment. That leaves **$0.02644** per credit.
- At 60% margin, one credit may carry at most 40% × $0.02644 = **$0.0106** of our cost.

Every margin in this section is: (credits × $0.02644 − our cost) ÷ (credits × $0.02644).

### 12.2 New prices

| Item | Credits | Our cost | Price on Pro monthly ($0.0426 per credit) |
|---|---|---|---|
| **Animated ad, Standard** (`motion_ad`) | **4 per second** (10–60s) | $0.017/s + $0.03 per ad | 15s = 60 credits = **$2.55** |
| **Animated ad, Ultra-realistic** (`motion_ad_ultra`) | **10 per second**, 5s steps (10–60s), ultra voice included | $0.08/s + $0.03 per ad | 15s = 150 credits = **$6.39** |
| **Background music, AI-made** (`addons.music`) | **+2 per second**, minimum 10s | $0.0025/s + $0.15 per track | 15s = +30 credits = **+$1.28** |
| **Background music, from your library** | **free** (0) | $0 | free |
| **Ultra-realistic voice** (`addons.voice_ultra`) | **+1 per second** | $0.0015/s | 15s = +15 credits = **+$0.64** |

The Standard vs Ultra difference the studio should show per 15s: **60 vs 150 credits**.

**Where the animated-ad cost comes from**
- **Standard:** footage from Pexels and Pixabay is free. I still budget as if every scene fell back to an AI image (1 image per 2 seconds at $0.03 = $0.015/s). Add standard voice ($0.0006/s) and server rendering/storage (about $0.001/s), and round up to **$0.017/s**. Plus $0.03 per ad for the AI scene plan (Claude) and the end card.
- **Ultra:** every second is AI video from Kling 2.5 Turbo Pro ($0.07/s, made in 5s clips). Add a first-frame image per scene ($0.006/s), ultra voice ($0.0015/s) and rendering, and round up to **$0.08/s**. Plus $0.03 per ad. Lengths go in 5s steps because Kling bills whole 5s clips.

### 12.3 Every combination, worst case after card fees

| Video | Length | Options | Credits | Our cost | Worst-case revenue | **Margin** |
|---|---|---|---|---|---|---|
| Animated ad, Standard | 10s (shortest) | none | 40 | $0.20 | $1.06 | **81.1%** |
| | 10s | + music | 60 | $0.38 | $1.59 | **76.4%** |
| | 15s | none | 60 | $0.29 | $1.59 | **82.0%** |
| | 15s | + music | 90 | $0.47 | $2.38 | **80.1%** |
| | 15s | + ultra voice | 75 | $0.31 | $1.98 | **84.5%** |
| | 15s | + music + ultra voice | 105 | $0.50 | $2.78 | **82.2%** |
| | 30s | none | 120 | $0.54 | $3.17 | **83.0%** |
| | 30s | + music | 180 | $0.77 | $4.76 | **83.9%** |
| | 30s | + ultra voice | 150 | $0.59 | $3.97 | **85.2%** |
| | 30s | + music + ultra voice | 210 | $0.81 | $5.55 | **85.4%** |
| | 60s | none | 240 | $1.05 | $6.35 | **83.5%** |
| | 60s | + music | 360 | $1.35 | $9.52 | **85.8%** |
| | 60s | + ultra voice | 300 | $1.14 | $7.93 | **85.6%** |
| | 60s | + music + ultra voice | 420 | $1.44 | $11.10 | **87.0%** |
| Animated ad, Ultra | 10s (shortest) | none | 100 | $0.83 | $2.64 | **68.6%** |
| | 10s | + music | 120 | $1.01 | $3.17 | **68.3%** |
| | 15s | none | 150 | $1.23 | $3.97 | **69.0%** |
| | 15s | + music | 180 | $1.42 | $4.76 | **70.2%** |
| | 30s | none | 300 | $2.43 | $7.93 | **69.4%** |
| | 30s | + music | 360 | $2.66 | $9.52 | **72.1%** |
| | 60s | none | 600 | $4.83 | $15.86 | **69.6%** |
| | 60s | + music | 720 | $5.13 | $19.04 | **73.1%** |
| UGC talking / podcast | 5s (shortest) | + music + ultra voice | 100 | $0.78 | $2.64 | **70.4%** |
| | 15s | none | 225 | $1.78 | $5.95 | **70.1%** |
| | 15s | + music | 255 | $1.97 | $6.74 | **70.9%** |
| | 15s | + music + ultra voice | 270 | $1.99 | $7.14 | **72.2%** |
| | 30s | + music | 510 | $3.75 | $13.48 | **72.2%** |
| | 60s | + music | 1,020 | $7.32 | $26.97 | **72.9%** |
| Green-screen | 5s (shortest) | none | 75 | $0.65 | $1.98 | **67.1%** (lowest in this table) |
| | 15s | + music | 255 | $2.01 | $6.74 | **70.3%** |
| Slideshow | 10s (shortest) | + music | 50 | $0.35 | $1.32 | **73.9%** |
| | 15s | + music | 75 | $0.44 | $1.98 | **77.7%** |
| | 30s | + music + ultra voice | 180 | $0.78 | $4.76 | **83.6%** |
| Product b-roll / Photo to video | 5s (shortest) | + music | 70 | $0.51 | $1.85 | **72.3%** |
| | 15s | + music | 180 | $1.24 | $4.76 | **74.0%** |
| | 30s | + music | 360 | $2.33 | $9.52 | **75.6%** |
| Dub | 15s | none | 180 | $1.36 | $4.76 | **71.4%** |
| Music on its own | 10s (minimum) | — | 20 | $0.18 | $0.53 | **66.9%** |
| Ultra voice on its own | any | — | 1/s | $0.0015/s | $0.026/s | **94.3%** |

**Lowest of every combination: 67.1%**, above the 60% floor even after the worst card fee. With music the lowest is 67.6% (5s green-screen + music). Music and ultra voice never pull a job's margin down, because each add-on is above 60% on its own.

**If an admin makes a 50% code** (the new cap): the cheapest credit falls to about $0.0189 after fees. A 15s UGC video would then be at 58%, so the profit guard raises it (225 → 236 credits) while that code is active. Ultra animated ads would drop to about 56%, so the guard would raise them from 10 to 11 credits per second. Standard animated ads stay above 70%. Add-ons are checked as part of the whole job, so they are covered too.

### 12.4 Which APIs to use (cheapest that sounds professional)

| Job | Use | Price | Why |
|---|---|---|---|
| **Standard voice** | ElevenLabs **Flash v2.5** (`eleven_flash_v2_5`) | $0.04 per 1,000 characters (about $0.0006 per second) | Sounds clean and professional, 32 languages, very fast. Same API key as today. |
| **Ultra voice** | ElevenLabs **v3** today. Move to **Eleven v4** after a listening test. | $0.08 per 1,000 characters list (v4 is $0.022 on a promo until 12 Oct) | Eleven v4 is **#1 of all text-to-speech models** on the Artificial Analysis arena (Elo 1321). v3 is the most expressive model available in the adapter today. We budget $0.10 per 1,000 for safety. |
| **AI music** | **ElevenLabs Music API, direct** (adapter `elevenlabs_music`) | $0.15 per minute | Trained only on licensed music and cleared for commercial use, ads included. That matters because customers run these as paid ads. Same vendor and key as voice. |
| AI music, backup | Google **Lyria 2** on fal.ai | $0.10 per 30s | Cheap, good instrumental beds. Check Google's terms before turning it on. |
| **Avoid** | ElevenLabs Music **through fal.ai** | $0.80 per minute, **rounded up** | A 10s track would cost $0.80. That pushes a 10s slideshow with music to 27% margin (the guard would then raise the price). Use the direct API instead. |
| **Stock footage** | **Pexels API** first, **Pixabay API** second | **Free** | Both licences allow commercial use in ads with no attribution in the ad itself. See the rules below. |
| **Ultra scenes** | Kling 2.5 Turbo Pro image-to-video (the current default `video` provider) | $0.07/s | Same model as b-roll and good motion. Upgrades: Kling v3 Pro ($0.112/s) would need about 12 credits/s; Veo 3.1 Fast ($0.15/s on fal) about 16. The guard raises credits automatically if the admin switches. |
| Cheaper alternatives to test later | Gemini 3.8 Flash TTS ($16.50 per 1M characters, arena #4); OpenAI gpt-4o-mini-tts (about $0.015 per minute, cheapest) | | Both need a new adapter. Voice is under 2% of any video's cost, so this saves almost nothing. Not worth doing now. |

**Stock footage rules the backend must follow:**
- **Pexels:** limit of 200 requests an hour and 20,000 a month, so cache searches. Credit Pexels in the app's picker. Don't suggest that the people in a clip endorse the product.
- **Pixabay:** limit of 100 requests a minute. Results must be cached for 24 hours. Download clips to our own storage; don't hotlink. Show "from Pixabay" where results are listed. **Skip clips showing recognisable brands or logos**, because Pixabay forbids commercial use of those.
- **Both:** never resell the raw clip on its own. Using it inside an edited ad is allowed.

### 12.5 Owner's question: should customers be able to add background music, which uses more credits?

**Yes.** Here is how it should work:

1. **Library music is free (0 credits).** Tracks the admin uploads cost us nothing per use. Free music makes every ad sound finished, and competitors include music. A free option also means nobody feels forced to pay for music.
2. **AI music is a paid upgrade at 2 credits per second, charged on at least 10 seconds.** It makes a fresh track that fits the mood and length exactly, so no two customers share the same song. On a 15s ad that is +30 credits (about $1.28 on Pro). Our real cost is about $0.19, so the add-on alone earns 67%+ in the worst case and about 90% for a normal Pro customer.
3. **It does use more credits, and that is good for you.** Each add-on is profitable on its own, so every extra credit a customer spends on music adds profit. It also brings plan upgrades and top-ups sooner. It can never cause a loss, because music has its own margin and the profit guard adds the music cost to every quote.
4. **The 10-second minimum** exists because the music provider can charge for a whole track even when it is short. Charging at least 20 credits for music covers that ($0.53 worst-case revenue against $0.18 cost).
5. **Not offered on dub or hook remix.** Dubbing keeps the original background sound, and a hook remix reuses the winner's soundtrack.

### 12.6 Notes for the backend

- `addons.music` has `fixed_cost_usd: 0.15` (per track) and `min_units: 10`. Charge `credits_per_unit × max(seconds, min_units)`. The guard cost is `provider_cost_usd_per_unit × seconds + fixed_cost_usd`.
- `motion_ad_ultra.includes = ["voice_ultra"]`. Do not charge the ultra-voice add-on on it.
- Each video type has `addons_allowed`; only show and charge those add-ons.
- `motion_ad_ultra` has `seconds_step: 5`. Round the length up to the next 5s.
- `motion_ad` has `provider_kind: "image"` (the cost driver when stock footage is missing). The stock provider rows cost $0.
- `voice_tiers.*.provider_hint` names the model. ElevenLabs' public model list does not show a v4 model ID yet, so v3 stays the ultra default until v4 is in the adapter.
- `payment_fees` in `pricing.json` is for information and the admin margin preview. The guard does not need to subtract it, because every type was set at 65%+ to leave room for fees.

---

## 13. Quality levels: pick the model, never at a loss (4 Oct 2026)

Owner approved: customers choose a **quality level** for every video type that renders footage. Each level is one specific
model with its own provider row and its own price. Types without levels (slideshow, dub, Animated ad Standard) are unchanged.

### 13.1 The models and what they cost us

Prices are **fal.ai list prices, checked 4 October 2026** on each model's page at fal.ai/models. One fal.ai key runs all of them.

| Level | Talking presenter (UGC, green-screen, podcast, hook remix) | Footage (b-roll, photo to video, Animated ad Ultra scenes) | Lowest plan |
|---|---|---|---|
| **Standard** | Kling AI Avatar v2 Pro, `fal-ai/kling-video/ai-avatar/v2/pro`, **$0.115/s** | Kling 2.5 Turbo Pro, `fal-ai/kling-video/v2.5-turbo/pro/...`, **$0.07/s** (5 or 10 s clips) | same as the type |
| **Pro realistic** | OmniHuman v1.5 (ByteDance), `fal-ai/bytedance/omnihuman/v1.5`, **$0.16/s** | Kling 3.0 Pro with audio, `fal-ai/kling-video/v3/pro/text-to-video` + `image-to-video`, **$0.168/s** audio on ($0.112 off; we price audio on) | Pro |
| **Ultra cinematic** | Google Veo 3.1 1080p with native dialogue audio, `fal-ai/veo3.1/image-to-video` (presenter photo = reference frame, `generate_audio: true`), **$0.40/s** | Google Veo 3.1 1080p with audio, `fal-ai/veo3.1` (image model `fal-ai/veo3.1/image-to-video`), **$0.40/s** | Scale |

Admin-only alternatives, seeded **off**: **Veo 3.1 Fast** 1080p with audio ($0.15/s, Pro level) and **Seedance 2.0** 1080p
(`bytedance/seedance-2.0/text-to-video`, $0.682/s, Ultra level; switched on, Ultra footage would need about **65 credits/s**,
and the guard raises it by itself). 4K Veo ($0.60/s) is not offered.

**Veo bills fixed clip lengths (4, 6 or 8 s, 8 s max).** Long videos are rendered in 8 s parts and stitched; presenter
consistency comes from the reference image. The guard prices the cheapest set of Veo clips that covers the length (a 5 s
video is billed as one 6 s clip, 10 s as 4 + 6 s, 15 s as 8 + 8 s), never the requested seconds.

### 13.2 Prices (credits per second; hook remix per hook)

| Video type | Standard | Pro realistic | Ultra cinematic |
|---|---|---|---|
| UGC talking, green-screen, podcast | 15 (unchanged) | **22** | **45** |
| Product b-roll, photo to video | 10 (unchanged) | **18** | **45** (brief said 40; the guard needs 43 for a 5 s video, rounded up to 45) |
| Hook remix (per hook, up to 5 s) | 75 (unchanged) | **110** | **240** |
| Animated ad (Ultra) scenes | 10 (unchanged) | **24** | **55** |

### 13.3 The arithmetic (worst case $0.0280 per credit = Agency monthly with a 30% code)

Sample = the profit guard's sample job: 15 seconds with the AI script (one 3 s hook for hook remix). Cost = main render
on the level's model + everything else (standard voice $0.05/1k chars, the AI script $0.062, the type's fixed cost).
Revenue = credits × $0.027965. "After card fee" takes 5.4% off revenue (worst card fee). "Worst length" is the lowest
margin at any length the plans allow, without the card fee.

| Type | Level · model | Cr/unit | Sample | Credits | Revenue | Cost (render + rest) | Margin | After card fee | Worst length |
|---|---|---|---|---|---|---|---|---|---|
| UGC talking | Standard · Kling Avatar v2 | 15 | 15 s (7.5 + 7.5 s parts) | 233 | $6.52 | $1.73 + $0.10 = $1.83 | 71.9% | 66.5% | 71.0% (5 s) |
| UGC talking | Pro realistic · OmniHuman 1.5 | 22 | 15 s | 338 | $9.45 | $2.40 + $0.10 = $2.50 | 73.5% | 68.1% | 72.9% (5 s) |
| UGC talking | Ultra cinematic · Veo 3.1 | 45 | 15 s (8 + 8 s clips) | 683 | $19.10 | $6.40 + $0.10 = $6.50 | 66.0% | 60.6% | 61.3% (5 s) |
| Green-screen | Standard | 15 | 15 s | 233 | $6.52 | $1.73 + $0.14 = $1.87 | 71.3% | 65.9% | 69.1% (5 s) |
| Green-screen | Pro realistic | 22 | 15 s | 338 | $9.45 | $2.40 + $0.14 = $2.54 | 73.1% | 67.7% | 71.6% (5 s) |
| Green-screen | Ultra cinematic | 45 | 15 s (8 + 8 s) | 683 | $19.10 | $6.40 + $0.14 = $6.54 | 65.7% | 60.3% | 60.7% (5 s) |
| Podcast clip | Standard / Pro / Ultra | 15 / 22 / 45 | 15 s | 233 / 338 / 683 | as UGC talking | as UGC talking | 71.9 / 73.5 / 66.0% | 66.5 / 68.1 / 60.6% | 71.0 / 72.9 / 61.3% |
| Product b-roll | Standard · Kling 2.5 Turbo | 10 | 15 s (10 + 5 s clips) | 150 | $4.19 | $1.05 | 75.0% | 69.6% | 75.0% |
| Product b-roll | Pro realistic · Kling 3.0 | 18 | 15 s | 270 | $7.55 | $2.52 | 66.6% | 61.2% | 66.6% |
| Product b-roll | Ultra cinematic · Veo 3.1 | 45 | 15 s (8 + 8 s clips) | 675 | $18.88 | $6.40 | 66.1% | 60.7% | 61.9% (5 s) |
| Photo to video | Standard / Pro / Ultra | 10 / 18 / 45 | 15 s | 150 / 270 / 675 | as b-roll | as b-roll | 75.0 / 66.6 / 66.1% | 69.6 / 61.2 / 60.7% | 75.0 / 66.6 / 61.9% |
| Hook remix | Standard · Kling Avatar v2 | 75 | 3 s hook | 75 | $2.10 | $0.35 + $0.06 = $0.41 | 80.5% | 75.1% | 69.4% (5 s) |
| Hook remix | Pro realistic · OmniHuman 1.5 | 110 | 3 s hook | 110 | $3.08 | $0.48 + $0.06 = $0.54 | 82.3% | 76.9% | 71.9% (5 s) |
| Hook remix | Ultra cinematic · Veo 3.1 | 240 | 3 s hook (4 s billed) | 240 | $6.71 | $1.60 + $0.06 = $1.66 | 75.2% | 69.8% | 63.3% (5 s, 6 s billed) |
| Animated ad (Ultra) | Standard · Kling 2.5 Turbo | 10 | 15 s, 4 scenes × 5 s | 158 | $4.42 | $1.40 + $0.11 = $1.51 | 65.7% | 60.3% | 50.1% (10 s) * |
| Animated ad (Ultra) | Pro realistic · Kling 3.0 | 24 | 15 s, 4 × 5 s | 368 | $10.29 | $3.36 + $0.11 = $3.47 | 66.2% | 60.8% | 50.0% (10 s) * |
| Animated ad (Ultra) | Ultra cinematic · Veo 3.1 | 55 | 15 s, 4 × 4 s | 833 | $23.29 | $6.40 + $0.11 = $6.51 | 72.0% | 66.6% | 58.3% (10 s) * |

Worked example, UGC Ultra 15 s: 15 × 45 = 675 + 8 (AI script) = 683 credits × $0.027965 = $19.10 revenue. Veo renders two
8 s clips = 16 billed seconds × $0.40 = $6.40, plus the voice ($0.01), script ($0.062) and fixed cost ($0.03) = $6.50.
Margin = (19.10 − 6.50) ÷ 19.10 = **66.0%**.

\* **Animated ads at 10 s** always have 4 scenes, so they render 20 s of footage for a 10 s ad. That was underpriced
before this change (the guard priced 10 s of footage); it now prices each scene's real clip length, so a 10 s Animated ad
(Ultra) costs more than its list price on every level: the guard raises the quote by itself (the studio shows the real
price) and the margin stays at 60% or more.

### 13.4 How the guard prices a level (and why it can never lose)

1. The job is priced on **the chosen level's own models**: the level's main model (`provider_tag`) and every other
   **enabled** model of the same level. The guard takes the **most expensive** of them, never a cheaper one. (Before this
   change the guard priced the first working provider only, so a pricier fallback could run at a loss.)
2. Jobs without a level (and the old `ugc` / `video` job types, and dub's presenter fallback) run and are priced on
   **standard** models only.
3. At run time, if the main model fails, the job falls back only to another model **of the same level**, or to a
   **higher** level **only while the job's price still covers it at the minimum margin**. Never to a cheaper level. If
   nothing is left, the job fails and the credits are refunded. The customer always pays the level's price, never less.
4. A level whose models are all switched off is **hidden** in the studio and refused by the API.
5. Saving pricing in Admin runs the guard on every enabled level: a level below the minimum margin is **raised** to the
   guard's safe price (whole credits) and the admin is told.

### 13.5 Choosing models

- **Standard** is the volume workhorse: fast, cheap, good enough for testing many hooks and angles.
- **Pro realistic** is for winners and close-ups: OmniHuman 1.5 moves hands, face and body much more naturally than
  Kling Avatar; Kling 3.0 adds real physics and synced sound to product shots.
- **Ultra cinematic** is for hero ads: Veo 3.1 is the most cinematic model on fal today. For talking ads it speaks the line
  itself (native dialogue), so the chosen ElevenLabs voice does not apply on this level; the voice can differ slightly
  between 8 s parts. Use it for 8 to 16 second ads where it shines.
- To swap a level's model: add or switch on a provider row with `config.level` set to that level (Admin → AI providers),
  then pick it in Admin → Pricing → Video types → the level's **Model** menu. Save: the guard re-checks the margin.

## 14. Editing tools: Change background, Auto-edit, Brand music (4 Oct 2026)

Owner approved. Three new video types (`content/pricing.json` → `video_types`, editable in Admin → Pricing → Video types).
The profit guard prices each job on the **most expensive enabled provider** that could run it and raises the price when
the margin would drop under 60% (`server/guard.js`). Worst case per credit: **$0.03329** (Agency yearly), **$0.02796** with a
30% code active.

### 14.1 What they cost us

| Step | Provider (seeded row) | Cost we price |
|---|---|---|
| Background removal | fal VEED video background removal fast, `veed/video-background-removal/fast` | $0.012 per 30 frames with edge refinement ($0.008 without). Priced at **60 fps worst case = $0.024/s**; footage above 60 fps is re-timed to 60 fps first. Source: fal.ai/models/VEED/video-background-removal/fast, checked 4 Oct 2026 |
| AI background picture | Seedream V4 on fal (existing image row) | $0.03 per image |
| Speech-to-text (word timings) | ElevenLabs Scribe `scribe_v1` (same ElevenLabs key) | priced at **$0.40/hour** (third-party guides list $0.22/h, June 2026) |
| Speech-to-text backup | Whisper on fal `fal-ai/whisper`, `chunk_level: word` | **$0.02/min placeholder** (fal bills per compute second; no fixed audio price on the page). Edit after checking usage |
| AI edit plan | Claude (existing text row) | $0.062 per call, one call per 2 minutes of footage |
| Our ffmpeg time | Railway CPU | $0.0005 per second (conservative) |
| Brand music | ElevenLabs Music direct (`music_v1`, existing row) | $0.15 per minute |
| Brand music alternative | ElevenLabs Music on fal `fal-ai/elevenlabs/music` (seeded **off**) | $0.60 per output minute, **rounded up** (15 s bills a minute) |
| Outside auto-edit | Submagic API, generic Custom API preset (seeded **off**) | $0.69 per video (Business + API plan $69/month for 100 videos, submagic.co/pricing, June 2026). Not a tested integration |

With no AI music row switched on (the default until a key is added) the guard assumes **$0.60 per started minute** for
Brand music, so the prices below are already safe for the pricier fal route.

### 14.2 Prices and worst-case margins

| Job | Credits | Our cost | Margin (no code) | Margin (30% code) |
|---|---|---|---|---|
| Change background, 10 s (minimum), colour/picture/stock | 30 (3/s) | $0.245 | 75.5% | 70.8% |
| Change background, 10 s, AI scene | 34 (+4) | $0.275 | 75.7% | 71.1% |
| Change background, 60 s | 180 | $1.47 | 75.5% | 70.8% |
| Change background, 120 s, AI scene | 364 | $2.97 | 75.5% | 70.8% |
| Brand music 15 / 30 / 60 s | 60 | $0.60 (fal worst case; $0.04–0.15 direct) | 70% | 64.2% |
| Brand music 120 s | 110 | $1.20 (fal worst case; $0.30 direct) | 67.2% | 61% |
| Auto-edit 10 s raw (minimum 30 credits) | 30 | $0.07 | 93% | 91.6% |
| Auto-edit 60 s raw | 120 (2/s of raw) | $0.11 | 97.2% | 96.7% |
| Auto-edit 300 s raw | 600 | $0.44 | 97.8% | 97.4% |
| Auto-edit 60 s + AI music | 240 | $0.41 ($0.86 with fal music on) | 94.8% | 93.9% (87.2%) |
| Auto-edit 60 s + your brand track | 120 | $0.11 | 97.2% | 96.7% |

- Change background is charged on the **real length of the upload** (read with ffprobe on the server), minimum 10 s.
- Auto-edit is charged on the **raw** upload length, 2 credits/s, minimum 30 credits per edit, plus the music add-on rules
  (library free, AI music +2/s, **your own brand track free**: it was paid for when it was made).
- Plan limits: Change background 30 / 60 / 120 / 120 s (Starter / Pro / Scale / Agency); Auto-edit 120 / 300 / 300 / 300 s;
  Brand music up to 60 s on Starter, 120 s above. Uploads: Change background ≤ 120 s and ≤ 200 MB, Auto-edit ≤ 5 min and
  ≤ 500 MB, MP4 / MOV / WebM; 2 GB per customer, deleted after 7 days (Admin → Profit guard → limits).
- With the fal music alternative on, short AI-music add-ons on any video type (10 s minimum) cost a full fal minute; the
  guard then raises those jobs by itself. Keep the direct ElevenLabs Music row as the default.
