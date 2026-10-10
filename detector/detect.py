"""Nicked YOLO detector: people who browse the shelf, skip the till and reach the exit.

Ultralytics YOLO finds and tracks people (ByteTrack), Roboflow Supervision
checks which zone each person's feet are in, and OpenCV reads the video and
writes the annotated copy. The output matches backend/docs/DETECTOR_CONTRACT.md.

These are candidates, not accusations. Someone who browses and leaves without
buying will also match the rule. The backend's OpenRouter check and the owner
filter them out.

    python detect.py clips/test_01.mp4 zones.json
    python detect.py clips/test_01.mp4 zones.json --annotate out/test_01.annotated.mp4 --pose
    python detect.py clips/test_01.mp4 zones.json --mock-dir ../backend/mock-detections
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

import brand

DEFAULT_MODEL = os.environ.get("YOLO_MODEL", "yolo26n.pt")
DEFAULT_POSE_MODEL = os.environ.get("YOLO_POSE_MODEL", "yolo26n-pose.pt")
TRACKER = os.environ.get("YOLO_TRACKER", "bytetrack.yaml")

ZONE_NAMES = ("shelf", "till", "exit")
RULE = "shelf -> no till -> exit"
PAD_BEFORE, PAD_AFTER = 3.0, 2.0  # seconds of context around each candidate
BOXES_PER_SECOND = 5  # person boxes sent to the backend for close-up crops

# COCO pose keypoints
L_WRIST, R_WRIST, L_HIP, R_HIP = 9, 10, 11, 12
# A wrist counts as "at the waist" when it is within these shares of the
# person's box height from a hip. Relaxed arms hang lower than this.
WAIST_DX, WAIST_DY = 0.08, 0.05
HAND_TO_WAIST_MIN_SECONDS = 0.3

FONT = cv2.FONT_HERSHEY_DUPLEX  # closest built-in to a mono CCTV overlay


class DetectionError(Exception):
    """A readable problem with the input. The message is shown to the shop owner."""


@dataclass
class Person:
    first_seen: float
    shelf_frames: int = 0
    first_shelf: float | None = None
    visited_till: bool = False
    flagged: bool = False
    waist_frames: int = 0
    waist_at: float | None = None
    boxes: list[dict] = field(default_factory=list)


def video_info(video_path: str | Path) -> dict:
    if not Path(video_path).is_file():
        raise DetectionError("Video file not found.")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise DetectionError("Video unreadable.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    if not 0 < fps <= 240:
        fps = 25.0
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ok, _ = cap.read()
    cap.release()
    if not ok or not width or not height:
        raise DetectionError("Video unreadable. No frames could be decoded.")
    return {
        "fps": fps,
        "duration": round(frames / fps, 2) if frames > 0 else None,
        "width": width,
        "height": height,
    }


def validate_zones(zones: dict) -> dict[str, np.ndarray]:
    if not isinstance(zones, dict):
        raise DetectionError("Zones must be an object with shelf, till and exit polygons.")
    missing = [n for n in ZONE_NAMES if n not in zones]
    if missing:
        raise DetectionError(f"Zones are missing: {', '.join(missing)}.")
    polygons = {}
    for name in ZONE_NAMES:
        try:
            pts = np.array(zones[name], dtype=np.int32)
        except (TypeError, ValueError):
            pts = np.empty((0,))
        if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 3:
            raise DetectionError(f"The {name} zone needs at least 3 [x, y] points.")
        polygons[name] = pts
    return polygons


def hand_at_waist(kp: np.ndarray, box: np.ndarray) -> bool:
    """True when a visible wrist sits level with, and close to, a visible hip."""
    height = float(box[3] - box[1])
    if height <= 0:
        return False
    hips = [kp[i] for i in (L_HIP, R_HIP) if kp[i].any()]
    wrists = [kp[i] for i in (L_WRIST, R_WRIST) if kp[i].any()]
    return any(
        abs(w[0] - h[0]) < WAIST_DX * height and abs(w[1] - h[1]) < WAIST_DY * height
        for w in wrists
        for h in hips
    )


def run_detection(
    video_path: str | Path,
    zones: dict,
    min_shelf_seconds: float = 2.0,
    *,
    annotated_path: str | Path | None = None,
    pose: bool = False,
    model_name: str | None = None,
    camera_label: str = "CAM 01",
) -> dict:
    """Runs YOLO tracking + zone rules over one video. Returns the contract response."""
    started = time.time()
    info = video_info(video_path)
    polygons = validate_zones(zones)
    fps = info["fps"]

    sv_zones = {
        name: sv.PolygonZone(polygon=pts, triggering_anchors=(sv.Position.BOTTOM_CENTER,))
        for name, pts in polygons.items()
    }
    weights = model_name or (DEFAULT_POSE_MODEL if pose else DEFAULT_MODEL)
    model = YOLO(weights)
    box_every = max(1, round(fps / BOXES_PER_SECOND))
    waist_min_frames = max(1, round(fps * HAND_TO_WAIST_MIN_SECONDS))

    people: dict[int, Person] = {}
    events: list[dict] = []
    sink = None
    if annotated_path:
        Path(annotated_path).parent.mkdir(parents=True, exist_ok=True)
        sink = sv.VideoSink(
            str(annotated_path),
            sv.VideoInfo(width=info["width"], height=info["height"], fps=max(1, round(fps))),
        )
        sink.__enter__()

    try:
        stream = model.track(
            source=str(video_path), stream=True, persist=True, classes=[0], tracker=TRACKER, verbose=False
        )
        for frame_idx, result in enumerate(stream):
            t = frame_idx / fps
            det = sv.Detections.from_ultralytics(result)
            tracked = det.tracker_id is not None and len(det) > 0

            if tracked:
                keypoints = None
                if pose and result.keypoints is not None:
                    keypoints = result.keypoints.xy.cpu().numpy()
                in_zone = {name: zone.trigger(det) for name, zone in sv_zones.items()}

                for i, tid in enumerate(det.tracker_id):
                    tid = int(tid)
                    p = people.setdefault(tid, Person(first_seen=t))

                    if frame_idx % box_every == 0:
                        p.boxes.append({"t": round(t, 2), "box": [round(float(v), 1) for v in det.xyxy[i]]})

                    if in_zone["shelf"][i]:
                        p.shelf_frames += 1
                        if p.first_shelf is None:
                            p.first_shelf = t
                    if in_zone["till"][i]:
                        p.visited_till = True

                    if keypoints is not None and p.first_shelf is not None and i < len(keypoints):
                        if hand_at_waist(keypoints[i], det.xyxy[i]):
                            p.waist_frames += 1
                            if p.waist_frames >= waist_min_frames and p.waist_at is None:
                                p.waist_at = round(t, 2)

                    if in_zone["exit"][i] and not p.flagged:
                        shelf_secs = p.shelf_frames / fps
                        if shelf_secs >= min_shelf_seconds and not p.visited_till:
                            p.flagged = True
                            events.append(_candidate(tid, p, t, shelf_secs, info["duration"], pose))

            if sink is not None:
                # Every frame is written, even ones with nobody in them, so the video keeps its timing.
                sink.write_frame(annotate(result.orig_img, det if tracked else None, people, polygons, t, camera_label))
    finally:
        if sink is not None:
            sink.__exit__(None, None, None)

    return {
        "fps": round(fps, 3),
        "duration": info["duration"],
        "frame_width": info["width"],
        "frame_height": info["height"],
        "events": events,
        "people_tracked": len(people),
        "model": weights,
        "processing_seconds": round(time.time() - started, 1),
        **({"annotated_video_path": str(Path(annotated_path).resolve())} if annotated_path else {}),
    }


def _candidate(tid: int, p: Person, t: float, shelf_secs: float, duration: float | None, pose: bool) -> dict:
    start = round(max(0.0, (p.first_shelf or p.first_seen) - PAD_BEFORE), 2)
    end = round(t + PAD_AFTER, 2)
    if duration:
        end = min(end, duration)
    event = {
        "track_id": tid,
        "start_time": start,
        "end_time": end,
        "shelf_seconds": round(shelf_secs, 1),
        "visited_till": False,
        "rule": RULE,
        "boxes": [b for b in p.boxes if start <= b["t"] <= end],
    }
    if pose:
        event["hand_to_waist"] = p.waist_at is not None
        if p.waist_at is not None:
            event["hand_to_waist_at"] = p.waist_at
    return event


# --- Annotated video ---------------------------------------------------------


def _chip(img, text, x, y, bg, fg, scale, thick, pad):
    (tw, th), base = cv2.getTextSize(text, FONT, scale, thick)
    x2, y2 = x + tw + 2 * pad, y + th + base + 2 * pad
    h, w = img.shape[:2]
    if x2 > w:
        x, x2 = w - (x2 - x), w
    if y < 0:
        y, y2 = 0, y2 - y
    cv2.rectangle(img, (x, y), (x2, y2), bg, -1)
    cv2.putText(img, text, (x + pad, y + pad + th), FONT, scale, fg, thick, cv2.LINE_AA)


def annotate(frame, det, people, polygons, t, camera_label):
    img = frame.copy()
    h, w = img.shape[:2]
    s = max(0.4, h / 720)
    scale, thick, pad = 0.5 * s, max(1, round(s)), max(3, round(4 * s))
    bar = int(30 * s)

    # Zones: neutral outlines with a navy label, so the only orange is a flag.
    for name, pts in polygons.items():
        cv2.polylines(img, [pts.reshape(-1, 1, 2)], True, brand.CONTROL_BORDER, max(1, round(2 * s)), cv2.LINE_AA)
        x, y = int(pts[:, 0].min()), max(bar, int(pts[:, 1].min()))
        _chip(img, name.upper(), x, y, brand.NAVY, brand.WHITE, scale * 0.9, thick, pad)

    if det is not None:
        for i, tid in enumerate(det.tracker_id):
            x1, y1, x2, y2 = (int(v) for v in det.xyxy[i])
            flagged = people.get(int(tid)) is not None and people[int(tid)].flagged
            colour = brand.SIGNAL_ORANGE if flagged else brand.HAIRLINE
            cv2.rectangle(img, (x1, y1), (x2, y2), colour, max(1, round((3 if flagged else 1.5) * s)), cv2.LINE_AA)
            label = f"#{int(tid)} LOOK" if flagged else f"#{int(tid)}"
            _chip(img, label, x1, y1 - int(26 * s), colour if flagged else brand.NAVY, brand.WHITE, scale, thick, pad)

    # Feed overlay: camera and video time on the left, REC on the right.
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (w, bar), brand.CCTV_FEED, -1)
    cv2.addWeighted(overlay, 0.75, img, 0.25, 0, img)
    mins, secs = divmod(t, 60)
    cv2.putText(img, f"{camera_label}  {int(mins):02d}:{secs:04.1f}", (pad * 2, bar - pad * 2 + thick),
                FONT, scale, brand.WHITE, thick, cv2.LINE_AA)
    (tw, _), _ = cv2.getTextSize("REC", FONT, scale, thick)
    cv2.putText(img, "REC", (w - tw - pad * 2, bar - pad * 2 + thick), FONT, scale, brand.WHITE, thick, cv2.LINE_AA)
    cv2.circle(img, (w - tw - pad * 4, bar // 2), max(3, int(5 * s)), brand.SIGNAL_ORANGE, -1, cv2.LINE_AA)
    return img


# --- CLI ---------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Find shelf -> no till -> exit candidates in a CCTV clip.")
    ap.add_argument("video")
    ap.add_argument("zones", help="zones.json with shelf, till and exit polygons")
    ap.add_argument("--min-shelf-seconds", type=float, default=2.0)
    ap.add_argument("--out", default="events.json", help="where to write the result (default events.json)")
    ap.add_argument("--annotate", metavar="PATH", help="also write a video with boxes, IDs and zones drawn on")
    ap.add_argument("--pose", action="store_true", help="use the pose model and add hand_to_waist")
    ap.add_argument("--model", help=f"YOLO weights (default {DEFAULT_MODEL})")
    ap.add_argument("--camera", default="CAM 01", help="label for the feed overlay")
    ap.add_argument(
        "--mock-dir",
        metavar="DIR",
        help="write <video>.json and <video>.annotated.mp4 into DIR (backend/mock-detections) for mock mode",
    )
    args = ap.parse_args(argv)

    out, annotated = Path(args.out), args.annotate
    if args.mock_dir:
        stem = Path(args.video).stem
        out = Path(args.mock_dir) / f"{stem}.json"
        annotated = Path(args.mock_dir) / f"{stem}.annotated.mp4"

    try:
        zones = json.loads(Path(args.zones).read_text())
        result = run_detection(
            args.video, zones, args.min_shelf_seconds,
            annotated_path=annotated, pose=args.pose, model_name=args.model, camera_label=args.camera,
        )
    except (DetectionError, OSError, json.JSONDecodeError) as err:
        print(f"Couldn't process the video: {err}", file=sys.stderr)
        return 1

    if args.mock_dir:
        # Mock mode reads the annotated video from the file name, so the path isn't needed (or portable).
        result.pop("annotated_video_path", None)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    n = len(result["events"])
    print(f"{n} candidate{'s' if n != 1 else ''} from {result['people_tracked']} people, written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
