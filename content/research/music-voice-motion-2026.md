# Research notes: music, stock footage, voice tiers, animated-ad scenes (as of 3 October 2026)

Raw notes behind section 12 of `content/pricing.md`. "Official" means read on the vendor's own page on 3 Oct 2026.

## 1. Music generation APIs

| API | Price | Licence for ads | Source |
|---|---|---|---|
| **ElevenLabs Music (direct API)** | **$0.15 per minute** (official API pricing page). Sound effects are $0.12/min. | Trained only on licensed music; output "cleared for commercial use", covering ad campaigns, branded video and client deliverables. Caveats: close imitation of a known song, or lyrics that resemble existing works, can still raise issues. | [ElevenLabs API pricing (official)](https://elevenlabs.io/pricing/api); licence: [MindStudio, 2 Jun 2026](https://www.mindstudio.ai/blog/elevenlabs-music-v2-commercial-content-licensed-ai-music); $0.15/min also listed by [CometAPI, Sep 2026](https://www.cometapi.com/ai-music-api-pricing/) |
| ElevenLabs Music on fal.ai | $0.80 per output minute, **rounded up**, 3s–10min | same model | [fal.ai text-to-music](https://fal.ai/explore/text-to-music-apis) |
| Google Lyria 2 on fal.ai | $0.10 per 30s (30s WAV) | Google terms; check before use | [fal.ai](https://fal.ai/explore/text-to-music-apis) |
| Google Lyria 2 / Lyria 3 Clip / Lyria 3 Pro (Google) | $0.06 / 30s; $0.04 / 30s clip; $0.08 per song (up to 3 min) | | [CometAPI, Sep 2026](https://www.cometapi.com/ai-music-api-pricing/) |
| MiniMax Music 2.0 / 2.5 / 2.6 on fal.ai | $0.03 / $0.15 / $0.15 per generation | not checked | [fal.ai](https://fal.ai/explore/text-to-music-apis) |
| Stable Audio 2.5 / 3.0 | $0.20 per generation (up to 3 min) / $0.26 (up to 6 min) | Stability licence; not checked | [CometAPI](https://www.cometapi.com/ai-music-api-pricing/) |
| ACE-Step, CassetteAI (fal.ai) | listed on fal; price not shown on the listing page | open-weights / not checked | [fal.ai](https://fal.ai/explore/text-to-music-apis) |
| Mureka API | $0.045 per song | not checked | [CometAPI](https://www.cometapi.com/ai-music-api-pricing/) |
| Mubert API | custom/contact sales; Creator $11.69, Pro $32.49, Business $149.29 (annual list figures); no free tier | Commercial use on Business+; **sublicensing needs an Agency licence**. A SaaS reselling tracks to customers is sublicensing, so this is a poor fit. | [CostBench](https://costbench.com/software/ai-music-apis/mubert-api/), [Sonilo, 11 Aug 2026](https://sonilo.com/blog/comparisons/ai-soundtrack-apis-ads-client-work-monetized-channels) |
| Beatoven.ai | $0–$20/month plans | commercial licence on paid plans; check ad and sublicensing terms | [CostBench](https://costbench.com/software/ai-music-apis/mubert-api/alternatives/), [Sonilo](https://sonilo.com/blog/comparisons/ai-soundtrack-apis-ads-client-work-monetized-channels) |
| Soundraw | subscription | commercial licence on paid plans; check Content ID | [Sonilo](https://sonilo.com/blog/comparisons/ai-soundtrack-apis-ads-client-work-monetized-channels) |
| Suno | no public per-call developer API price; creator subscriptions only | | [CometAPI](https://www.cometapi.com/ai-music-api-pricing/) |

**Choice:** ElevenLabs Music, direct. It has the cleanest licence for paid ads and one vendor for voice and music. At $0.0025/s it is effectively free next to video. Budget used: $0.0025/s plus $0.15 per track (assumes a possible 1-minute minimum), and a 10s billing minimum for the customer.

## 2. Stock footage

| API | Cost | Licence for ads | API rules | Source |
|---|---|---|---|---|
| Pexels | free | "All photos and videos on Pexels are free to use", attribution not required. Don't imply endorsement by people in the footage, don't sell unaltered copies, don't show identifiable people in a bad light. | 200 requests/hour, 20,000/month by default (more on request); credit Pexels and the photographer "when possible"; endpoint `GET https://api.pexels.com/v1/videos/search` | [Pexels licence](https://www.pexels.com/license/), [Pexels API docs](https://www.pexels.com/api/documentation/) |
| Pixabay | free | Free commercial use, no attribution. No standalone resale. **Content showing recognisable trademarks, logos or brands cannot be used commercially for goods and services.** No misleading use of identifiable people. | 100 requests per 60s; results must be cached 24h; images must be downloaded, not hotlinked (videos may be embedded but local storage is recommended); show the source where search results are displayed; no mass downloads | [Pixabay licence summary](https://pixabay.com/service/license-summary/), [Pixabay API docs](https://pixabay.com/api/docs/) |

## 3. TTS (voice tiers)

| Model | Price | Quality signal | Source |
|---|---|---|---|
| ElevenLabs Flash / Turbo (v2.5) | $0.04 / 1k chars | Artificial Analysis arena Elo 1078 (Flash v2.5) | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [Artificial Analysis TTS leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard) |
| ElevenLabs Multilingual v2 | $0.08 / 1k | Elo 1097 | same |
| ElevenLabs v3 | $0.08 / 1k (leaderboard lists $100/1M) | Elo 1174; "v3 Conversational" Elo 1203 | same |
| **ElevenLabs v4** | $0.08 / 1k list; **$0.022 promo (72% off) until 12 Oct** | **#1 overall, Elo 1321** | same |
| ElevenLabs v4 Turbo | $0.04 / 1k list; $0.011 promo until 12 Oct | not listed | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) |
| Gemini 3.8 Flash TTS (Google) | $16.5 per 1M chars equivalent; Google lists $0.50/1M input tokens + $9/1M audio tokens until 31 Dec 2026, doubling from 1 Jan 2027 | #4, Elo 1275 | [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing), [Artificial Analysis](https://artificialanalysis.ai/text-to-speech/leaderboard) |
| Google Chirp 3 HD | $30 / 1M chars (first 1M free) | Elo 1056 | [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing) |
| Azure Neural / Neural HD | about $15 / 1M (Neural, per leaderboard); $22 / 1M (HD, per Techsy) | Elo 1035 | [Artificial Analysis](https://artificialanalysis.ai/text-to-speech/leaderboard), [Techsy](https://techsy.io/en/blog/best-tts-apis-developers); Azure's own page showed no figures when fetched |
| OpenAI gpt-4o-mini-tts | about $0.015 per minute of audio | "cheapest quality option" (not on the AA top list) | [Techsy](https://techsy.io/en/blog/best-tts-apis-developers) |
| Cartesia Sonic 3.6 | $49 / 1M | #3, Elo 1278 | [Artificial Analysis](https://artificialanalysis.ai/text-to-speech/leaderboard) |
| Speechify Simba 3.2 | $6.6 / 1M | Elo 1242 | same |

Speech is about 15 characters per second, so $0.04/1k is about $0.0006/s and $0.10/1k is $0.0015/s.

Model IDs in ElevenLabs docs (fetched): `eleven_multilingual_v2`, `eleven_flash_v2_5` (32 languages), `eleven_turbo_v2_5`. v3/v4 IDs were not shown on the docs page fetched ([ElevenLabs models](https://elevenlabs.io/docs/models)); confirm in the dashboard.

Pronunciation ("Vooads" = "Voo-ads") is handled by our own whole-word text replacement before any TTS call (spec §12), so it does not depend on the provider supporting pronunciation dictionaries.

## 4. AI scene video for the "ultra" animated ad
| Model | Price | Source |
|---|---|---|
| Kling 2.5 Turbo Pro image-to-video (fal) | $0.35 per 5s, $0.07/s | [fal.ai](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video) |
| Kling 2.6 Pro | $0.07/s audio off | [fal.ai learn, 28 Jun 2026](https://fal.ai/learn/tools/best-image-to-video-apis-2026) |
| Kling v3 Pro | $0.112/s audio off | same |
| Veo 3.1 Fast | $0.10–0.15/s (fal), $0.12/s (Google, 1080p with audio) | same; [perkstack](https://perkstack.co/blog/cheapest-veo-3-1-fast-api) |
| Wan 2.5 720p | $0.10/s | [fal.ai](https://fal.ai/models/fal-ai/wan-25-preview/image-to-video) |

Scenes do not need model audio (we add the voiceover and music), so "audio off" prices apply. Budget: $0.07 video + $0.006 first-frame image + $0.0015 ultra voice + about $0.001 rendering, rounded to $0.08/s.

## 5. Gaps
- I could not confirm whether the direct ElevenLabs Music API has a per-request minimum. It is budgeted as if it charges a full minute.
- Licence terms for Lyria, MiniMax, Stable Audio, ACE-Step and CassetteAI were not reviewed in detail. Keep ElevenLabs as the default for ads.
- Azure's official pricing page did not render figures; Azure numbers are third-party.
