# VooSquare ⇄ Vooads support API

How VooSquare's shared support inbox works with Vooads tickets. Vooads sends **events** when tickets change, and VooSquare calls the **inbound API** to read tickets, reply, update them and give goodwill credits.

VooSquare owns its agents, roles and per-agent limits. Vooads trusts the `agent` identity VooSquare sends, writes every action to its activity log as `voosquare:<agent email>`, and enforces its own global caps.

## Setup

| Where | What |
|---|---|
| Vooads env `VOO_SERVICE_KEY` | Long random key. VooSquare sends it as `Authorization: Bearer <key>` on every inbound call. |
| Vooads env `VOO_WEBHOOK_SECRET` | Shared secret. Vooads signs every event with it. VooSquare verifies. |
| Vooads env `VOO_SUPPORT_EVENTS_URL` | Optional. Default `https://api.voosquare.com/v1/support/events`. |
| Vooads Admin → Support settings | `voosquare.enabled` (on/off), `voosquare.mode`, `voosquare.events_url` (overrides the env default), `voosquare.max_credit_grant`. |

### Modes (`voosquare.mode`)

| Mode | Vooads admin inbox | VooSquare |
|---|---|---|
| `both` | Read and reply | Gets events, can read and reply |
| `voosquare` | **Read-only.** Replies, ticket changes and credit grants from the Vooads admin return `409` with `"Replies happen in VooSquare…"` | Gets events, can read and reply |
| `vooads` | Read and reply | No events. Can read; replies/changes/credits return `409` |

When `voosquare.enabled` is off, Vooads sends no events and every inbound call returns `403`.

## Data shapes

```json
// ticket
{
  "id": 42, "subject": "Render failed", "status": "open", "priority": "normal", "category": "video", "channel": "web",
  "assignee_staff_id": null, "assignee_name": "Tola", "assignee_ext_id": "ag_1", "assignee_ext_name": "Tola",
  "voo_ticket_id": "VS-981", "phone": null, "call_time": null,
  "created_at": "2026-10-03T09:12:01.120Z", "updated_at": "2026-10-03T09:30:44.002Z",
  "first_response_at": "2026-10-03T09:30:44.002Z", "last_customer_at": "2026-10-03T09:12:01.120Z", "last_staff_at": "2026-10-03T09:30:44.002Z",
  "sla_due_at": "2026-10-03T21:12:01.120Z", "overdue": false, "user_id": 7
}
// customer
{ "id": 7, "email": "tunde@example.com", "name": "Tunde", "plan": "pro", "voo_id": "voo_8f2…", "country": "NG", "status": "active" }
// message
{ "id": 311, "ticket_id": 42, "author_type": "customer", "author_name": "Tunde", "author_id": "7",
  "body": "My render failed…", "internal": false, "attachments": [], "created_at": "2026-10-03T09:12:01.120Z" }
```

- `status`: `open` (waiting for support) · `pending` (waiting for the customer) · `solved` · `closed`
- `priority`: `low | normal | high | urgent` · `category`: `billing | video | account | bug | call | other` (`call` = callback request, with `phone` and `call_time`)
- `author_type`: `customer | staff | voosquare | system | bot` (`bot` = the instant auto-reply with help articles in `attachments`)
- `internal: true` messages are notes the customer never sees.
- All times are ISO 8601 UTC. `sla_due_at` = when the next reply is due (from Support settings `sla_hours`); `overdue` = open and past it.

## 1. Events (Vooads → VooSquare)

`POST <events_url>` with JSON body and headers:

```
Content-Type: application/json
X-Voo-Tool: vooads
X-Voo-Signature: sha256=<hex HMAC-SHA256 of the raw body, key = VOO_WEBHOOK_SECRET>
```

Body:

```json
{
  "event_id": "va_sup_Q2x9aZ1kLm",
  "occurred_at": "2026-10-03T09:12:01.300Z",
  "tool": "vooads",
  "type": "ticket.created",
  "ticket": { "...": "ticket shape" },
  "customer": { "...": "customer shape" },
  "message": { "...": "message shape (ticket.created and ticket.message only)" }
}
```

| Type | When | `message` |
|---|---|---|
| `ticket.created` | Customer opens a ticket | The customer's first message |
| `ticket.message` | Customer writes, a Vooads staff member replies or adds an internal note (`message.internal`), or credits are granted (system message) | The new message |
| `ticket.updated` | Status, priority, category or assignee changed, or a solved/closed ticket is reopened by the customer | none |

Rules:
- Answer `2xx` quickly. Vooads tries once, then retries 3 times (after 2 s, 6 s, 18 s) on network errors, `5xx`, `408` and `429`. Other `4xx` answers are not retried.
- Use `event_id` to ignore duplicates.
- Actions VooSquare itself made through the inbound API are **not** echoed back as events.
- Optional: answer `{"voo_ticket_id": "VS-981"}` to `ticket.created` and Vooads stores it on the ticket (shown back as `ticket.voo_ticket_id`).

