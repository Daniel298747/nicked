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

## Optional extras (these make the demo much better)

### 1. Person boxes → close-ups cropped to the person

Add `boxes` to each event: where the tracked person was, every ~0.2–0.5 s, in original-video pixels.
The backend crops its close-up frames around the person so the AI can actually see their hands.

```json
{ "track_id": 4, "start_time": 39.0, "end_time": 72.0, "shelf_seconds": 6.4, "visited_till": false,
  "rule": "shelf -> no till -> exit",
  "boxes": [ { "t": 39.2, "box": [612, 140, 790, 560] }, { "t": 39.4, "box": [615, 141, 792, 561] } ] }
```

In `detect.py`, inside the `for i, tid in enumerate(det.tracker_id):` loop:

```python
if frame_idx % 5 == 0:  # ~5 boxes per second at 25 fps
    p.setdefault("boxes", []).append({"t": round(t, 2), "box": [round(float(v), 1) for v in det.xyxy[i]]})
```

and when you append the event:

```python
start, end = round(max(0, p["first_shelf"] - PAD_BEFORE), 2), round(t + PAD_AFTER, 2)
events.append({ ..., "start_time": start, "end_time": end,
                "boxes": [b for b in p.get("boxes", []) if start <= b["t"] <= end] })
```

### 2. Annotated video → the "wow" shot in the demo

Render the video with boxes, track IDs and the three zones drawn on, and return its path as
`annotated_video_path` (top level of the response). The backend re-encodes it to H.264 so it plays
in the browser (OpenCV's default `mp4v` doesn't), and serves it at `GET /api/clips/:id/annotated`.

```python
box_annotator = sv.BoxAnnotator()
label_annotator = sv.LabelAnnotator()
zone_annotators = [sv.PolygonZoneAnnotator(zone=z, color=c) for z, c in zip(zones.values(), [sv.Color.BLUE, sv.Color.GREEN, sv.Color.RED])]
info = sv.VideoInfo.from_video_path(VIDEO)

with sv.VideoSink(OUT_PATH, info) as sink:
    for frame_idx, result in enumerate(model.track(source=VIDEO, stream=True, persist=True, classes=[0], verbose=False)):
        frame = result.orig_img.copy()
        det = sv.Detections.from_ultralytics(result)
        # ... existing zone logic ...
        if det.tracker_id is not None and len(det):
            labels = [f"#{int(tid)}" + (" CHECK" if people.get(int(tid), {}).get("flagged") else "") for tid in det.tracker_id]
            frame = box_annotator.annotate(frame, det)
            frame = label_annotator.annotate(frame, det, labels)
        for za in zone_annotators:
            frame = za.annotate(frame)
        sink.write_frame(frame)   # write EVERY frame, even ones with no people
```

Note: the current loop does `continue` when there are no detections. Move that check so frames are still written.

**Running on a different laptop?** Send the files instead: `<video name>.json` (events, with boxes)
and `<video name>.annotated.mp4`. They go in the backend's `mock-detections/` folder.

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
