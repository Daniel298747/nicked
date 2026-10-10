import type {
  Answer,
  Camera,
  Checklist,
  Clip,
  EventStatus,
  FlagEvent,
  Observation,
  Plan,
  Report,
  SceneKind,
  ScriptParams,
  Shop,
  SubscriptionStatus,
} from '../data/types';
import { apiUrl } from './client';

// Backend shapes → the shapes the screens render. Backend docs: backend/README.md.

/** "00:42.3" or "1:02:03.5" → seconds */
export function parseTime(label: string | null | undefined): number {
  if (!label) return 0;
  return String(label)
    .split(':')
    .map(Number)
    .reduce((acc, n) => acc * 60 + (Number.isFinite(n) ? n : 0), 0);
}

const SUBSCRIPTION: Record<string, SubscriptionStatus> = {
  inactive: 'none',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
};

export function toSubscription(s: string | undefined): SubscriptionStatus {
  return SUBSCRIPTION[s ?? ''] ?? 'none';
}

export function toShop(b: any, local: { ownerName?: string; address?: string }): Shop {
  return {
    id: b.id,
    name: b.name,
    ownerName: local.ownerName || 'The shop owner',
    email: b.email || '',
    address: local.address || '',
    isFounding: Boolean(b.isFounding),
    // Only a shop that has never subscribed can still have a free scan.
    freeScanUsed: !b.freeScanAvailable,
  };
}

/** The plan the shop paid for, rebuilt from its entitlements (null before the first payment). */
export function toPlan(b: any): Plan | null {
  const e = b.entitlements;
  if (!e?.camerasAllowed) return null;
  return {
    cameras: e.camerasAllowed,
    interval: e.planInterval === 'year' ? 'year' : 'month',
    addons: {
      always_on: e.camerasAlwaysOn || 0,
      retention: e.retentionDays >= 90,
      location: Math.max(0, (e.locationsAllowed || 1) - 1),
    },
  };
}

export function sceneFor(name: string): SceneKind {
  const n = name.toLowerCase();
  if (/door|entrance|exit/.test(n)) return 'door';
  if (/till|counter|deli|checkout/.test(n)) return 'till';
  if (/fridge|off.?licen|drink|chill/.test(n)) return 'fridges';
  return 'aisle';
}

export function toCamera(b: any, index: number): Camera {
  return {
    id: b.id,
    code: `CAM ${String(index + 1).padStart(2, '0')}`,
    name: b.name,
    scene: sceneFor(b.name),
    alwaysOn: Boolean(b.alwaysOn),
    active: b.active !== false,
    usedSecondsToday: b.usage?.analysedSeconds ?? 0,
  };
}

/** Analysis progress 0–100 from the backend's stage + checked/total. */
export function clipProgress(b: any): number {
  if (b.status === 'done') return 100;
  if (b.status === 'failed') return 0;
  if (b.stage === 'verifying') {
    const { checked = 0, total = 0 } = b.progress ?? {};
    return 25 + Math.round(70 * (total ? checked / total : 0));
  }
  if (b.stage === 'detecting') return 10;
  return 3;
}

export function toClip(b: any, eventIds: string[]): Clip {
  return {
    id: b.id,
    cameraId: b.camera ?? null,
    fileName: b.originalName,
    sizeBytes: b.sizeBytes ?? 0,
    durationSeconds: b.durationSec ?? 0,
    // Recorders don't tell us the wall-clock start, so times are clip time.
    startClock: '00:00:00',
    uploadedAt: b.createdAt,
    status: b.status === 'processing' ? 'analysing' : b.status,
    progress: clipProgress(b),
    eventIds,
    isFreeScan: Boolean(b.freeScan),
    error: b.error ? { code: 'analysis_failed', message: b.error } : undefined,
    videoUrl: apiUrl(b.videoUrl) ?? undefined,
    warnings: b.warnings ?? [],
  };
}

const STATUS: Record<string, EventStatus> = {
  pending: 'needs_review',
  unsure: 'unsure',
  confirmed: 'confirmed',
  dismissed: 'dismissed',
};

// The screens' checklist keys ↔ the backend's
export const CHECKLIST_KEYS: Array<[keyof Checklist, string]> = [
  ['pickedUp', 'pickedUpItem'],
  ['concealed', 'concealedItem'],
  ['passedTill', 'avoidedTill'],
  ['leftShop', 'leftShop'],
];

const toAnswer = (v: unknown): Answer | null => (v === true ? 'yes' : v === false ? 'no' : null);

export function toChecklist(b: any): Checklist | undefined {
  if (!b) return undefined;
  return Object.fromEntries(CHECKLIST_KEYS.map(([k, bk]) => [k, toAnswer(b[bk])])) as unknown as Checklist;
}

