// The Nicked offer (see the offer spec): per-camera graduated pricing plus three add-ons.
// Everything here is pure so it can be unit-tested without Stripe.

export const KINDS = ['camera', 'always_on', 'retention', 'location'];

export const LOOKUP_KEYS = {
  month: { camera: 'camera_monthly', always_on: 'always_on_monthly', retention: 'retention_monthly', location: 'location_monthly' },
  year: { camera: 'camera_yearly', always_on: 'always_on_yearly', retention: 'retention_yearly', location: 'location_yearly' },
};
export const ALL_LOOKUP_KEYS = [...Object.values(LOOKUP_KEYS.month), ...Object.values(LOOKUP_KEYS.year)];

export const PRODUCT_INFO = {
  camera: { name: 'Nicked camera', description: 'AI analysis up to 12 hours a day, review queue, checklist, unlimited incident reports, flagged clips kept 30 days.' },
  always_on: { name: '24/7 monitoring', description: 'Raises a camera’s daily analysis budget from 12 to 24 hours.' },
  retention: { name: '90-day retention', description: 'Keeps flagged clips for 90 days instead of 30.' },
  location: { name: 'Multi-location', description: 'Each unit adds one more shop location.' },
};

// Amounts in cents, as created by `npm run stripe:seed`.
export const PRICE_DEFS = {
  camera_monthly: { kind: 'camera', interval: 'month', tiers: [{ up_to: 2, unit_amount: 2900 }, { up_to: 4, unit_amount: 1900 }, { up_to: 'inf', unit_amount: 1500 }] },
  camera_yearly: { kind: 'camera', interval: 'year', tiers: [{ up_to: 2, unit_amount: 29000 }, { up_to: 4, unit_amount: 19000 }, { up_to: 'inf', unit_amount: 15000 }] },
  always_on_monthly: { kind: 'always_on', interval: 'month', unit_amount: 1600 },
  always_on_yearly: { kind: 'always_on', interval: 'year', unit_amount: 16000 },
  retention_monthly: { kind: 'retention', interval: 'month', unit_amount: 500 },
  retention_yearly: { kind: 'retention', interval: 'year', unit_amount: 5000 },
  location_monthly: { kind: 'location', interval: 'month', unit_amount: 1900 },
  location_yearly: { kind: 'location', interval: 'year', unit_amount: 19000 },
};

export const CAMERA_INCLUDES = [
  'AI analysis up to 12 hours a day',
  'Review queue with the exact frames the AI flagged',
  'Confirmation checklist',
  'Unlimited incident reports',
  'Flagged clips kept 30 days',
];

/**
 * Which part of the offer a Stripe Price is. Uses the price's metadata first,
 * because lookup keys move to new Prices when prices change, while Founding
 * Shops stay on their old Prices.
 */
export function kindOf(price) {
  const meta = price?.metadata?.nicked_kind;
  if (KINDS.includes(meta)) return meta;
  const key = price?.lookup_key || '';
  return KINDS.find((k) => key.startsWith(`${k}_`)) || null;
}

/** Graduated tiers: each unit is charged at the rate of the tier it falls into. Stripe sends the last tier's up_to as null. */
export function graduatedAmount(tiers, quantity) {
  let remaining = Math.max(0, quantity);
  let previousCap = 0;
  let total = 0;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const cap = tier.up_to == null || tier.up_to === 'inf' ? Infinity : tier.up_to;
    const units = Math.min(remaining, cap - previousCap);
    if (units > 0) total += units * (tier.unit_amount ?? 0) + (tier.flat_amount ?? 0);
    remaining -= units;
    previousCap = cap;
  }
  return total;
}

export function priceAmount(price, quantity) {
  if (price.billing_scheme === 'tiered' || price.tiers) return graduatedAmount(price.tiers || [], quantity);
  return (price.unit_amount ?? 0) * quantity;
}

export const formatEur = (cents, currency = 'eur') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

