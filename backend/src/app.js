import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { dbState, ensureDb } from './db.js';
import shopRoutes from './routes/shop.js';
import clipRoutes from './routes/clips.js';
import eventRoutes from './routes/events.js';
import incidentRoutes from './routes/incidents.js';
import statsRoutes from './routes/stats.js';
import cameraRoutes from './routes/cameras.js';
import billingRoutes, { stripeWebhook } from './routes/billing.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { BRAND } from './services/brand.js';
import { AppError } from './utils/errors.js';

/** A CLIENT_URL entry with * (e.g. https://nicked-*.vercel.app for preview deploys) becomes a regex. */
export function originPattern(url) {
  if (!url.includes('*')) return url;
  const escaped = url.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[a-z0-9-]+')}$`);
}

/** Serverless: connect on the first request instead of at startup, and fail with a readable 503. */
async function requireDb(_req, _res, next) {
  if (!config.mongoConfigured) {
    throw new AppError("Nicked's database isn't set up yet. Add MONGODB_URI to the project's environment variables.", 503, 'DB_NOT_CONFIGURED');
  }
  try {
    await ensureDb();
  } catch (err) {
    console.error('[db]', err.message);
    throw new AppError("Can't reach Nicked's database right now. Try again in a moment.", 503, 'DB_UNAVAILABLE');
  }
  next();
}

/** On Vercel, video upload and analysis live on the worker (no ffmpeg/YOLO, 4.5 MB bodies). */
function analysisElsewhere(req, _res, next) {
  if (req.method === 'POST' && /^\/api\/clips(\/[^/]+\/reprocess)?\/?$/.test(req.path)) {
    throw new AppError(
      "Clip analysis runs on the Nicked worker, which this site isn't connected to yet. Set VITE_WORKER_URL to the worker and redeploy.",
      503,
      'ANALYSIS_ELSEWHERE',
    );
  }
  next();
}

/** serverless: true when running as a Vercel function (api/index.js). */
export function createApp({ serverless = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientUrls.map(originPattern) }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      runtime: config.onVercel ? 'vercel' : 'server',
      analysis: config.analysisOnThisHost,
      dbConfigured: config.mongoConfigured,
      db: dbState(),
      detector: config.detector.url ? `http (${config.detector.url})` : 'mock',
      openrouter: Boolean(config.openrouter.apiKey),
      model: config.openrouter.detectModel,
      closeLookModel: config.verify.closeLook ? config.openrouter.zoomModel : null,
      retentionJob: Boolean(config.retentionDays),
      stripe: Boolean(config.stripe.secretKey),
      paywallBypassed: config.devBypassPaywall,
    });
  });

  // Design tokens and status wording, so the frontend matches the brand guidelines.
  app.get('/api/brand', (_req, res) => res.json(BRAND));

  if (serverless) app.use(requireDb);
  if (!config.analysisOnThisHost) app.use(analysisElsewhere);

  // Stripe needs the raw body to verify the signature, so this route comes before express.json().
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/shop', shopRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/cameras', cameraRoutes);
  app.use('/api/clips', clipRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/stats', statsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
