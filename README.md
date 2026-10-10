# Nicked backend (HackUCD 2026)

Express + MongoDB API for the shop CCTV review tool.

```
upload video ─► YOLO detector (teammate's Python service, or mock)
            ─► candidates: shelf → no till → exit
            ─► per candidate: ffmpeg samples ≤16 frames ─► OpenRouter vision check (yes / no / unclear)
            ─► review queue (AI "no" hidden but kept) ─► owner checklist ─► confirm / dismiss / unsure
            ─► incident report (facts from DB, wording by OpenRouter text model) ─► owner decides whether to share
Stripe sandbox subscription unlocks uploads and reports.
```

The AI never contacts anyone. The owner always decides.

## Setup (Mac)

```bash
brew install ffmpeg
brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community
brew install stripe/stripe-cli/stripe

npm install
cp .env.example .env        # then fill in the keys
cp zones.example.json zones.json   # only needed once the real detector is running
npm run dev                 # http://localhost:4000/api/health
```

Prefer Atlas? Put the `mongodb+srv://...` URI in `MONGODB_URI` and skip the Mongo brew steps.

### OpenRouter

1. Make a key at openrouter.ai/keys and set `OPENROUTER_API_KEY`.
2. `npm run models:list` shows vision models, cheapest first. Put one in `DETECT_MODEL`.

### Stripe (sandbox only — live keys are refused)

```bash
# 1. Put your sk_test_ key in .env, then create the €29/month product + price:
npm run stripe:seed

# 2. In a second terminal, forward webhooks and copy the whsec_ value into .env:
stripe login
stripe listen --forward-to localhost:4000/api/billing/webhook

# 3. Restart the server. Pay with card 4242 4242 4242 4242, any future date, any CVC.
```

The shop is activated two ways, both idempotent: the webhook (`checkout.session.completed`, `invoice.paid`) and the success page calling `GET /api/billing/verify?session_id=...`.

### Working before the YOLO service is ready

Leave `DETECTOR_URL` empty. Each upload gets one fake candidate, or uses `mock-detections/<video name>.json` if you drop the teammate's `events.json` there. Set `DEV_BYPASS_PAYWALL=true` to skip Stripe while building the UI (turn it off for the demo).

When the Python service is up: set `DETECTOR_URL=http://localhost:8000` and add `zones.json`. The contract is in [docs/DETECTOR_CONTRACT.md](docs/DETECTOR_CONTRACT.md).

## API

All responses are JSON. Errors look like `{ "error": "readable message", "code": "MACHINE_CODE" }`.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Server, DB, detector mode, key status |
| GET | `/api/shop` | Demo shop: subscription status, payments |
| PATCH | `/api/shop` | `{ name?, email?, layoutNotes? }` (layout notes go into the AI prompt) |
| GET | `/api/billing/plan` | Price, currency, interval, features (for the pricing page) |
| POST | `/api/billing/checkout` | → `{ url }` of Stripe Checkout. Redirect the browser there |
| GET | `/api/billing/verify?session_id=` | Success page confirms payment and unlocks the shop |
| POST | `/api/billing/webhook` | Stripe only |
| POST | `/api/clips` | 🔒 multipart `clip` (+ optional `zones` JSON, `model`). → 202, processing starts |
| GET | `/api/clips` | All clips |
| GET | `/api/clips/:id` | Clip + progress (`stage`, `progress.checked/total`) + its events. Poll this |
| POST | `/api/clips/:id/reprocess` | 🔒 `{ model? }` re-run, e.g. with another model |
| GET | `/api/clips/:id/video` | Stream for `<video src>` (seekable) |
| DELETE | `/api/clips/:id` | Delete footage, events and reports |
| GET | `/api/events?view=queue` | Review queue (AI yes/unclear/error, pending), best first. Also `ai_ruled_out`, `reviewed`, `all`; `&clip=<id>` |
| GET | `/api/events/:id` | One event (+ its incident, if any) |
| POST | `/api/events/:id/review` | `{ decision: confirmed\|dismissed\|unsure, checklist: { pickedUpItem, concealedItem, avoidedTill, leftShop }, note? }` |
| POST | `/api/events/:id/incident` | 🔒 Generate the report for a confirmed event (`?regenerate=true` to redo) |
| GET | `/api/incidents` / `/:id` | Reports |
| GET | `/api/incidents/:id/report.md` | Download report |
| GET | `/api/incidents/:id/clip` | Download the flagged window ±3 s as MP4 |
| PATCH | `/api/incidents/:id` | `{ sharedWithGardai: true }` (owner records it; the app never sends) |
| GET | `/api/stats` | Numbers for the "Stay curious" slide |

