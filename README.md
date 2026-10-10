# nicked

We flag. You decide.

Nicked watches the CCTV a shop already has and flags possible concealment. Every flag goes to the owner first, and nothing goes to the Gardaí until they confirm.

| Folder | What it is | Where it runs |
|---|---|---|
| [frontend/](frontend/) | React + Vite app: landing page with Stripe checkout, review queue, incident reports | Vercel |
| [backend/](backend/README.md) | Express + MongoDB API: uploads, OpenRouter vision checks, reports, Stripe sandbox | Vercel function (`api/index.js`), plus the worker for video |
| [detector/](detector/README.md) | Python YOLO service (Ultralytics + Supervision + OpenCV) | Worker container (`Dockerfile`) |

## Run it locally

```bash
# 1. detector
cd detector && uvicorn server:app --port 8000
# 2. backend (DETECTOR_URL=http://localhost:8000 in backend/.env)
cd backend && npm run dev
# 3. frontend, talking to the backend through Vite's proxy
cd frontend && VITE_LIVE=true npm run dev
```

Without `VITE_LIVE` or `VITE_API_URL`, the frontend runs as a clickable preview on sample data, with no backend needed.

## Deploy

### 1. Vercel: site + API (one project)

1. **Add New → Project**, import `cormackildea/Nicked`, and **leave Root Directory empty** (the repo root). The root `vercel.json` builds `frontend/` as the site and runs the Express API in `api/index.js` as a function on the same domain.
   - Don't set Root Directory to `backend`. Vercel would then run `backend/src/index.js` as the function, which is what caused `500 FUNCTION_INVOCATION_FAILED`.
2. **Settings → Environment Variables:**
   - `MONGODB_URI`: from a free MongoDB Atlas cluster. Under Atlas Network Access, allow `0.0.0.0/0`, because Vercel's IP addresses change.
   - `STRIPE_SECRET_KEY`: your `sk_test_` key. Live keys are refused.
   - `STRIPE_WEBHOOK_SECRET`: see step 3.
   - `OPENROUTER_API_KEY`: for incident reports.
3. **Stripe (test mode) → Webhooks → Add endpoint** at `https://<your-app>.vercel.app/api/billing/webhook`. Select `checkout.session.completed`, `invoice.paid` and `invoice.payment_failed`, plus `customer.subscription.created`, `.updated` and `.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Create the Stripe products once from your machine: `cd backend && STRIPE_SECRET_KEY=sk_test_… npm run stripe:seed`.
5. Redeploy. Check `https://<your-app>.vercel.app/api/health`. It should say `"dbConfigured": true`.

At this point the landing page **Subscribe** button opens Stripe Checkout (test card `4242 4242 4242 4242`). The payment unlocks the shop, and the dashboard, queue and reports work.

### 2. Worker: video upload + YOLO analysis

Vercel can't take video uploads (4.5 MB request limit) or run YOLO and ffmpeg, so footage goes to a worker. That's the root `Dockerfile`: the same API plus the detector, on a disk.

1. Deploy it on Render with `render.yaml` (needs at least 2 GB of RAM), or on Railway or Fly. Use the **same** `MONGODB_URI`, and set `CLIENT_URL=https://<your-app>.vercel.app`.
2. In Vercel, add `VITE_WORKER_URL=https://<worker-url>` and redeploy. Uploads, videos and evidence frames then go to the worker, while everything else stays on Vercel.
3. Draw the camera zones once with `python detector/pick_zones.py <clip> zones.json` and put the file at `/data/zones.json` on the worker. To use the mock detector instead, set `DETECTOR_URL` to an empty value.

Until the worker is connected, an upload says "Clip analysis runs on the Nicked worker, which this site isn't connected to yet."

### Know before you demo

- **One shop, no accounts.** The backend serves a single demo shop. Sign-up and log-in on the frontend only remember the owner's name on that device, so anyone with the URL sees the same shop. Real accounts are the next backend job.
- **Stripe is sandbox only.** Live keys are refused.
- **Footage is personal data.** It is auto-deleted after 30 days unless it backs a report.