### Verifying the signature (Node.js)

```js
const crypto = require('node:crypto');

// rawBody: the exact bytes received (Buffer), before JSON.parse
function isFromVooads(rawBody, header, secret = process.env.VOO_WEBHOOK_SECRET) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(header || '')), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express example
app.post('/v1/support/events', express.raw({ type: 'application/json' }), (req, res) => {
  if (!isFromVooads(req.body, req.get('X-Voo-Signature'))) return res.status(401).json({ error: 'bad signature' });
  const ev = JSON.parse(req.body.toString('utf8'));
  // upsert ticket by (tool, ev.ticket.id); dedupe on ev.event_id
  res.json({ ok: true, voo_ticket_id: 'VS-981' });
});
```

## 2. Inbound API (VooSquare → Vooads)

Base: `https://vooads.com` · Header on every call: `Authorization: Bearer <VOO_SERVICE_KEY>`

Errors are JSON `{"error": "message"}`: `401` wrong/missing key · `403` VooSquare support switched off, or credit cap exceeded · `404` unknown ticket · `400` bad input · `409` mode does not allow VooSquare writes.

Every write needs `agent.email`; it is logged as `voosquare:<email>`.

### List tickets

`GET /api/voosquare/support/tickets?status=open,pending&updated_since=2026-10-01T00:00:00Z&limit=100&offset=0`

Oldest update first, so you can poll with `updated_since` = the last `updated_at` you stored.

```json
{
  "tickets": [ { "id": 42, "subject": "Render failed", "status": "open", "...": "...", "customer": { "id": 7, "email": "tunde@example.com", "...": "..." } } ],
  "has_more": false,
  "next_offset": null
}
```

### One ticket with all messages (internal notes included)

`GET /api/voosquare/support/tickets/42`

```json
{ "ticket": { "...": "..." }, "customer": { "...": "..." }, "messages": [ { "id": 311, "author_type": "customer", "body": "…", "internal": false, "...": "..." } ] }
```

### Reply or add an internal note

`POST /api/voosquare/support/tickets/42/reply`

```json
{ "body": "Hi Tunde, your credits are back.", "internal": false, "status": "pending",
  "agent": { "id": "ag_1", "name": "Tola", "email": "tola@voosquare.com", "role": "agent" } }
```

- Public reply: the customer sees it in the app (author `Tola`, type `voosquare`) and gets the `ticket_reply` email. Status becomes `status` if sent, else `pending`.
- `internal: true`: note only staff and VooSquare see; no email.

Response: `{ "ticket": {…}, "message": {…} }`

### Update a ticket

`PUT /api/voosquare/support/tickets/42`

```json
{ "status": "solved", "priority": "high", "category": "billing", "voo_ticket_id": "VS-981",
  "assignee": { "id": "ag_1", "name": "Tola" },
  "agent": { "email": "tola@voosquare.com" } }
```

All fields optional. `"assignee": null` clears the VooSquare assignee. Assigning a VooSquare agent clears any Vooads staff assignee. Response: `{ "ticket": {…} }`

### Give goodwill credits

`POST /api/voosquare/support/tickets/42/credits`

```json
{ "amount": 50, "reason": "Render failed twice", "agent": { "id": "ag_1", "name": "Tola", "email": "tola@voosquare.com" } }
```

Adds top-up credits (never expire). `amount` must be above 0 and at most `voosquare.max_credit_grant` (Support settings; default 500), otherwise `403`. The customer sees a system message "50 credits were added to your wallet."; the reason is stored as an internal note and in the activity log.

Response: `{ "ok": true, "applied": 50, "balance": { "trial": 0, "plan": 3200, "topup": 50, "total": 3250, "planActive": true } }`

### Dashboard numbers

`GET /api/voosquare/support/stats`

```json
{
  "tool": "vooads", "mode": "both",
  "counts": { "open": 4, "pending": 9, "solved": 120, "closed": 33, "mine": 0, "unassigned": 2, "overdue": 1, "calls": 1 },
  "created_24h": 6, "solved_7d": 41, "avg_first_response_minutes_30d": 47,
  "sla_hours": { "urgent": 1, "high": 4, "normal": 12, "low": 24 },
  "open_url": "https://vooads.com/admin#/tickets"
}
```

## curl examples

```bash
KEY=your-voo-service-key
curl -s https://vooads.com/api/voosquare/support/tickets?status=open -H "Authorization: Bearer $KEY"

curl -s -X POST https://vooads.com/api/voosquare/support/tickets/42/reply \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"body":"Hi! Looking into it now.","agent":{"id":"ag_1","name":"Tola","email":"tola@voosquare.com"}}'
```
