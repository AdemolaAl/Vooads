# VooSquare in Vooads (Voo Connect)

VooSquare is the one account (Voo ID) for every Zedapex tool. Vooads connects to it with VooSquare's **Voo Connect kit**,
copied unchanged into `voo-connect/` (version in `voo-connect/package.json`), exactly like Replyvoo, Castvoo, Joinvoo and
Spyvoo. Never edit the kit: when VooSquare publishes a new version, copy `sdk/voo-connect/` over it.

**Vooads keeps its own login.** The email-code login (and the staff admin login) keep working; "Continue with VooSquare"
is added next to them.

| Part | Code |
|---|---|
| Kit instance, settings (Admin → Integrations or env), event outbox in our database, linking rules, events, summary | `server/voo.js` |
| Routes: login, callback, connect, logout, launcher, browser snippet, summary | `server/routes/api.js` |
| Connection wizard (connection code), support inbox, agent roles | `server/vooconnect.js`, `server/support.js`, `routes/support.js` (`docs/VOOSQUARE-SUPPORT-API.md`) |
| Checks against a fake VooSquare | `server/selfcheck-voo.js` (`CHECK_ONLY=voo npm run check`) |

## 1. Switching it on

VooSquare → Admin → Products → **Vooads**: URL `https://vooads.com`, Launch path `/app`, SSO on, Redirect URIs
`https://vooads.com/auth/voosquare/callback` and `https://vooads.com/`, Summary URL `https://vooads.com/api/voosquare/summary`.
Save, open **Credentials**, copy Client ID, Client secret and API key. Vooads' own values only; never reuse another tool's.

Then **Admin → Integrations → VooSquare** (saved encrypted, never shown again, no restart needed), or variables:

```
VOO_BASE=https://voosquare.com
VOO_CLIENT_ID=vsc_…
VOO_CLIENT_SECRET=vss_…
VOO_API_KEY=vsk_…
VOO_SIGNAL_SECRET=<openssl rand -hex 32, make once, never change>
# optional
VOO_SERVER_BASE=<private address for server-to-server calls>
VOO_REDIRECT_URI=<only if it is not APP_URL/auth/voosquare/callback>
VOO_CONNECT=off        # switch every VooSquare feature off
```

Login turns on with address + client ID + secret. Payment events, the summary card and "You already have a Voo account"
need the API key. **Test** in Admin → Integrations exchanges a made-up login code (VooSquare must answer `invalid_grant`)
and reads an unknown Voo ID with the API key (must answer 404). From a shell: `node voo-connect/check.js --base … --client-id …
--client-secret … --api-key … --redirect-uri https://vooads.com/auth/voosquare/callback --logout-uri https://vooads.com/
--summary-url https://vooads.com/api/voosquare/summary` (no FAIL line).

## 2. Login and linking

| Route | What it does |
|---|---|
| `GET /auth/voosquare?return_to=/app&signup=1` | Start (signed state cookie, affiliate click replayed). VooSquare's launcher opens `/auth/voosquare?return_to=/app`; `/dashboard` lands on `/app`. |
| `POST /api/auth/voosquare/link` | Settings → **Connect VooSquare** for the account logged in now (10-minute cookie bound to this session). |
| `GET /auth/voosquare/callback` | State, code exchange, id_token check (HS256, audience, issuer, expiry), linking, our own session. |
| `GET /auth/voosquare/logout` | Ends our session; Voo ID accounts then go through VooSquare's `/oauth/logout` back to `/`. A cross-site GET only shows a "Log out?" button. |

Linking (`voo.linkOrCreate`):
1. Found by `users.voo_id` first, always.
2. **Connect VooSquare** started by this same session: the Voo ID is saved on that account (a Voo ID used elsewhere, or an account with another Voo ID, is refused).
3. Same email, **verified on both sides** (VooSquare's `email_verified`, and Vooads' `users.email_verified`, set by every email-code login), no Voo ID yet, not a staff email: linked.
4. Same email but not verified on one side, a staff email, or already linked elsewhere: refused with a clear message. Never a second account with the same email.
5. Otherwise a new account (free trial rules apply), with `country` from VooSquare.

**"You already have a Voo account. Log in with VooSquare."** When a new email finishes the email-code sign-up (so the
person proved the inbox), Vooads asks VooSquare's `POST /api/v1/users/lookup`. If that email has a Voo ID, no account is
made and the sign-up screen offers "Log in with VooSquare".

## 3. Events and summary

- Plan payment: `spend` (`va_pay_<payment id>`, amount paid) and `plan_started` (`va_plan_<id>`) or `plan_renewed` (`va_renew_<id>`). Top-up: `wallet_topup` (`va_topup_<id>`). Auto-renew switched off: `plan_cancelled`. Ad made: one activity event per type per hour.
- Queued in the `voo_queue` table, sent every 5 seconds; refused events are kept in `voo_failed` and listed in Admin → Integrations.
- `GET /api/voosquare/summary?voo_id=&period=1d|7d|30d` with `Authorization: Bearer <VOO_API_KEY>` (or the older inbound service key): ads made, languages, credits left.

## 4. Support and launcher

- Support tickets reach the VooSquare inbox and VooSquare agents answer them through the support API (`docs/VOOSQUARE-SUPPORT-API.md`, Admin → Integrations → Connect VooSquare).
- The studio's left rail ends with "Part of VooSquare"; the Zedapex apps page is the app switcher.