/** Normalises the selection from the pricing page. Throws a readable message if it's invalid. */
export function normalizeSelection(input = {}) {
  const addons = input.addons || {};
  const pick = (...keys) => keys.map((k) => addons[k] ?? input[k]).find((v) => v !== undefined);
  const cameras = Number(input.cameras ?? 1);
  const interval = input.interval === 'year' || input.interval === 'yearly' ? 'year' : input.interval === undefined || input.interval === 'month' || input.interval === 'monthly' ? 'month' : null;
  const alwaysOn = Number(pick('always_on', 'alwaysOn') ?? 0);
  const retentionRaw = pick('retention', 'retention_90', 'retention90');
  const retention = retentionRaw === true || retentionRaw === 'true' || retentionRaw === 1 || retentionRaw === '1';
  const extraLocations = Number(pick('extra_locations', 'extraLocations', 'locations', 'multi_location') ?? 0);

  if (!Number.isInteger(cameras) || cameras < 1 || cameras > 50) throw new Error('Choose between 1 and 50 cameras.');
  if (!interval) throw new Error('interval must be "month" or "year".');
  if (!Number.isInteger(alwaysOn) || alwaysOn < 0) throw new Error('24/7 monitoring must be a whole number of cameras.');
  if (alwaysOn > cameras) throw new Error('24/7 monitoring can cover at most as many cameras as you buy.');
  if (!Number.isInteger(extraLocations) || extraLocations < 0 || extraLocations > 20) throw new Error('Extra locations must be between 0 and 20.');
  return { cameras, interval, alwaysOn, retention, extraLocations };
}

/** Line items (lookup key + quantity) for a selection. Add-ons only when chosen. */
export function lineItemsFor(sel) {
  const keys = LOOKUP_KEYS[sel.interval];
  const items = [{ kind: 'camera', lookupKey: keys.camera, quantity: sel.cameras }];
  if (sel.alwaysOn > 0) items.push({ kind: 'always_on', lookupKey: keys.always_on, quantity: sel.alwaysOn });
  if (sel.retention) items.push({ kind: 'retention', lookupKey: keys.retention, quantity: 1 });
  if (sel.extraLocations > 0) items.push({ kind: 'location', lookupKey: keys.location, quantity: sel.extraLocations });
  return items;
}

/** Price breakdown for the pricing page, from the real Stripe Prices (or PRICE_DEFS as a stand-in). */
export function quote(sel, pricesByKey) {
  const lines = lineItemsFor(sel).map((item) => {
    const price = pricesByKey[item.lookupKey];
    if (!price) throw new Error(`Missing Stripe price "${item.lookupKey}". Run npm run stripe:seed.`);
    const amount = priceAmount(price, item.quantity);
    return { ...item, label: PRODUCT_INFO[item.kind].name, amount, display: formatEur(amount, price.currency || 'eur') };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const currency = pricesByKey[lines[0].lookupKey].currency || 'eur';
  const perMonth = sel.interval === 'year' ? Math.round(total / 12) : total;
  return {
    selection: sel,
    currency,
    interval: sel.interval,
    lines,
    total,
    display: `${formatEur(total, currency)} / ${sel.interval}`,
    perMonthEquivalent: formatEur(perMonth, currency),
    vat: 'excluding VAT',
  };
}

const STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
};

/** Re-derives everything a shop may do from its subscription's items (run on every webhook). */
export function entitlementsFromSubscription(sub) {
  const ent = { camerasAllowed: 0, camerasAlwaysOn: 0, retentionDays: 30, locationsAllowed: 1, planInterval: null };
  let periodEnd = null;
  for (const item of sub.items?.data || []) {
    const kind = kindOf(item.price);
    const qty = item.quantity ?? 1;
    if (kind === 'camera') {
      ent.camerasAllowed += qty;
      ent.planInterval = item.price?.recurring?.interval || ent.planInterval;
    } else if (kind === 'always_on') ent.camerasAlwaysOn += qty;
    else if (kind === 'retention') ent.retentionDays = 90;
    else if (kind === 'location') ent.locationsAllowed += qty;
    periodEnd ??= item.current_period_end ?? null;
  }
  ent.camerasAlwaysOn = Math.min(ent.camerasAlwaysOn, ent.camerasAllowed);
  periodEnd ??= sub.current_period_end ?? null;
  if (periodEnd) ent.currentPeriodEnd = new Date(periodEnd * 1000);
  const status = sub.status === 'canceled' ? 'canceled' : STATUS[sub.status];
  if (status) ent.subscriptionStatus = status; // "incomplete" = not paid yet: leave the status alone
  return ent;
}
