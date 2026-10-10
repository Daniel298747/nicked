import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { dbState } from './db.js';
import shopRoutes from './routes/shop.js';
import clipRoutes from './routes/clips.js';
import eventRoutes from './routes/events.js';
import incidentRoutes from './routes/incidents.js';
import statsRoutes from './routes/stats.js';
import cameraRoutes from './routes/cameras.js';
import billingRoutes, { stripeWebhook } from './routes/billing.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { BRAND } from './services/brand.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientUrls }));

  // Stripe needs the raw body to verify the signature, so this route comes before express.json().
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
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
