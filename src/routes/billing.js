import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { loadShop } from '../middleware/shop.js';
import { Shop } from '../models/Shop.js';
import { StripeEvent } from '../models/StripeEvent.js';
import { getStripe, getPlanPrice, publicPlan, shopUpdateFromStripeEvent } from '../services/stripe.js';
import { AppError } from '../utils/errors.js';

const router = Router();

/** Finds the shop a Stripe object belongs to: metadata shopId, then customer ID, then subscription ID. */
async function findShopForStripe({ shopId, customerId, subscriptionId }) {
  if (shopId && mongoose.isValidObjectId(shopId)) {
    const shop = await Shop.findById(shopId);
    if (shop) return shop;
  }
  if (customerId) {
    const shop = await Shop.findOne({ stripeCustomerId: customerId });
    if (shop) return shop;
  }
  if (subscriptionId) return Shop.findOne({ stripeSubscriptionId: subscriptionId });
  return null;
}

/** Applies a shop update computed from Stripe. Idempotent: payments are de-duplicated by invoice ID. */
export async function applyShopUpdate(update) {
  const shop = await findShopForStripe(update.match);
  if (!shop) return null;
  for (const [k, v] of Object.entries(update.set)) if (v !== undefined) shop[k] = v;
  if (update.activate && !shop.activatedAt) shop.activatedAt = new Date();
  if (update.payment?.invoiceId && !shop.payments.some((p) => p.invoiceId === update.payment.invoiceId)) {
    shop.payments.push(update.payment);
  }
  await shop.save();
  return shop;
}

// GET /api/billing/plan → price, currency, interval and features for the pricing page
router.get('/plan', async (_req, res) => {
  res.json({ plan: publicPlan(await getPlanPrice()) });
});

// POST /api/billing/checkout → { url } of a Stripe-hosted Checkout page (subscription mode)
router.post('/checkout', loadShop, async (req, res) => {
  const shop = req.shop;
  if (shop.subscriptionStatus === 'active') {
    throw new AppError('This shop already has an active subscription.', 409, 'ALREADY_ACTIVE');
  }
  const price = await getPlanPrice();
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: shop.id,
    metadata: { shopId: shop.id },
    subscription_data: { metadata: { shopId: shop.id } },
    ...(shop.stripeCustomerId ? { customer: shop.stripeCustomerId } : shop.email ? { customer_email: shop.email } : {}),
    success_url: `${config.clientUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.clientUrl}/pricing?canceled=1`,
  });
  res.json({ url: session.url, sessionId: session.id });
});

// GET /api/billing/verify?session_id=cs_test_...
// Called by the success page. Confirms the payment with Stripe directly, so the shop unlocks
// even if the webhook is slow. The webhook does the same thing; both are idempotent.
router.get('/verify', loadShop, async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId || !String(sessionId).startsWith('cs_')) {
    throw new AppError('Missing or invalid session_id.', 400, 'BAD_SESSION');
  }
  const session = await getStripe().checkout.sessions.retrieve(String(sessionId), { expand: ['invoice'] });
  const owner = session.metadata?.shopId || session.client_reference_id;
  if (owner !== req.shop.id) throw new AppError('That checkout session belongs to a different shop.', 403, 'WRONG_SHOP');

  if (session.status === 'complete' && session.payment_status === 'paid') {
    const update = shopUpdateFromStripeEvent({ type: 'checkout.session.completed', data: { object: session } });
    const invoice = typeof session.invoice === 'object' ? session.invoice : null;
    if (invoice?.status === 'paid') {
      update.payment = {
        invoiceId: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date(),
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      };
    }
    const shop = await applyShopUpdate(update);
    return res.json({ paid: true, shop: (shop || req.shop).toPublic() });
  }
  res.json({ paid: false, status: session.status, paymentStatus: session.payment_status, shop: req.shop.toPublic() });
});

/**
 * POST /api/billing/webhook (raw body, mounted before express.json in app.js)
 * Local testing: stripe listen --forward-to localhost:4000/api/billing/webhook
 */
export async function stripeWebhook(req, res) {
  if (!config.stripe.webhookSecret) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not set.', code: 'NO_WEBHOOK_SECRET' });
  }
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature check failed: ${err.message}`, code: 'BAD_SIGNATURE' });
  }

  // Stripe may deliver an event more than once. Skip ones we've already processed.
  if (await StripeEvent.exists({ _id: event.id })) return res.json({ received: true, duplicate: true });

  const update = shopUpdateFromStripeEvent(event);
  let shop = null;
  if (update) {
    // If this throws, we return 500 and Stripe retries; the event is only recorded once it succeeded.
    shop = await applyShopUpdate(update);
    if (!shop) console.warn(`[stripe] ${event.type} ${event.id}: no matching shop`);
    else console.log(`[stripe] ${event.type} → shop ${shop.id} is ${shop.subscriptionStatus}`);
  }
  await StripeEvent.create({ _id: event.id, type: event.type }).catch((err) => {
    if (err?.code !== 11000) throw err;
  });
  res.json({ received: true, ignored: !update, shop: shop?.id || null });
}

export default router;
