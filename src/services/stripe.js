import Stripe from 'stripe';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

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

export const PLAN_FEATURES = [
  'Upload CCTV clips and get a short list of moments to check',
  'AI check on every flagged moment, with timestamps and reasons',
  'Review checklist and one-click incident reports',
  'Clip export to hand over if you choose to',
  'Cancel any time',
];

let cachedPrice = null;

/** The monthly price, found by STRIPE_PRICE_ID or by lookup key (created by `npm run stripe:seed`). */
export async function getPlanPrice() {
  if (cachedPrice) return cachedPrice;
  const s = getStripe();
  let price;
  if (config.stripe.priceId) {
    price = await s.prices.retrieve(config.stripe.priceId, { expand: ['product'] });
  } else {
    const list = await s.prices.list({ lookup_keys: [config.stripe.priceLookupKey], active: true, expand: ['data.product'], limit: 1 });
    price = list.data[0];
  }
  if (!price) throw new AppError('No Stripe price found. Run `npm run stripe:seed` first.', 500, 'NO_PRICE');
  cachedPrice = price;
  return price;
}

export function publicPlan(price) {
  return {
    priceId: price.id,
    name: typeof price.product === 'object' ? price.product.name : `${config.appName} Shop Plan`,
    amount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval || null,
    display: `${new Intl.NumberFormat('en-IE', { style: 'currency', currency: price.currency.toUpperCase() }).format(price.unit_amount / 100)}${price.recurring ? ` / ${price.recurring.interval}` : ''}`,
    features: PLAN_FEATURES,
  };
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || undefined;
const fromUnix = (s) => (s ? new Date(s * 1000) : undefined);

const SUB_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
  incomplete: 'inactive',
  paused: 'inactive',
};

/**
 * Turns a Stripe event into "which shop" + "what to change". Pure, so it's
 * easy to test. Handles field names from both older and newer API versions.
 * Returns null for events we ignore.
 */
export function shopUpdateFromStripeEvent(event) {
  const obj = event.data?.object || {};

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.mode !== 'subscription') return null;
      const paid = obj.payment_status === 'paid';
      return {
        match: { shopId: obj.metadata?.shopId || obj.client_reference_id, customerId: idOf(obj.customer) },
        set: {
          stripeCustomerId: idOf(obj.customer),
          stripeSubscriptionId: idOf(obj.subscription),
          ...(obj.customer_details?.email ? { email: obj.customer_details.email } : {}),
          ...(paid ? { subscriptionStatus: 'active' } : {}),
        },
        activate: paid,
      };
    }

    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const subDetails = obj.parent?.subscription_details || obj.subscription_details || {};
      const subscriptionId = idOf(subDetails.subscription) || idOf(obj.subscription);
      const periodEnd = obj.lines?.data?.[0]?.period?.end;
      return {
        match: { shopId: subDetails.metadata?.shopId, customerId: idOf(obj.customer), subscriptionId },
        set: {
          stripeCustomerId: idOf(obj.customer),
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          subscriptionStatus: 'active',
          ...(periodEnd ? { currentPeriodEnd: fromUnix(periodEnd) } : {}),
        },
        activate: true,
        payment: {
          invoiceId: obj.id,
          amount: obj.amount_paid,
          currency: obj.currency,
          paidAt: fromUnix(obj.status_transitions?.paid_at) || fromUnix(event.created),
          hostedInvoiceUrl: obj.hosted_invoice_url,
        },
      };
    }

    case 'invoice.payment_failed':
      return {
        match: { customerId: idOf(obj.customer), subscriptionId: idOf(obj.parent?.subscription_details?.subscription) || idOf(obj.subscription) },
        set: { subscriptionStatus: 'past_due' },
      };

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : SUB_STATUS[obj.status] || 'inactive';
      const periodEnd = obj.items?.data?.[0]?.current_period_end ?? obj.current_period_end;
      return {
        match: { shopId: obj.metadata?.shopId, customerId: idOf(obj.customer), subscriptionId: obj.id },
        set: {
          stripeSubscriptionId: obj.id,
          stripeCustomerId: idOf(obj.customer),
          // "incomplete" just means "not paid yet". Webhooks can arrive out of order, so never let
          // it overwrite an active status set by invoice.paid.
          ...(status === 'inactive' ? {} : { subscriptionStatus: status }),
          ...(periodEnd ? { currentPeriodEnd: fromUnix(periodEnd) } : {}),
        },
      };
    }

    default:
      return null;
  }
}
