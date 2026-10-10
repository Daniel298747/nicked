#!/bin/sh
# One container, two processes: the YOLO detector on 127.0.0.1:8000 and the API on $PORT.
set -e
mkdir -p "$(dirname "$UPLOAD_DIR")" "$UPLOAD_DIR" "$ANNOTATED_DIR"
(cd /app/detector && python -m uvicorn server:app --host 127.0.0.1 --port 8000) &
cd /app/backend && exec node src/index.js
