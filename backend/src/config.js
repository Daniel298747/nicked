import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const detectModel = process.env.DETECT_MODEL || 'anthropic/claude-haiku-5.5';

// On Vercel the API runs as a function: read-only disk (except /tmp), 4.5 MB request
// bodies, no ffmpeg or YOLO. Video upload and analysis run on the worker instead.
const onVercel = Boolean(process.env.VERCEL);
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

export const config = {
  port: num(process.env.PORT, 4000),
  appName: process.env.APP_NAME || 'Nicked',
  demoShopName: process.env.DEMO_SHOP_NAME || 'Demo Corner Shop',
  onVercel,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hackucd',
  mongoConfigured: Boolean(process.env.MONGODB_URI) || !onVercel,
  // False on Vercel unless ANALYSIS_ON_THIS_HOST=true: uploads go to the worker (WORKER_URL).
  analysisOnThisHost: onVercel ? process.env.ANALYSIS_ON_THIS_HOST === 'true' : true,
  workerUrl: (process.env.WORKER_URL || '').replace(/\/$/, ''),
  // Comma-separated frontend origins for CORS (* allowed, e.g. https://nicked-*.vercel.app).
  // The first one is used for Stripe redirects, so put the production URL first.
  clientUrls: (process.env.CLIENT_URL || (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:5173'))
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || (onVercel ? '/tmp/nicked-uploads' : 'uploads')),
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 300),
  zonesFile: path.resolve(process.env.ZONES_FILE || 'zones.json'),
  // Footage older than this is deleted automatically, unless it backs an incident report. 0 turns it off.
  retentionDays: Number.isFinite(Number(process.env.RETENTION_DAYS)) ? Number(process.env.RETENTION_DAYS) : 30,
  // Lets you build the UI before Stripe works. Never turn this on for the demo.
  devBypassPaywall: process.env.DEV_BYPASS_PAYWALL === 'true',

  detector: {
    // The Python YOLO service in ../detector. Leave empty to use the built-in mock detector.
    url: (process.env.DETECTOR_URL || '').replace(/\/$/, ''),
    timeoutMs: num(process.env.DETECTOR_TIMEOUT_MS, 10 * 60_000),
    minShelfSeconds: num(process.env.MIN_SHELF_SECONDS, 2),
    mockDir: path.resolve(process.env.MOCK_DETECTIONS_DIR || 'mock-detections'),
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    detectModel,
    // The close-up second look can use a stronger model; it only runs on moments worth a closer look.
    zoomModel: process.env.ZOOM_MODEL || detectModel,
    reportModel: process.env.REPORT_MODEL || detectModel,
    timeoutMs: num(process.env.OPENROUTER_TIMEOUT_MS, 60_000),
  },

  verify: {
    fps: num(process.env.SAMPLE_FPS, 2),
    // A 33 s candidate at 2 fps would be 66 images. We lower the frame rate so each check sends at most this many.
    // Vision pass: ~512px frames in batches of 10–15 (offer spec, cost controls).
    maxFrames: num(process.env.MAX_FRAMES_PER_EVENT, 15),
    frameWidth: num(process.env.FRAME_WIDTH, 512),
    // Motion skipping: drop overview frames that barely changed since the last frame sent.
    // A frame is kept if at least this share of thumbnail pixels changed by more than MOTION_PIXEL_DELTA.
    motionMinChanged: Number.isFinite(Number(process.env.MOTION_MIN_CHANGED)) ? Number(process.env.MOTION_MIN_CHANGED) : 0.002,
    motionPixelDelta: num(process.env.MOTION_PIXEL_DELTA, 10),
    concurrency: num(process.env.VERIFY_CONCURRENCY, 3),
    // Close-up pass: dense frames around the moment the first pass pointed at.
    closeLook: process.env.CLOSE_LOOK !== 'false',
    closeLookSeconds: num(process.env.CLOSE_LOOK_SECONDS, 5),
    closeLookFps: num(process.env.CLOSE_LOOK_FPS, 3),
    closeLookWidth: num(process.env.CLOSE_LOOK_WIDTH, 960),
    // A first-pass "no" at or above this confidence is trusted without a close-up.
    trustNoAbove: Number.isFinite(Number(process.env.TRUST_NO_ABOVE)) ? Number(process.env.TRUST_NO_ABOVE) : 0.7,
    // Seconds of padding detect.py adds before the person's first shelf visit (PAD_BEFORE).
    detectorPadBefore: Number.isFinite(Number(process.env.DETECTOR_PAD_BEFORE)) ? Number(process.env.DETECTOR_PAD_BEFORE) : 3,
    // Average luma (0–255) below this adds a "footage is very dark" warning.
    darkThreshold: num(process.env.DARK_THRESHOLD, 45),
  },

  plan: {
    freeScanMaxSeconds: num(process.env.FREE_SCAN_MAX_SECONDS, 3600),
    dailyCapSeconds: num(process.env.DAILY_CAP_SECONDS, 43_200), // 12 hours
    alwaysOnCapSeconds: num(process.env.ALWAYS_ON_CAP_SECONDS, 86_400), // 24 hours
    graceDays: num(process.env.GRACE_DAYS, 3),
    foundingLimit: num(process.env.FOUNDING_LIMIT, 100),
    defaultTimezone: process.env.SHOP_TIMEZONE || 'Europe/Dublin',
    // Margin alert: flag a shop when this month's AI cost is above this share of its subscription value.
    marginAlertShare: Number.isFinite(Number(process.env.MARGIN_ALERT_SHARE)) ? Number(process.env.MARGIN_ALERT_SHARE) : 1 / 3,
    usdToEur: num(process.env.USD_TO_EUR, 0.92),
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceId: process.env.STRIPE_PRICE_ID || '',
    priceLookupKey: process.env.STRIPE_PRICE_LOOKUP_KEY || 'shop_monthly',
  },
};

config.clientUrl = config.clientUrls[0];

export function configWarnings() {
  const w = [];
  if (!config.openrouter.apiKey) w.push('OPENROUTER_API_KEY is not set: AI checks will fail (candidates still reach the queue, marked "AI check failed").');
  if (!config.detector.url) w.push('DETECTOR_URL is not set: using the mock detector.');
  if (!config.stripe.secretKey) w.push('STRIPE_SECRET_KEY is not set: checkout will fail.');
  if (/^(sk|rk)_live_/.test(config.stripe.secretKey)) w.push('STRIPE_SECRET_KEY is a LIVE key. Sandbox only: Stripe calls are blocked.');
  if (!config.stripe.webhookSecret) w.push('STRIPE_WEBHOOK_SECRET is not set: run `stripe listen --forward-to localhost:4000/api/billing/webhook` and paste the whsec_ value.');
  if (config.devBypassPaywall) w.push('DEV_BYPASS_PAYWALL is on: the paywall is disabled. Turn it off before the demo.');
  return w;
}
