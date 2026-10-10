import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { busyShop, DEFAULT_PLAN, eventsForUpload, makeCameras, SAMPLE_SHOP, todayAt } from '../data/sample';
import {
  ALWAYS_ON_CAP_SECONDS,
  DAILY_CAP_SECONDS,
  type Camera,
  type Checklist,
  type Clip,
  type Entitlements,
  type EventStatus,
  type FlagEvent,
  type Plan,
  type Report,
  type Shop,
  type SubscriptionStatus,
} from '../data/types';

// In-browser stand-in for the backend so every screen can be clicked through.
// Each action below maps to one endpoint in the API contract; when the
// backend is wired in, these become TanStack Query calls.

interface DemoState {
  version: 3;
  signedIn: boolean;
  shop: Shop;
  subscription: SubscriptionStatus;
  plan: Plan | null;
  pendingPlan: Plan | null;
  cameras: Camera[];
  clips: Clip[];
  events: FlagEvent[];
  reports: Report[];
  nextReportNo: number;
}

const KEY = 'nicked-demo';

function newShop(): DemoState {
  return {
    version: 3,
    signedIn: false,
    shop: { ...SAMPLE_SHOP },
    subscription: 'none',
    plan: null,
    pendingPlan: null,
    cameras: makeCameras(4),
    clips: [],
    events: [],
    reports: [],
    nextReportNo: 142,
  };
}

function busy(): DemoState {
  const b = busyShop();
  return {
    ...newShop(),
    signedIn: true,
    subscription: 'active',
    plan: { ...DEFAULT_PLAN },
    shop: { ...SAMPLE_SHOP, freeScanUsed: true },
    ...b,
  };
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.version === 3) return parsed;
    }
  } catch {
    /* storage blocked: start fresh */
  }
  return newShop();
}

export function entitlementsFor(plan: Plan | null): Entitlements | null {
  if (!plan) return null;
  return {
    camerasAllowed: plan.cameras,
    camerasAlwaysOn: Math.min(plan.addons.always_on, plan.cameras),
    retentionDays: plan.addons.retention ? 90 : 30,
    locationsAllowed: 1 + plan.addons.location,
    planInterval: plan.interval,
  };
}

export const capFor = (c: Camera) => (c.alwaysOn ? ALWAYS_ON_CAP_SECONDS : DAILY_CAP_SECONDS);

