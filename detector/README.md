# Nicked detector (YOLO)

The Python service the backend calls once per uploaded clip. It finds people who spend time at the shelf, never go to the till, and then reach the exit. Those people become **candidates**. The backend sends each candidate to OpenRouter for a vision check, and the owner then decides.

A candidate is not an accusation. Someone who browses and leaves without buying matches the same rule. That's expected, and the next two steps filter them out.

| Piece | Role | Licence |
|---|---|---|
| [Ultralytics YOLO](https://docs.ultralytics.com) (`yolo26n.pt`) | Person detection and ByteTrack tracking | AGPL-3.0 |
| [Roboflow Supervision](https://supervision.roboflow.com) | Shelf, till and exit zones (checked at each person's feet) | MIT |
| OpenCV + ffmpeg | Read the video and write the annotated copy | Apache-2.0 / LGPL |

> **Licence:** AGPL-3.0 means this repo should stay public. A commercial Nicked would need an Ultralytics Enterprise licence or a differently licensed model.

## Install

```bash
cd detector
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision   # CPU build, much smaller
pip install -r requirements.txt
```

The weights (`yolo26n.pt`, about 5 MB) download automatically on the first run.

## 1. Draw the zones (once per camera view)

```bash
python pick_zones.py clips/test_01.mp4 ../backend/zones.json --frame 50
```

Click the corners of the shelf, then press Enter. Do the same for the till and then the exit. Zones are pixel polygons in the video's own resolution. A person counts as inside a zone when the bottom-centre of their box (their feet) is inside it.

## 2a. Run as a service (what the backend uses)

```bash
uvicorn server:app --port 8000
```

In `backend/.env`, set `DETECTOR_URL=http://localhost:8000`. The request and response follow [backend/docs/DETECTOR_CONTRACT.md](../backend/docs/DETECTOR_CONTRACT.md), including both optional extras:

- **Person boxes**, about 5 per second, so the backend's close-up can be cropped to the person's hands.
- **An annotated video** in `out/`, with zones, track IDs and boxes drawn on it. The backend re-encodes it to H.264 for the browser.

The request can also take `annotate`, `pose` and `camera_name`, the label on the feed overlay. The backend sends the camera's name. `GET /health` reports the models in use and whether a video is being processed. The service handles one video at a time.

| Env | Default | |
|---|---|---|
| `YOLO_MODEL` | `yolo26n.pt` | Try `yolo26s.pt` if people are missed and the laptop can take it |
| `YOLO_POSE_MODEL` | `yolo26n-pose.pt` | Used when `pose` is on |
| `YOLO_TRACKER` | `bytetrack.yaml` | Or `botsort.yaml` |
| `POSE` | `false` | Adds `hand_to_waist` to each candidate |
| `ANNOTATE` | `true` | Writes `out/<video>.annotated.mp4` |
| `ANNOTATED_DIR` | `detector/out` | |

## 2b. Or run once from the terminal

```bash
python detect.py clips/test_01.mp4 zones.json                       # writes events.json
python detect.py clips/test_01.mp4 zones.json --annotate out/a.mp4 --pose
python detect.py clips/test_01.mp4 zones.json --mock-dir ../backend/mock-detections
```

`--mock-dir` writes `<video>.json` and `<video>.annotated.mp4` where the backend's mock mode picks them up. Use it when the detector runs on a different laptop from the backend.

## The rule

For each tracked person:

1. While their feet are in the **shelf** zone, count the time.
2. If they ever enter the **till** zone, they are never a candidate.
3. When they reach the **exit** zone after at least `min_shelf_seconds` (2 s by default) at the shelf, they become a candidate. The window runs from 3 s before their first shelf visit to 2 s after they reach the exit, clamped to the video.

**Pose (optional):** with `--pose`, the model also returns wrist and hip keypoints. `hand_to_waist: true` means a wrist stayed level with and close to a hip for at least 0.3 s after the shelf visit, which can suggest a hand going to a pocket. It's a weak hint, stored on the event as `candidate.handToWaist`, and it never creates a candidate on its own.

## The annotated video

It follows the brand's "monitor, not movie" rule. The footage stays as it is, with a dark feed bar showing the camera and video time (`CAM 01  00:10.5`) and an orange REC dot. Zones are drawn in neutral grey. Signal Orange appears on one thing only: the person the rule wants a human to look at (`#2 LOOK`). Everyone else gets a thin neutral box.

## Quick test without real footage

```bash
mkdir -p test
ffmpeg -f lavfi -i color=c=0x333333:s=1280x720:d=12:r=25 -loop 1 -i .venv/Lib/site-packages/ultralytics/assets/zidane.jpg \
  -filter_complex "[1]scale=640:-1[z];[0][z]overlay=x='-100+t*80':y=200:shortest=1,format=yuv420p" -t 12 test/walkout.mp4
python detect.py test/walkout.mp4 test/zones.json --annotate out/walkout.annotated.mp4 --pose
```

Two people slide from the shelf zone into the exit zone, so the result should be 2 candidates with about 40 to 50 boxes each. On a laptop CPU this takes about 15 s. (On Mac or Linux the sample image is at `.venv/lib/python3.*/site-packages/ultralytics/assets/zidane.jpg`.)

## Known limits

- **Camera angle:** the shelf, till and door all need to be in view, or the zones can't work.
- **Track IDs can switch** when people overlap or leave the frame briefly. A switched ID loses its shelf time, so that person can be missed.
- **Speed:** it runs slower than real time on a CPU. That's fine, because we process uploads, not live feeds.
- **Roadmap:** live cameras could use the same `model.track` on an RTSP source, or use Frigate NVR to manage the streams.
