# Detector contract (Python YOLO repo ↔ MERN backend)

The MERN backend calls the YOLO service once per uploaded clip. Both run on the
same laptop for the demo, so the backend sends a file path, not the video.

## Request

`POST {DETECTOR_URL}/detect`

```json
{
  "video_path": "/Users/you/hackucd-backend/uploads/clips/1760090000000-ab12cd34.mp4",
  "zones": {
    "shelf": [[100,200],[400,200],[400,450],[100,450]],
    "till":  [[500,300],[650,300],[650,480],[500,480]],
    "exit":  [[700,100],[800,100],[800,480],[700,480]]
  },
  "min_shelf_seconds": 2.0
}
```

Zones are pixel polygons in the original video's resolution.

## Response 200

```json
{
  "fps": 25,
  "duration": 95.2,
  "frame_width": 1280,
  "frame_height": 720,
  "events": [
    { "track_id": 4, "start_time": 39.0, "end_time": 72.0, "shelf_seconds": 6.4,
      "visited_till": false, "rule": "shelf -> no till -> exit" }
  ]
}
```

- `start_time` / `end_time` are seconds from the start of the video, padding included.
- The backend clamps times to the video length and skips malformed events, but please clamp `end_time` too.
- A bare array (what `detect.py` writes to `events.json`) is also accepted.

## Errors

Any non-200 with `{ "error": "message" }` (FastAPI's `{ "detail": ... }` also works).
The message is shown to the user, so keep it readable, e.g. `"Video unreadable"`.

## Minimal FastAPI wrapper (sketch)

Move the loop from `detect.py` into `run_detection()` and return the events list instead of writing a file.

```python
# server.py  —  pip install fastapi uvicorn  —  run: uvicorn server:app --port 8000
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import cv2
from detect import run_detection  # your existing loop, refactored into a function

app = FastAPI()

class DetectRequest(BaseModel):
    video_path: str
    zones: dict
    min_shelf_seconds: float = 2.0

@app.post("/detect")
def detect(req: DetectRequest):
    cap = cv2.VideoCapture(req.video_path)
    if not cap.isOpened():
        raise HTTPException(422, "Video unreadable")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    duration = frames / fps if frames else None

    events = run_detection(req.video_path, req.zones, req.min_shelf_seconds, fps)
    if duration:
        for e in events:
            e["end_time"] = min(e["end_time"], round(duration, 2))
    return {"fps": fps, "duration": duration, "frame_width": width, "frame_height": height, "events": events}
```
