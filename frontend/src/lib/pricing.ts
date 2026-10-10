import type { Interval, Plan } from '../data/types';

// Graduated camera tiers from the offer spec. Stripe's Checkout total is the
// source of truth; this only drives what the pricing page shows.
export const CAMERA_TIERS = [
  { from: 1, to: 2, monthly: 29, label: 'Cameras 1–2' },
  { from: 3, to: 4, monthly: 19, label: 'Cameras 3–4' },
  { from: 5, to: Infinity, monthly: 15, label: 'Cameras 5+' },
] as const;

export const ADDONS = {
  always_on: { name: '24/7 monitoring', monthly: 16, per: 'camera' },
  retention: { name: '90-day retention', monthly: 5, per: 'shop' },
  location: { name: 'Multi-location', monthly: 19, per: 'extra location' },
} as const;

/** Yearly prices are ten monthly payments: two months free. */
export const YEARLY_MONTHS = 10;
export const MIN_CAMERAS = 1;
export const MAX_CAMERAS = 50;

export interface QuoteLine {
  key: string;
  label: string;
  qty: number;
  unit: number;
  total: number;
}

export interface Quote {
  interval: Interval;
  lines: QuoteLine[];
  cameraTotal: number;
  addonTotal: number;
  total: number;
  /** What the same plan costs over a year if paid monthly. */
  yearAtMonthly: number;
  /** Only set for yearly plans. */
  saved: number;
}

const periodPrice = (monthly: number, interval: Interval) =>
  interval === 'year' ? monthly * YEARLY_MONTHS : monthly;

export function cameraLines(cameras: number, interval: Interval): QuoteLine[] {
  const n = clampCameras(cameras);
  return CAMERA_TIERS.flatMap((tier) => {
    const qty = Math.max(0, Math.min(n, tier.to) - tier.from + 1);
    if (qty === 0) return [];
    const unit = periodPrice(tier.monthly, interval);
    return [{ key: `tier-${tier.from}`, label: tier.label, qty, unit, total: qty * unit }];
  });
}

export function quote(plan: Plan): Quote {
  const cams = cameraLines(plan.cameras, plan.interval);
  const addons: QuoteLine[] = [];
  const alwaysOn = Math.min(plan.addons.always_on, plan.cameras);
  if (alwaysOn > 0) {
    const unit = periodPrice(ADDONS.always_on.monthly, plan.interval);
    addons.push({ key: 'always_on', label: ADDONS.always_on.name, qty: alwaysOn, unit, total: alwaysOn * unit });
  }
  if (plan.addons.retention) {
    const unit = periodPrice(ADDONS.retention.monthly, plan.interval);
    addons.push({ key: 'retention', label: ADDONS.retention.name, qty: 1, unit, total: unit });
  }
  if (plan.addons.location > 0) {
    const unit = periodPrice(ADDONS.location.monthly, plan.interval);
    addons.push({
      key: 'location',
      label: ADDONS.location.name,
      qty: plan.addons.location,
      unit,
      total: plan.addons.location * unit,
    });
  }
  const cameraTotal = sum(cams);
  const addonTotal = sum(addons);
  const total = cameraTotal + addonTotal;
  const monthlyTotal =
    plan.interval === 'month' ? total : total / YEARLY_MONTHS;
  const yearAtMonthly = monthlyTotal * 12;
  return {
    interval: plan.interval,
    lines: [...cams, ...addons],
    cameraTotal,
    addonTotal,
    total,
    yearAtMonthly,
    saved: plan.interval === 'year' ? yearAtMonthly - total : 0,
  };
}

/** Price of the next camera on top of the current count (for "Add a camera"). */
export function nextCameraPrice(current: number, interval: Interval = 'month') {
  const tier = CAMERA_TIERS.find((t) => current + 1 >= t.from && current + 1 <= t.to) ?? CAMERA_TIERS[2];
  return periodPrice(tier.monthly, interval);
}

export function clampCameras(n: number) {
  if (!Number.isFinite(n)) return MIN_CAMERAS;
  return Math.min(MAX_CAMERAS, Math.max(MIN_CAMERAS, Math.round(n)));
}

const sum = (lines: QuoteLine[]) => lines.reduce((acc, l) => acc + l.total, 0);