/** "Can't tell" is stored as no answer (null). */
export function fromChecklist(c: Checklist): Record<string, boolean | null> {
  return Object.fromEntries(CHECKLIST_KEYS.map(([k, bk]) => [bk, c[k] === 'yes' ? true : c[k] === 'no' ? false : null]));
}

const PASS_NAME = { overview: 'First look', close_look: 'Close look' } as const;

/** What the tracker and the AI saw, in time order, for "Why this was flagged". */
function observations(b: any): Observation[] {
  const out: Observation[] = [];
  const c = b.candidate ?? {};
  out.push({
    at: b.startSec,
    text: c.shelfSeconds != null
      ? `Person tracked at the shelf for about ${Math.round(c.shelfSeconds)} seconds.`
      : 'Person tracked at the shelf.',
  });
  if (c.handToWaist && c.handToWaistSec != null) {
    out.push({ at: c.handToWaistSec, text: 'Hand moves to the waist after the shelf (pose estimate, a hint only).' });
  }
  for (const p of b.ai?.passes ?? []) {
    if (!p.reason) continue;
    out.push({ at: parseTime(p.window?.startTime) || b.startSec, text: `${PASS_NAME[p.kind as keyof typeof PASS_NAME] ?? 'AI check'}: ${p.reason}` });
  }
  if (!b.ai?.passes?.length && b.ai?.reason) {
    out.push({ at: parseTime(b.ai.framesReferenced?.[0]) || b.startSec + 1, text: b.ai.reason });
  }
  out.push({ at: Math.max(b.startSec, b.endSec - 2), text: 'Person reaches the exit without stopping at the till.' });

  // Unique times (they key the list), in order
  const seen = new Set<number>();
  return out
    .map((o) => ({ ...o, at: Math.round(o.at * 10) / 10 }))
    .sort((a, b2) => a.at - b2.at)
    .map((o) => {
      while (seen.has(o.at)) o.at = Math.round((o.at + 0.1) * 10) / 10;
      seen.add(o.at);
      return o;
    });
}

// Live events keep a still stand-in script so shared components can always draw something.
const STILL_SCRIPT: ScriptParams = { scene: 'aisle', side: 'right', enter: 999, reach: 999, conceal: 999, exit: 999 };

export function toEvent(b: any, reportId?: string): FlagEvent {
  const clip = typeof b.clip === 'object' && b.clip ? b.clip : { id: b.clip };
  const verdict = b.ai?.verdict ?? null;
  const confidence = verdict === 'error' ? 0 : b.ai?.confidence ?? 0;
  return {
    id: b.id,
    clipId: clip.id,
    cameraId: clip.camera?.id ?? '',
    status: STATUS[b.status] ?? 'needs_review',
    title: b.display?.title ?? 'Worth a look',
    reason: b.ai?.reason || (verdict === 'error' ? "The AI check didn't finish. Watch the clip and decide." : 'Flagged by the shelf → till → exit rule.'),
    confidence,
    recordedAt: b.createdAt,
    startClock: '00:00:00',
    clipDuration: clip.durationSec ?? b.endSec,
    segments: [{ start: b.startSec, end: b.endSec, confidence }],
    observations: observations(b),
    notSeen: b.candidate?.visitedTill === false ? ['A stop at the till'] : [],
    script: STILL_SCRIPT,
    checklist: b.status === 'pending' ? undefined : toChecklist(b.checklist),
    decidedAt: b.reviewedAt ?? undefined,
    reportId,
    media: {
      videoUrl: apiUrl(`/api/clips/${clip.id}/video`)!,
      annotatedUrl: null, // filled from the clip list
      thumbnailUrl: apiUrl(b.ai?.thumbnailUrl),
      evidence: (b.ai?.evidence ?? []).map((e: any) => ({ at: parseTime(e.label), label: e.label, url: apiUrl(e.url)! })),
      passes: (b.ai?.passes ?? []).map((p: any) => ({ kind: p.kind, verdict: p.verdict, confidence: p.confidence })),
      aiVerdict: verdict,
      flags: b.flags ?? [],
    },
  };
}

export function toReport(b: any): Report {
  return {
    id: b.id,
    ref: b.reference,
    eventId: b.event,
    createdAt: b.createdAt,
    narrative: b.narrative,
    markdownUrl: apiUrl(`/api/incidents/${b.id}/report.md`)!,
    clipUrl: apiUrl(`/api/incidents/${b.id}/clip`)!,
    sharedWithGardai: Boolean(b.sharedWithGardai),
    languageWarnings: b.languageWarnings ?? [],
  };
}
