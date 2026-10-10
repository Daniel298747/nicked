import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { config } from '../config.js';
import { loadShop, hasPaidAccess } from '../middleware/shop.js';
import { Shop } from '../models/Shop.js';
import { StripeEvent } from '../models/StripeEvent.js';
import { getStripe, getPrices, stripeEventPlan } from '../services/stripe.js';
import {
  CAMERA_INCLUDES,
  PRODUCT_INFO,
  entitlementsFromSubscription,
  formatEur,
  graduatedAmount,
  kindOf,
  lineItemsFor,
  normalizeSelection,
  quote,
} from '../services/pricing.js';
import { syncCameras } from '../services/usage.js';
import { AppError } from '../utils/errors.js';

const router = Router();

/** Finds the shop a Stripe object belongs to: shop ID, then customer ID, then subscription ID. */
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

const ENTITLEMENT_FIELDS = ['camerasAllowed', 'camerasAlwaysOn', 'retentionDays', 'locationsAllowed', 'planInterval'];

/** Applies a webhook's plan to the shop. Idempotent: payments are de-duplicated by invoice ID. */
export async function applyStripePlan(plan) {
  const shop = await findShopForStripe(plan.match);
  if (!shop) return { shop: null };

  // Events about a subscription that isn't this shop's current one (e.g. an old one cancelled during a demo reset).
  if (plan.subscriptionId && shop.stripeSubscriptionId && shop.stripeSubscriptionId !== plan.subscriptionId) {
    return { shop, ignored: 'not the current subscription' };
  }
  if (plan.onlyIfLinked && !shop.stripeSubscriptionId) return { shop, ignored: 'no subscription linked' };

  for (const [k, v] of Object.entries(plan.set || {})) {
    if (v === undefined) continue;
    shop.set(k, v === null ? undefined : v);
  }

  let sub = plan.syncSubscription;
  if (!sub && plan.fetchSubscription) {
    sub = await getStripe().subscriptions.retrieve(plan.fetchSubscription, { expand: ['items.data.price'] });
  }
  const before = ENTITLEMENT_FIELDS.map((f) => shop[f]).join('|');
  if (sub) Object.assign(shop, entitlementsFromSubscription(sub));

  if (plan.grace === 'start' && !shop.graceUntil) {
    shop.graceUntil = new Date(Date.now() + config.plan.graceDays * 24 * 60 * 60 * 1000);
  }
  if (plan.payment?.invoiceId && !shop.payments.some((p) => p.invoiceId === plan.payment.invoiceId)) {
    shop.payments.push(plan.payment);
  }
  if (plan.firstPayment && !shop.firstPaidAt) {
    shop.firstPaidAt = new Date();
    const founding = await Shop.countDocuments({ isFounding: true });
    if (founding < config.plan.foundingLimit) shop.isFounding = true;
  }
  if (shop.subscriptionStatus === 'active' && !shop.activatedAt) shop.activatedAt = new Date();

  await shop.save();
  if (sub || before !== ENTITLEMENT_FIELDS.map((f) => shop[f]).join('|')) await syncCameras(shop);
  return { shop };
}

async function quoteOrThrow(input) {
  let sel;
  try {
    sel = normalizeSelection(input);
  } catch (err) {
    throw new AppError(err.message, 400, 'BAD_SELECTION');
  }
  const prices = await getPrices();
  return { sel, prices, quote: quote(sel, prices) };
}

// GET /api/billing/plan → everything the pricing page needs, from the live Stripe Prices
router.get('/plan', async (_req, res) => {
  const prices = await getPrices();
  const tiersFor = (interval) => {
    const price = prices[`camera_${interval === 'year' ? 'yearly' : 'monthly'}`];
    let from = 1;
    return price.tiers.map((t) => {
      const to = t.up_to ?? null;
      const row = { from, to, unitAmount: t.unit_amount, display: `${formatEur(t.unit_amount)} each` };
      from = (to ?? from) + 1;
      return row;
    });
  };
  const addon = (kind) => ({
    kind,
    name: PRODUCT_INFO[kind].name,
    description: PRODUCT_INFO[kind].description,
    month: { amount: prices[`${kind}_monthly`].unit_amount, display: formatEur(prices[`${kind}_monthly`].unit_amount) },
    year: { amount: prices[`${kind}_yearly`].unit_amount, display: formatEur(prices[`${kind}_yearly`].unit_amount) },
    billedPer: { always_on: 'camera with 24/7 on', retention: 'shop', location: 'extra location' }[kind],
  });
  const examples = [1, 2, 4, 8].map((n) => ({
    cameras: n,
    month: formatEur(graduatedAmount(prices.camera_monthly.tiers, n)),
    year: formatEur(graduatedAmount(prices.camera_yearly.tiers, n)),
  }));
  res.json({
    currency: 'eur',
    vat: 'Prices exclude VAT',
    camera: { name: PRODUCT_INFO.camera.name, includes: CAMERA_INCLUDES, tiers: { month: tiersFor('month'), year: tiersFor('year') } },
    addons: ['always_on', 'retention', 'location'].map(addon),
    examples,
    freeFirstScan: { available: true, maxMinutes: Math.round(config.plan.freeScanMaxSeconds / 60) },
    guarantees: ['30-day money-back guarantee', 'Founding Shop price lock for the first 100 shops', 'Cancel any time'],
  });
});

// GET /api/billing/quote?cameras=4&interval=month&always_on=1&retention=true&extra_locations=0
router.get('/quote', async (req, res) => {
  const { quote: q } = await quoteOrThrow(req.query);
  res.json({ quote: q });
});

