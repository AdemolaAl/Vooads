# Research notes: video types, provider costs and competitors (as of 3 October 2026)

Raw notes behind `content/pricing.json` and `content/pricing.md`. Prices were read from the provider page (fal.ai, ElevenLabs, Anthropic, Captions) on 3 Oct 2026 where marked "official". Others come from third-party trackers or reviews, with their date. Prices change often: re-check every quarter and before switching a default model.

## 1. Provider costs (what Vooads pays)

### Talking avatar / UGC presenter (lip-synced person from a photo + audio)
| Model | Price | Source | Notes |
|---|---|---|---|
| Kling AI Avatar v2 Pro (fal.ai) | $0.115 / s | official, [fal.ai](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro) | **Default.** Billed per output second. |
| Kling AI Avatar v2 Standard (fal.ai) | $0.0562 / s | [fal.ai](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard) (checked in earlier report, same day) | Backup. |
| Creatify Aurora (fal.ai) | $0.07 / s 480p, $0.14 / s 720p, seconds rounded up | [fal.ai](https://fal.ai/models/fal-ai/creatify/aurora) | |
| VEED Fabric 1.0 (fal.ai) | $0.08 / s 480p, $0.15 / s 720p | [fal.ai](https://fal.ai/models/fal-ai/veed/fabric) | |
| ByteDance OmniHuman v1.5 (fal.ai) | $0.16 / s | [fal.ai](https://fal.ai/models/fal-ai/bytedance/omnihuman/v1.5/llms.txt) | Premium option. Would need 20 credits/s. |
| Captions Mirage Avatar X (API) | $0.15 / s, billed in 6 s steps | official, [captions.ai API pricing](https://www.captions.ai/help/docs/api/pricing) | Captions burn-in API $0.15/min. |
| HeyGen API Avatar IV photo avatar | $0.05 / s ($3/min); Avatar V $0.0667/s; Avatar III $0.0167/s; video translation $0.033–0.067/s | [G2, HeyGen API pricing](https://www.g2.com/articles/heygen-api-pricing) | Cheaper than Kling Pro per second. Worth a quality test as a backup UGC provider (needs a new adapter). |
| Hedra Character-3 | 6 credits/s; Ultra plan $100 = 18,000 credits, so about $0.033/s | [usagepricing.com, Hedra](https://usagepricing.com/blueprint/hedra) | Subscription credits, not a clean pay-as-you-go API. |

### Lip-sync onto existing footage / dubbing
| Model | Price | Source |
|---|---|---|
| sync lipsync 2.0 (fal.ai) | $3.00 / min = $0.05 / s | official, [fal.ai](https://fal.ai/models/fal-ai/sync-lipsync/v2) |
| ElevenLabs Dubbing v1 | $0.33 / min | official, [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) |
| ElevenLabs Dubbing v2 | $2.20 / min = $0.0367 / s | official, same page |
| HeyGen API video translation | $0.033–0.067 / s | [G2](https://www.g2.com/articles/heygen-api-pricing) |

Dub budget used: ElevenLabs Dubbing v2 ($0.0367/s) + sync lipsync 2.0 ($0.05/s) = $0.0867/s, rounded up to **$0.09/s**, plus $0.01 per job for transcript/translation with Claude.

### Text/image to video (b-roll, photo-to-video)
| Model | Price | Source |
|---|---|---|
| Kling 2.5 Turbo Pro (fal.ai) | $0.35 for 5 s, then $0.07 per extra second | official, [fal.ai i2v](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video) |
| Wan 2.5 (fal.ai) | $0.05 / s 480p, $0.10 / s 720p, $0.15 / s 1080p | official, [fal.ai](https://fal.ai/models/fal-ai/wan-25-preview/image-to-video) |
| Kling 2.6 Pro | $0.07 / s audio off, $0.14 / s audio on | [fal.ai learn, 28 Jun 2026](https://fal.ai/learn/tools/best-image-to-video-apis-2026) |
| Kling v3 Pro / O3 Pro | $0.112 / s audio off, $0.14–0.168 / s audio on | same |
| Seedance 1.0 Pro | about $0.62 per 5 s 1080p clip on fal ($0.124/s); Replicate about $0.74 | [perkstack tracker, 20 Jul 2026](https://perkstack.co/blog/cheapest-seedance-1-0-pro-api) |
| Seedance 2.0 | $0.30 / s 720p, $0.68 / s 1080p | [fal.ai learn](https://fal.ai/learn/tools/best-image-to-video-apis-2026) |
| Veo 3.1 Fast | $0.12 / s (Google, 1080p with audio), $0.15 / s on fal | [perkstack tracker, verified 5 Aug 2026](https://perkstack.co/blog/cheapest-veo-3-1-fast-api) |
| Veo 3.1 | $0.20–0.40 / s | [fal.ai learn](https://fal.ai/learn/tools/best-image-to-video-apis-2026) |
| Grok Imagine Video | $0.05 / s 480p, $0.07 / s 720p | same |
| Sora 2 Pro | $0.30–0.70 / s | same |

Kling 2.5 Turbo only renders 5 s or 10 s clips. A 23 s request costs 25 s. That is why b-roll and photo-to-video are sold in **5-second steps**.

Credits per second needed to keep 60% at the worst-case price of $0.0233 per credit: `ceil(cost / 0.00932)`. Kling 2.5/2.6 $0.07 → 8 (we charge 10). Wan 720p $0.10 → 11. Kling v3 $0.112 → 13. Veo 3.1 Fast $0.15 → 17. Seedance 2.0 720p $0.30 → 33. These premium models are **not** enabled as video types; if the admin picks one as the default video provider, the loss guard raises credits automatically.

### Images
| Model | Price | Source |
|---|---|---|
| Seedream V4 (fal.ai) | $0.03 / image | official, [fal.ai](https://fal.ai/models/fal-ai/bytedance/seedream/v4/text-to-image) |

### Voice (TTS)
| Model | Price per 1,000 characters | Source |
|---|---|---|
| ElevenLabs Flash / Turbo | $0.04 | official, [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) |
| ElevenLabs Multilingual v2 / v3 | $0.08 | official, same |
| HeyGen Starfish TTS | about $0.04 / min | [G2](https://www.g2.com/articles/heygen-api-pricing) |

Speech runs about 15 characters per second. Budget used: $0.10 / 1k chars (above official) = **$0.0015 per spoken second**.

### Claude (scripts, hooks, translation)
| Model | Input / output per million tokens | Source |
|---|---|---|
| Claude Sonnet 5.5 | $2 / $10 | official, [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5 | $1 / $5 | official, same |
| Claude Opus 5.5 | $4 / $20 | official, same |

Full UGC script on Sonnet (about 6k in, 5k out) = $0.062. Hook pack of 20 = about $0.021. 10 angles = about $0.019. Translation of a 60 s transcript (about 1k in, 1k out) = under $0.02.

## 2. Ad formats that perform for media buyers (2025–2026)

- **UGC / creator-style talking video still leads.** "Creator-style, first-person video keeps beating polished brand film" ([Segwise, TikTok creative types 2026, updated 24 Sep 2026](https://segwise.ai/blog/latest-tiktok-ad-creative-types-2026)). UGC ads "reduce CPA by roughly 23% on average and outperform polished brand creative on CTR by up to 48%" (Hustler Marketing 2026, quoted by [Segwise Meta playbook](https://segwise.ai/blog/meta-creative-strategy-ecommerce-2026)). Recommended length on Meta: 15–60 s, 9:16 Reels/Stories, 4:5 Feed.
- **Hooks decide the winner, and fatigue is fast.** Hook rate 25% is table stakes, 30% good, 40%+ elite (Sovran 2025, via Segwise). Winning TikTok creative lasts 7–10 days; teams at spend ship 3–5 new concepts a week ([Segwise](https://segwise.ai/blog/latest-tiktok-ad-creative-types-2026)). Brands test 3–5 variations per ad, and micro-variants (caption, CTA, framing) give 10–15% CTR/CVR lifts ([Billo, 2026](https://billo.app/blog/meta-ads-best-practices)). This supports **Hook remix** as a paid type.
- **Photo/carousel and slideshow-style video are a real performance slot**, especially DTC ([Segwise](https://segwise.ai/blog/latest-tiktok-ad-creative-types-2026)). "Poster videos (a mix of still frames and short clips) lift watch times by about 18% in beauty and fashion" ([Billo](https://billo.app/blog/meta-ads-best-practices)). Meta's own image-to-video tools are used by 4M+ advertisers monthly; AI video ads perform within 5–15% of produced video for direct response ([1ClickReport, 2026](https://www.1clickreport.com/blog/meta-image-to-video-ads-2026-guide)). Supports **Slideshow** and **Photo to video**.
- **Localized / dubbed versions.** AI dubbing "translates and re-dubs a finished video into 15 or more languages while keeping the original speaker's tone" is listed as a working 2026 type ([Segwise](https://segwise.ai/blog/latest-tiktok-ad-creative-types-2026)). Important for Zedapex-style multi-geo buyers (NG, KE, ZA, GH, CM, LatAm). Supports **Dub**.
- **Format hit rates on Meta** (Motion, 578,750 creatives, $1.29B spend, Sep 2025–Jan 2026, [Motion format library](https://motionapp.com/library/formats/)): unboxing 9.8%, offer-first banner 8.6%, demo 8.1%, testimonial 6.5%. Also lists greenscreen, spokesperson, reaction, skit, screen recording. Supports **Product b-roll** (unboxing/demo styles) and **Green-screen reaction**.
- **Podcast-clip style** is a common creator format (a host at a mic with big captions). No hard numbers found; included because it reuses the UGC pipeline at no extra cost to us.
- **Split-screen** layouts: up to 12% better recall in apps/consumer goods ([Billo](https://billo.app/blog/meta-ads-best-practices)). Possible later as a free remix layout, not a separate paid type.

## 3. Competitor prices (2026)

| Tool | Plans | Per-video cost | Source |
|---|---|---|---|
| Arcads | Starter $110 / 10 videos, Creator $220 / 20, Pro custom | about $11 per video; edits need a full re-render | [eesel.ai, 2026](https://www.eesel.ai/en/blog/arcads-ai-pricing), [Creatify on Arcads](https://creatify.ai/blog/arcads-pricing-(2026)-plans-credits-and-what-you-ll-actually-pay) |
| MakeUGC | $49 / 5, $69 / 10, $119 / 20 videos | $5.95–$9.80; raw clips, no editing | [Superscale](https://superscale.ai/alternatives/makeugc/pricing) |
| Creatify | Starter $39 / 100 credits, Pro $99 / 200 credits; 2–20 credits per ad | about $7.80 per quality video; credits expire every 2 months | [Superscale](https://superscale.ai/alternatives/creatify/pricing) |
| HeyGen | Creator $29 / 600 credits, Pro from $49, Business $149 + $20/seat; Avatar IV/V = 20 credits/min | general avatar tool | [Creatify on HeyGen](https://creatify.ai/blog/heygen-pricing-(2026)-plans-and-what-you-ll-actually-pay), [Arcade](https://www.arcade.software/post/heygen-pricing) |
| Higgsfield | Starter about $19 / 270 credits, Plus $59 / 1,200, Ultra $129 / 3,000 (annual $47 / $99) | Kling 3.0 720p 5 s = 7–10 credits; Seedance 2.0 720p 5 s = 22–23 | [Creatify on Higgsfield](https://creatify.ai/blog/higgsfield-pricing-(2026)-plans-and-what-you-ll-actually-pay) |
| Captions / Mirage | API $0.15/s for Avatar X | | [captions.ai](https://www.captions.ai/help/docs/api/pricing) |
| Hedra | Basic $20 / 2,000, Pro $50 / 7,200, Ultra $100 / 18,000 credits; Character-3 = 6 credits/s | | [usagepricing.com](https://usagepricing.com/blueprint/hedra) |
| Human UGC creators | $150–$300 per video (median about $175) | | [Influee 2026](https://www.influee.co/gb/blog/ugc-price) |

Vooads 15 s UGC = 225 credits = $9.58 on Pro monthly, $5.24 at the very cheapest possible price (Agency yearly with a 30% code). That sits in the MakeUGC–Arcads band and includes voice, captions and presenter.

## 4. Gaps and uncertainties
- Kling AI Avatar v2 maximum input audio length per request is not stated on the fal page. Segments of 10 s are used to be safe; if longer audio is accepted, raise `segment_seconds` (fewer stitches, same price).
- fal.ai generally bills successful outputs only; a failed request is not charged. Verify on the fal billing page in the dashboard.
- Kling 2.6 / v3 / Veo / Seedance numbers come from fal's own blog and third-party trackers, not each model page.
- No hard data found on podcast-clip format performance.
