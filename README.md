# nicked

We flag. You decide.

Nicked watches the CCTV a shop already has and flags possible concealment. Every flag goes to the owner first. Nothing goes to the Gardaí until they confirm.

| Folder | What it is |
|---|---|
| [backend/](backend/README.md) | Express + MongoDB API: upload, OpenRouter vision checks, review queue, incident reports, Stripe sandbox |
| [detector/](detector/README.md) | Python YOLO service (Ultralytics + Supervision + OpenCV): finds shelf → no till → exit candidates |
| frontend/ | Coming next. Built from `GET /api/brand` and the brand guidelines |

```bash
# terminal 1
cd detector && uvicorn server:app --port 8000
# terminal 2
cd backend && npm run dev     # DETECTOR_URL=http://localhost:8000 in backend/.env
```
