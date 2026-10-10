# Mock detections

Used when `DETECTOR_URL` is empty.

- Upload `my_clip.mp4` and, if `mock-detections/my_clip.json` exists, its candidates are used.
  Drop in the `events.json` that `detect.py` produced for that clip and rename it.
- If there's no matching file, one fake candidate is made from 30% to 80% of the video.

Format (same as `detect.py` output):

```json
[
  { "track_id": 4, "start_time": 39.0, "end_time": 72.0, "shelf_seconds": 6.4,
    "visited_till": false, "rule": "shelf -> no till -> exit" }
]
```
