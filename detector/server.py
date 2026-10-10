"""HTTP wrapper around detect.py for the Nicked backend (see backend/docs/DETECTOR_CONTRACT.md).

    uvicorn server:app --port 8000

Then set DETECTOR_URL=http://localhost:8000 in backend/.env.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from detect import DEFAULT_MODEL, DEFAULT_POSE_MODEL, DetectionError, run_detection

ANNOTATED_DIR = Path(os.environ.get("ANNOTATED_DIR", Path(__file__).parent / "out")).resolve()
ANNOTATE_DEFAULT = os.environ.get("ANNOTATE", "true").lower() != "false"
POSE_DEFAULT = os.environ.get("POSE", "false").lower() == "true"

app = FastAPI(title="Nicked detector")

# One video at a time: YOLO on a laptop CPU is already using every core,
# and each run builds its own tracker so IDs never leak between videos.
_lock = threading.Lock()


class DetectRequest(BaseModel):
    video_path: str
    zones: dict
    min_shelf_seconds: float = Field(2.0, gt=0, le=600)
    annotate: bool | None = None
    pose: bool | None = None
    camera_name: str | None = Field(None, max_length=40)


@app.exception_handler(HTTPException)
async def readable_errors(_request, exc: HTTPException):
    # The contract asks for { "error": "message" }; the backend shows it to the owner.
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": DEFAULT_MODEL,
        "pose_model": DEFAULT_POSE_MODEL,
        "pose_default": POSE_DEFAULT,
        "annotate_default": ANNOTATE_DEFAULT,
        "busy": _lock.locked(),
    }


@app.post("/detect")
def detect(req: DetectRequest):
    annotate = ANNOTATE_DEFAULT if req.annotate is None else req.annotate
    pose = POSE_DEFAULT if req.pose is None else req.pose
    annotated_path = ANNOTATED_DIR / f"{Path(req.video_path).stem}.annotated.mp4" if annotate else None

    with _lock:
        try:
            return run_detection(
                req.video_path,
                req.zones,
                req.min_shelf_seconds,
                annotated_path=annotated_path,
                pose=pose,
                camera_label=(req.camera_name or "CAM 01").upper(),
            )
        except DetectionError as err:
            raise HTTPException(422, str(err)) from err
        except Exception as err:  # keep the message readable; details go to the console
            print(f"[detect] {req.video_path}: {err!r}")
            raise HTTPException(500, "The detector hit an error on this video. Check the detector console.") from err
