import Stripe from 'stripe';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { ALL_LOOKUP_KEYS } from './pricing.js';

let stripe = null;

export function getStripe() {
  const key = config.stripe.secretKey;
  if (!key) throw new AppError('STRIPE_SECRET_KEY is not set on the server.', 500, 'STRIPE_NOT_CONFIGURED');
  if (/^(sk|rk)_live_/.test(key)) {
    throw new AppError('A live Stripe key is configured. This project only uses the Stripe sandbox.', 500, 'STRIPE_LIVE_KEY');
  }
  stripe ??= new Stripe(key);
  return stripe;
}

let cache = { at: 0, prices: null };

/** All offer Prices keyed by lookup key (with tiers). Cached for 5 minutes; lookup keys, never hard-coded IDs. */
export async function getPrices({ fresh = false } = {}) {
  if (!fresh && cache.prices && Date.now() - cache.at < 5 * 60_000) return cache.prices;
  const list = await getStripe().prices.list({
    lookup_keys: ALL_LOOKUP_KEYS,
    active: true,
    expand: ['data.tiers', 'data.product'],
    limit: 20,
  });
  const prices = Object.fromEntries(list.data.map((p) => [p.lookup_key, p]));
  const missing = ALL_LOOKUP_KEYS.filter((k) => !prices[k]);
  if (missing.length) throw new AppError(`Stripe prices missing (${missing.join(', ')}). Run npm run stripe:seed.`, 500, 'NO_PRICE');
  cache = { at: Date.now(), prices };
  return prices;
}

export function clearPriceCache() {
  cache = { at: 0, prices: null };
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || undefined;
const fromUnix = (s) => (s ? new Date(s * 1000) : undefined);
const shopIdFrom = (meta) => meta?.shop_id || meta?.shopId;

/**
 * What a webhook means for the shop. Pure, so it's easy to test.
 *  match:             how to find the shop
 *  set:               fields to set directly
 *  syncSubscription:  a subscription object to derive entitlements from
 *  fetchSubscription: a subscription ID to retrieve, then derive entitlements from
 *  payment / grace / firstPayment: invoice bookkeeping
 * Returns null for events we ignore.
 */
export function stripeEventPlan(event) {
  const obj = event.data?.object || {};

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.mode !== 'subscription') return null;
      return {
        match: { shopId: obj.client_reference_id || shopIdFrom(obj.metadata), customerId: idOf(obj.customer) },
        set: {
          stripeCustomerId: idOf(obj.customer),
          stripeSubscriptionId: idOf(obj.subscription),
          ...(obj.customer_details?.email ? { email: obj.customer_details.email } : {}),
        },
        fetchSubscription: idOf(obj.subscription),
      };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return {
        match: { shopId: shopIdFrom(obj.metadata), customerId: idOf(obj.customer), subscriptionId: obj.id },
        subscriptionId: obj.id,
        set: { stripeCustomerId: idOf(obj.customer), stripeSubscriptionId: obj.id },
        syncSubscription: obj,
      };

    case 'customer.subscription.deleted':
      // Lock analysis; data stays until retention ends.
      return {
        match: { shopId: shopIdFrom(obj.metadata), customerId: idOf(obj.customer), subscriptionId: obj.id },
        subscriptionId: obj.id,
        onlyIfLinked: true,
        set: { subscriptionStatus: 'canceled', graceUntil: null },
      };

    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const sub = obj.parent?.subscription_details || obj.subscription_details || {};
      const subscriptionId = idOf(sub.subscription) || idOf(obj.subscription);
      const periodEnd = obj.lines?.data?.[0]?.period?.end;
      return {
        match: { shopId: shopIdFrom(sub.metadata), customerId: idOf(obj.customer), subscriptionId },
        subscriptionId,
        set: {
          stripeCustomerId: idOf(obj.customer),
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          subscriptionStatus: 'active',
          graceUntil: null, // clear any payment-failed grace period
          ...(periodEnd ? { currentPeriodEnd: fromUnix(periodEnd) } : {}),
        },
        firstPayment: true,
        payment: {
          invoiceId: obj.id,
          amount: obj.amount_paid,
          currency: obj.currency,
          paidAt: fromUnix(obj.status_transitions?.paid_at) || fromUnix(event.created),
          hostedInvoiceUrl: obj.hosted_invoice_url,
        },
      };
    }

    case 'invoice.payment_failed': {
      const sub = obj.parent?.subscription_details || obj.subscription_details || {};
      const subscriptionId = idOf(sub.subscription) || idOf(obj.subscription);
      return {
        match: { shopId: shopIdFrom(sub.metadata), customerId: idOf(obj.customer), subscriptionId },
        subscriptionId,
        set: { subscriptionStatus: 'past_due' },
        grace: 'start', // analysis keeps working for GRACE_DAYS, then locks
      };
    }

    default:
      return null;
  }
}
