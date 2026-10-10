"""Draw the shelf, till and exit zones for one camera view and save zones.json.

    python pick_zones.py clips/test_01.mp4 [zones.json] [--frame 50]

Click the corners of each zone in turn. Keys: Enter or n = next zone,
u = undo last point, r = restart this zone, q or Esc = quit without saving.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

import brand

ZONES = ("shelf", "till", "exit")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out", nargs="?", default="zones.json")
    ap.add_argument("--frame", type=int, default=0, help="frame to draw on (pick one with the zones in clear view)")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, base = cap.read()
    cap.release()
    if not ok:
        print("Couldn't read a frame from that video.", file=sys.stderr)
        return 1

    zones: dict[str, list[list[int]]] = {}
    pts: list[list[int]] = []
    current = 0

    def redraw():
        img = base.copy()
        for name, poly in zones.items():
            cv2.polylines(img, [np.array(poly).reshape(-1, 1, 2)], True, brand.CONTROL_BORDER, 2)
            cv2.putText(img, name.upper(), tuple(poly[0]), cv2.FONT_HERSHEY_DUPLEX, 0.6, brand.WHITE, 1)
        if pts:
            cv2.polylines(img, [np.array(pts).reshape(-1, 1, 2)], False, brand.SIGNAL_ORANGE, 2)
            for p in pts:
                cv2.circle(img, tuple(p), 4, brand.SIGNAL_ORANGE, -1)
        cv2.putText(img, f"Click the {ZONES[current]} corners, then Enter", (12, 28),
                    cv2.FONT_HERSHEY_DUPLEX, 0.7, brand.WHITE, 1, cv2.LINE_AA)
        cv2.imshow("Nicked zones", img)

    def click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            pts.append([int(x), int(y)])
            redraw()

    cv2.namedWindow("Nicked zones")
    cv2.setMouseCallback("Nicked zones", click)
    redraw()
    while current < len(ZONES):
        key = cv2.waitKey(0) & 0xFF
        if key in (27, ord("q")):
            print("Quit without saving.")
            return 1
        if key == ord("u") and pts:
            pts.pop()
        elif key == ord("r"):
            pts.clear()
        elif key in (13, 10, ord("n")):
            if len(pts) < 3:
                print(f"The {ZONES[current]} zone needs at least 3 points.")
            else:
                zones[ZONES[current]] = list(pts)
                pts.clear()
                current += 1
        if current < len(ZONES):
            redraw()
    cv2.destroyAllWindows()

    Path(args.out).write_text(json.dumps(zones, indent=2))
    print(f"Saved {args.out}")
    print(json.dumps(zones))
    return 0


if __name__ == "__main__":
    sys.exit(main())