// POST /api/billing/checkout { cameras, interval, addons: { always_on, retention, extra_locations } }
// → { url } of a Stripe-hosted Checkout page. Nothing unlocks until the webhook arrives.
router.post('/checkout', loadShop, async (req, res) => {
  const shop = req.shop;
  if (hasPaidAccess(shop)) {
    throw new AppError('This shop already has an active subscription. Use "Add a camera" to change it.', 409, 'ALREADY_ACTIVE');
  }
  const { sel, prices, quote: q } = await quoteOrThrow(req.body || {});
  const lineItems = (adjustable) =>
    lineItemsFor(sel).map((item) => ({
      price: prices[item.lookupKey].id,
      quantity: item.quantity,
      ...(adjustable && item.kind === 'camera' ? { adjustable_quantity: { enabled: true, minimum: 1, maximum: 50 } } : {}),
    }));
  const params = {
    mode: 'subscription',
    client_reference_id: shop.id,
    metadata: { shop_id: shop.id },
    subscription_data: { metadata: { shop_id: shop.id } },
    ...(shop.stripeCustomerId ? { customer: shop.stripeCustomerId } : shop.email ? { customer_email: shop.email } : {}),
    success_url: `${config.clientUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.clientUrl}/pricing`,
  };
  let session;
  try {
    session = await getStripe().checkout.sessions.create({ ...params, line_items: lineItems(true) });
  } catch (err) {
    if (!/adjustable_quantity/i.test(err?.message || '')) throw err;
    session = await getStripe().checkout.sessions.create({ ...params, line_items: lineItems(false) });
  }
  res.json({ url: session.url, sessionId: session.id, quote: q });
});

// GET /api/billing/verify?session_id=cs_test_...
// For the success page. Read-only: access only changes when the webhook arrives,
// so the page polls this (or GET /api/shop) until `unlocked` is true.
router.get('/verify', loadShop, async (req, res) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId.startsWith('cs_')) throw new AppError('Missing or invalid session_id.', 400, 'BAD_SESSION');
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const owner = session.client_reference_id || session.metadata?.shop_id;
  if (owner !== req.shop.id) throw new AppError('That checkout session belongs to a different shop.', 403, 'WRONG_SHOP');
  res.json({
    paid: session.payment_status === 'paid',
    unlocked: hasPaidAccess(req.shop),
    waitingForWebhook: session.payment_status === 'paid' && !hasPaidAccess(req.shop),
    shop: req.shop.toPublic(),
  });
});

// POST /api/billing/cameras { cameras: 5 } → "Add a camera": changes the camera quantity with proration.
// Stripe bills the difference; the webhook then updates the plan and creates or pauses cameras.
router.post('/cameras', loadShop, async (req, res) => {
  const parsed = z.object({ cameras: z.coerce.number().int().min(1).max(50) }).safeParse(req.body || {});
  if (!parsed.success) throw new AppError('Send { "cameras": <1–50> }.', 400, 'VALIDATION');
  const shop = req.shop;
  if (!shop.stripeSubscriptionId || !hasPaidAccess(shop)) {
    throw new AppError('Subscribe first, then add cameras.', 402, 'SUBSCRIPTION_REQUIRED');
  }
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(shop.stripeSubscriptionId, { expand: ['items.data.price'] });
  const cameraItem = sub.items.data.find((i) => kindOf(i.price) === 'camera');
  if (!cameraItem) throw new AppError('This subscription has no camera item.', 409, 'NO_CAMERA_ITEM');
  const alwaysOnItem = sub.items.data.find((i) => kindOf(i.price) === 'always_on');
  const items = [{ id: cameraItem.id, quantity: parsed.data.cameras }];
  if (alwaysOnItem && alwaysOnItem.quantity > parsed.data.cameras) items.push({ id: alwaysOnItem.id, quantity: parsed.data.cameras });

  const updated = await stripe.subscriptions.update(shop.stripeSubscriptionId, { items, proration_behavior: 'create_prorations' });
  res.json({
    cameras: parsed.data.cameras,
    previous: cameraItem.quantity,
    status: updated.status,
    note: 'Stripe prorates the difference on the next invoice. Cameras update as soon as the webhook arrives.',
  });
});

/**
 * Stripe webhook (raw body, mounted before express.json in app.js) at both
 * /api/billing/webhook and /webhooks/stripe.
 * Local testing: stripe listen --forward-to localhost:4000/webhooks/stripe
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

  const plan = stripeEventPlan(event);
  let result = { shop: null };
  if (plan) {
    // If this throws we return 500 and Stripe retries; the event is only recorded once it succeeded.
    result = await applyStripePlan(plan);
    if (!result.shop) console.warn(`[stripe] ${event.type} ${event.id}: no matching shop`);
    else if (result.ignored) console.log(`[stripe] ${event.type} ignored: ${result.ignored}`);
    else {
      const s = result.shop;
      console.log(`[stripe] ${event.type} → ${s.subscriptionStatus}, ${s.camerasAllowed} camera(s), ${s.camerasAlwaysOn} 24/7, ${s.retentionDays}-day retention`);
    }
  }
  await StripeEvent.create({ _id: event.id, type: event.type }).catch((err) => {
    if (err?.code !== 11000) throw err;
  });
  res.json({ received: true, ignored: !plan || Boolean(result.ignored), shop: result.shop?.id || null });
}

export default router;