🔒 = needs an active subscription (402 `SUBSCRIPTION_REQUIRED` otherwise).

### Event shape (what the review queue shows)

```json
{
  "id": "…", "startTime": "00:39.0", "endTime": "01:12.0",
  "candidate": { "trackId": 4, "shelfSeconds": 6.4, "visitedTill": false, "rule": "shelf -> no till -> exit" },
  "ai": { "verdict": "yes", "confidence": 0.82, "reason": "Places item in jacket pocket at 00:45.5.",
          "framesReferenced": ["00:45.5"], "notes": "", "model": "…", "framesSent": 16 },
  "eventType": "possible_concealment", "inQueue": true, "flags": [],
  "status": "pending", "checklist": { "pickedUpItem": null, "concealedItem": null, "avoidedTill": null, "leftShop": null }
}
```

## Demo flow from the terminal

```bash
curl -s localhost:4000/api/billing/plan
curl -s -X POST localhost:4000/api/billing/checkout          # open the url, pay with 4242…
curl -s localhost:4000/api/shop                              # subscriptionStatus: "active"
curl -s -F 'clip=@clips/test_01.mp4' localhost:4000/api/clips
curl -s localhost:4000/api/clips/<clipId>                     # until status is "done"
curl -s 'localhost:4000/api/events?view=queue'
curl -s -X POST localhost:4000/api/events/<eventId>/review -H 'Content-Type: application/json' \
  -d '{"decision":"confirmed","checklist":{"pickedUpItem":true,"concealedItem":true,"avoidedTill":true,"leftShop":true}}'
curl -s -X POST localhost:4000/api/events/<eventId>/incident
curl -s localhost:4000/api/stats
```

## Testing

`npm test` runs 35 tests with no database or network: real ffmpeg on generated video, a local mock of OpenRouter, stubbed Mongo models, and signed Stripe webhooks.

| Type | Case | Result |
|---|---|---|
| Ordinary | Model says "yes" and cites a real frame | Queued as possible concealment |
| Ordinary | Model says "no" | Kept, hidden from queue, counted as a false alarm removed |
| Boundary | Model says "yes" but cites no frame it was sent | Downgraded to "unclear" with a flag |
| Boundary | Model invents timestamps | Ignored and flagged |
| Boundary | Detector times run past the video end | Clamped |
| Boundary | 33 s candidate | Sent as 16 frames, not 66 |
| Failure | Malformed JSON | One corrective retry |
| Failure | Malformed twice / timeout / bad key | Verdict "error", still queued for manual review; bad key stops further calls |
| Failure | Corrupt video, wrong file type, too big, bad zones | 422 / 415 / 413 / 400 with a readable message |
| Failure | Detector service down | 503 "Is the Python service running?" |
| Failure | Very dark footage / under 480p | Warning on the clip |
| Safety | Loaded words ("theft", "suspect"…) in AI output | Flagged; reports are rewritten once, then flagged for editing |
| Payments | Duplicate Stripe webhook | Processed once, payment recorded once |

## Experiments for the pitch

- `GET /api/stats`: tracker candidates vs how many the AI ruled out (`ai.falseAlarmsRemoved`), owner agreement with the AI, average processing time, total AI cost.
- `npm run models:compare -- clips/test_01.mp4 mock-detections/test_01.json modelA,modelB expected.json` runs the same candidates through several models and writes `model-comparison.csv`. `expected.json` is your own labels: `{ "4": "yes", "9": "no" }`.

## Layout

```
src/
  app.js, index.js, config.js, db.js
  models/      Shop, Clip, Event, Incident, StripeEvent
  routes/      shop, billing, clips, events, incidents, stats
  services/    ffmpeg, detector, verify (vision check), report, openrouter, stripe, aiJson, language
  jobs/        processClip (background pipeline)
scripts/       seed-stripe, list-vision-models, compare-models
docs/          DETECTOR_CONTRACT.md
```
