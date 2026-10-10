// Vercel Function: the whole Express API, on the same domain as the frontend.
// vercel.json rewrites /api/* and /webhooks/* here; Express sees the original path.
// Video upload and analysis run on the worker (Dockerfile), not here.
import { createApp } from '../backend/src/app.js';

const app = createApp({ serverless: true });

export default function handler(req, res) {
  // Vercel's lazy req.body helper would read the stream before express.raw() can,
  // which breaks Stripe's webhook signature check. Hand Express an untouched body.
  try {
    Object.defineProperty(req, 'body', { value: undefined, writable: true, configurable: true, enumerable: true });
  } catch {
    /* helpers disabled (NODEJS_HELPERS=0): nothing to undo */
  }
  return app(req, res);
}
