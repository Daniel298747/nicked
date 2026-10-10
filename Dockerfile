# Backend API + YOLO detector in one image (Render, Railway, Fly).
# The frontend goes to Vercel separately (frontend/vercel.json).
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates libgl1 libglib2.0-0 \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Detector: CPU-only torch keeps the image ~1.5 GB instead of ~5 GB
COPY detector/requirements.txt detector/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install --no-cache-dir -r detector/requirements.txt
COPY detector detector
# Bake the weights in so the first upload doesn't wait on a download
RUN cd detector && python -c "from ultralytics import YOLO; YOLO('yolo26n.pt')"

# Backend
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend backend
COPY deploy/start.sh start.sh

# /data should be a persistent disk: uploads, evidence frames, exports, zones.json
ENV NODE_ENV=production \
    PORT=4000 \
    DETECTOR_URL=http://127.0.0.1:8000 \
    UPLOAD_DIR=/data/uploads \
    ANNOTATED_DIR=/data/annotated \
    ZONES_FILE=/data/zones.json \
    YOLO_CONFIG_DIR=/tmp/ultralytics
EXPOSE 4000
CMD ["sh", "start.sh"]