function useDemoState() {
  const [s, setS] = useState<DemoState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* preview still works without storage */
    }
  }, [s]);

  // Analysis runs in the background: progress ticks for every clip being analysed,
  // flags land at set points, usage counts against the camera's daily budget.
  const analysing = s.clips.some((c) => c.status === 'queued' || c.status === 'analysing');
  const tick = useRef<number | null>(null);
  useEffect(() => {
    if (!analysing) return;
    tick.current = window.setInterval(() => {
      setS((prev) => {
        let { events, cameras } = prev;
        const clips = prev.clips.map((c) => {
          if (c.status !== 'queued' && c.status !== 'analysing') return c;
          const progress = Math.min(100, c.progress + (c.status === 'queued' ? 4 : 1.6));
          const found = eventsForUpload(
            cameras.find((cam) => cam.id === c.cameraId) ?? cameras[1] ?? cameras[0],
            c.id,
            c.startClock,
            c.durationSeconds,
          );
          const due = found.filter((_, i) => progress >= [34, 61, 86][i] && !c.eventIds.includes(found[i].id));
          if (due.length) events = [...due, ...events];
          const done = progress >= 100;
          if (done && c.cameraId) {
            cameras = cameras.map((cam) =>
              cam.id === c.cameraId
                ? { ...cam, usedSecondsToday: Math.min(capFor(cam), cam.usedSecondsToday + c.durationSeconds) }
                : cam,
            );
          }
          return {
            ...c,
            progress,
            status: done ? ('done' as const) : ('analysing' as const),
            eventIds: [...c.eventIds, ...due.map((e) => e.id)],
          };
        });
        return { ...prev, clips, events, cameras };
      });
    }, 110);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [analysing]);

  const signUp = useCallback((v: { shopName: string; ownerName: string; email: string }) => {
    setS((p) => ({
      ...p,
      signedIn: true,
      shop: { ...p.shop, name: v.shopName || p.shop.name, ownerName: v.ownerName || p.shop.ownerName, email: v.email || p.shop.email },
    }));
  }, []);

  const logIn = useCallback((email: string) => {
    setS((p) => ({ ...p, signedIn: true, shop: { ...p.shop, email: email || p.shop.email } }));
  }, []);

  const logOut = useCallback(() => setS((p) => ({ ...p, signedIn: false })), []);

  /** POST /billing/checkout → { url }. The preview skips Stripe and goes to the success page. */
  const startCheckout = useCallback((plan: Plan) => {
    setS((p) => ({ ...p, pendingPlan: plan, subscription: p.subscription === 'active' ? 'active' : 'pending' }));
  }, []);

  /** What the Stripe webhook does on the backend: activate and sync entitlements. */
  const activate = useCallback(() => {
    setS((p) => {
      const plan = p.pendingPlan ?? p.plan ?? DEFAULT_PLAN;
      const kept = p.cameras.slice(0, plan.cameras);
      const extra = makeCameras(plan.cameras).slice(kept.length);
      const cameras = [...kept, ...extra].map((c, i) => ({ ...c, active: true, alwaysOn: i < plan.addons.always_on }));
      return { ...p, plan, pendingPlan: null, subscription: 'active', cameras };
    });
  }, []);

  /** "Add a camera": updates the subscription quantity (Stripe prorates). */
  const addCamera = useCallback(() => {
    setS((p) => {
      if (!p.plan) return p;
      const plan = { ...p.plan, cameras: p.plan.cameras + 1 };
      const cameras = [...p.cameras, makeCameras(plan.cameras)[plan.cameras - 1]];
      return { ...p, plan, cameras };
    });
  }, []);

  /** POST /clips (or POST /scan/free) → { clipId } */
  const uploadClip = useCallback(
    (v: { fileName: string; sizeBytes: number; durationSeconds: number; cameraId: string | null }) => {
      const id = `clip_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date();
      const startClock = `${String(Math.max(8, now.getHours() - 1)).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const clip: Clip = {
        id,
        cameraId: v.cameraId,
        fileName: v.fileName,
        sizeBytes: v.sizeBytes,
        durationSeconds: v.durationSeconds,
        startClock,
        uploadedAt: now.toISOString(),
        status: 'queued',
        progress: 0,
        eventIds: [],
        isFreeScan: v.cameraId == null,
      };
      setS((p) => ({
        ...p,
        clips: [clip, ...p.clips],
        shop: v.cameraId == null ? { ...p.shop, freeScanUsed: true } : p.shop,
      }));
      return id;
    },
    [],
  );

  /** POST /events/:id/decision */
  const decide = useCallback((eventId: string, status: EventStatus, checklist: Checklist) => {
    setS((p) => ({
      ...p,
      events: p.events.map((e) =>
        e.id === eventId ? { ...e, status, checklist, decidedAt: new Date().toISOString() } : e,
      ),
    }));
  }, []);

  /** Undo a decision (back to Flagged). */
  const reopen = useCallback((eventId: string) => {
    setS((p) => ({
      ...p,
      events: p.events.map((e) => (e.id === eventId ? { ...e, status: 'needs_review', decidedAt: undefined } : e)),
    }));
  }, []);

  /** POST /events/:id/report → { reportId } */
  const createReport = useCallback((eventId: string) => {
    const id = `rep_${Math.random().toString(36).slice(2, 7)}`;
    setS((p) => {
      const existing = p.events.find((e) => e.id === eventId)?.reportId;
      if (existing) return p;
      const report: Report = {
        id,
        ref: `NCK-${new Date().getFullYear()}-${String(p.nextReportNo).padStart(4, '0')}`,
        eventId,
        createdAt: new Date().toISOString(),
      };
      return {
        ...p,
        nextReportNo: p.nextReportNo + 1,
        reports: [report, ...p.reports],
        events: p.events.map((e) => (e.id === eventId ? { ...e, reportId: id } : e)),
      };
    });
    return id;
  }, []);

  const setSubscription = useCallback((subscription: SubscriptionStatus) => setS((p) => ({ ...p, subscription })), []);
  const loadPreset = useCallback((preset: 'new' | 'busy') => setS(preset === 'busy' ? busy() : newShop()), []);

  const entitlements = useMemo(() => (s.subscription === 'active' || s.subscription === 'past_due' ? entitlementsFor(s.plan) : null), [s.plan, s.subscription]);
  const queueCount = s.events.filter((e) => e.status === 'needs_review').length;
  const lastFlagAt = s.events.length ? s.events.map((e) => e.recordedAt).sort().at(-1)! : todayAt('09:14');

  return {
    ...s,
    entitlements,
    isActive: s.subscription === 'active' || s.subscription === 'past_due',
    queueCount,
    lastFlagAt,
    signUp,
    logIn,
    logOut,
    startCheckout,
    activate,
    addCamera,
    uploadClip,
    decide,
    reopen,
    createReport,
    setSubscription,
    loadPreset,
  };
}

export type Demo = ReturnType<typeof useDemoState>;
const Ctx = createContext<Demo | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const value = useDemoState();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemo outside DemoProvider');
  return v;
}

export const cameraLabel = (c: Camera | undefined) => (c ? `${c.code} · ${c.name}` : 'Free scan');
