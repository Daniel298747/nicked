# nicked

We flag. You decide.

Nicked watches the CCTV a shop already has and flags possible concealment. Every flag goes to the owner first, and nothing goes to the Gardaí until they confirm.

| Folder | What it is | Where it runs |
|---|---|---|
| [frontend/](frontend/) | React + Vite app: landing page, pricing, review queue, incident reports | Vercel |
| [backend/](backend/README.md) | Express + MongoDB API: uploads, OpenRouter vision checks, reports, Stripe sandbox | Docker host (Render, Railway, Fly) |
| [detector/](detector/README.md) | Python YOLO service (Ultralytics + Supervision + OpenCV) | Same container as the backend |

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

The frontend goes on Vercel. The backend and detector can't: uploads are CCTV video (Vercel caps request bodies at 4.5 MB), YOLO needs torch, and analysis runs for minutes in the background on a local disk. They run together in one Docker container instead.

### 1. Backend + detector (Render)

1. Create a free MongoDB Atlas cluster and copy the `mongodb+srv://…` URI.
2. On Render: **New → Blueprint**, then pick this repo. It reads `render.yaml`, which sets up a Docker web service with a 10 GB disk at `/data`. It needs at least 2 GB of RAM (the Standard plan).
3. Fill in the secrets it asks for:
   - `MONGODB_URI`
   - `OPENROUTER_API_KEY`
   - `STRIPE_SECRET_KEY` (an `sk_test_` key)
   - `CLIENT_URL`: the Vercel URL, plus `,https://<project>-*.vercel.app` if you want preview deploys to work too
4. In Stripe (test mode), add a webhook endpoint at `https://<render-url>/api/billing/webhook` for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.created`, `.updated` and `.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Then create the prices once with `npm run stripe:seed` (from `backend/`, using the same test key).
5. Draw the camera zones once with `python detector/pick_zones.py <clip> zones.json` and put the file on the disk at `/data/zones.json`. Until then, uploads explain that zones are missing. To use the mock detector instead, set `DETECTOR_URL` to an empty value.

Railway and Fly work the same way: build the root `Dockerfile`, mount a volume at `/data`, and set the same variables.

### 2. Frontend (Vercel)

1. **Add New → Project**, import this repo, and set **Root Directory** to `frontend`. Vercel detects Vite. `frontend/vercel.json` sends every route to `index.html` for the router.
2. Add the environment variable `VITE_API_URL=https://<render-url>`.
3. Deploy. The browser talks to the backend directly; CORS allows the origins listed in `CLIENT_URL`.

### Know before you demo

- **One shop, no accounts.** The backend serves a single demo shop. Sign-up and log-in on the frontend only remember the owner's name on that device, so anyone with the URL sees the same shop. Real accounts are the next backend job.
- **Stripe is sandbox only.** Live keys are refused.
- **Footage is personal data.** It is auto-deleted after 30 days unless it backs a report.
