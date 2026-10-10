import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Checklist, EventStatus, Plan } from '../data/types';
import type { Demo, UploadInput } from '../demo/store';

import { api, apiUrl, uploadClip } from './client';
import { fromChecklist, toCamera, toClip, toEvent, toPlan, toReport, toShop, toSubscription } from './map';

// The real backend behind the same interface as the demo store, so every
// screen works in both modes. The backend has one shop and no accounts yet:
// "signing in" here only remembers the owner's name on this device.

const SESSION_KEY = 'nicked-session';
const PENDING_PLAN_KEY = 'nicked-pending-plan';

interface Session {
  signedIn: boolean;
  ownerName?: string;
  address?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the session just won't persist */
  }
}

const DECISION: Record<EventStatus, string> = {
  needs_review: 'pending',
  unsure: 'unsure',
  confirmed: 'confirmed',
  dismissed: 'dismissed',
};

interface Data {
  shop: any | null;
  cameras: any[];
  clips: any[];
  events: any[];
  incidents: any[];
}

const EMPTY: Data = { shop: null, cameras: [], clips: [], events: [], incidents: [] };

export function useLiveState(): Demo {
  const [session, setSession] = useState<Session>(() => read(SESSION_KEY, { signedIn: false }));
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(() => read(PENDING_PLAN_KEY, null));
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => write(SESSION_KEY, session), [session]);
  useEffect(() => write(PENDING_PLAN_KEY, pendingPlan), [pendingPlan]);

  const refresh = useCallback(async () => {
    try {
      const [shop, cams, clips, events, incidents] = await Promise.all([
        api('/api/shop'),
        api('/api/cameras'),
        api('/api/clips'),
        api('/api/events?view=all'),
        api('/api/incidents'),
      ]);
      setData({
        shop: shop.shop ?? shop,
        cameras: cams.cameras ?? [],
        clips: clips.clips ?? [],
        events: events.events ?? [],
        incidents: incidents.incidents ?? [],
      });
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while anything is analysing; otherwise check in now and then.
  const busy = data.clips.some((c) => c.status === 'queued' || c.status === 'processing');
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    refreshRef.current();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => refreshRef.current(), busy ? 3000 : 30000);
    return () => window.clearInterval(id);
  }, [busy]);

  // --- Derived, in the shapes the screens render ---
  const subscription = toSubscription(data.shop?.subscriptionStatus);
  const isActive = subscription === 'active' || (subscription === 'past_due' && Boolean(data.shop?.inGracePeriod));
  const plan = data.shop ? toPlan(data.shop) : null;
  const cameras = useMemo(() => data.cameras.map(toCamera), [data.cameras]);

  const reportByEvent = useMemo(() => new Map(data.incidents.map((i) => [String(i.event), i.id])), [data.incidents]);
  const annotatedByClip = useMemo(
    () => new Map(data.clips.filter((c) => c.annotatedVideoUrl).map((c) => [c.id, c.annotatedVideoUrl as string])),
    [data.clips],
  );
  const events = useMemo(
    () =>
      data.events
        // The AI's confident "no"s are kept on the server as false-alarm data, not shown to the owner.
        .filter((e) => e.inQueue !== false || e.status !== 'pending')
        .map((e) => {
          const ev = toEvent(e, reportByEvent.get(e.id));
          const annotated = annotatedByClip.get(ev.clipId);
          if (ev.media && annotated) ev.media.annotatedUrl = apiUrl(annotated);
          return ev;
        }),
    [data.events, reportByEvent, annotatedByClip],
  );
  const clips = useMemo(
    () => data.clips.map((c) => toClip(c, events.filter((e) => e.clipId === c.id).map((e) => e.id))),
    [data.clips, events],
  );
  const reports = useMemo(() => data.incidents.map(toReport), [data.incidents]);
  const shop = data.shop
    ? toShop(data.shop, session)
    : { id: '', name: 'Your shop', ownerName: session.ownerName ?? '', email: '', address: '', isFounding: false, freeScanUsed: false };

  const e = data.shop?.entitlements;
  const entitlements =
    isActive && e?.camerasAllowed
      ? {
          camerasAllowed: e.camerasAllowed,
          camerasAlwaysOn: e.camerasAlwaysOn ?? 0,
          retentionDays: (e.retentionDays >= 90 ? 90 : 30) as 30 | 90,
          locationsAllowed: e.locationsAllowed ?? 1,
          planInterval: e.planInterval === 'year' ? ('year' as const) : ('month' as const),
        }
      : null;

  const queueCount = events.filter((x) => x.status === 'needs_review').length;
  const lastFlagAt = events.length ? events.map((x) => x.recordedAt).sort().at(-1)! : new Date(new Date().setHours(9, 0, 0, 0)).toISOString();

  // --- Actions ---
  const signUp = useCallback(
    (v: { shopName: string; ownerName: string; email: string }) => {
      setSession({ signedIn: true, ownerName: v.ownerName });
      api('/api/shop', { method: 'PATCH', body: { name: v.shopName, email: v.email } }).then(refresh, () => {});
    },
    [refresh],
  );
  const logIn = useCallback((_email: string) => setSession((s) => ({ ...s, signedIn: true })), []);
  const logOut = useCallback(() => setSession((s) => ({ ...s, signedIn: false })), []);

  const startCheckout = useCallback((p: Plan) => setPendingPlan(p), []);

  /** POST /api/billing/checkout, then off to Stripe. */
  const beginCheckout = useCallback(async (p: Plan): Promise<'redirect' | 'local'> => {
    setPendingPlan(p);
    const { url } = await api('/api/billing/checkout', {
      body: {
        cameras: p.cameras,
        interval: p.interval,
        addons: { always_on: p.addons.always_on, retention: p.addons.retention, extra_locations: p.addons.location },
      },
    });
    window.location.assign(url);
    return 'redirect';
  }, []);

  /** Access only changes when Stripe's webhook lands, so poll /verify until it has. */
  const confirmCheckout = useCallback(
    async (sessionId: string | null, onStep?: (step: 1 | 2 | 3) => void) => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (sessionId) {
          const v = await api(`/api/billing/verify?session_id=${encodeURIComponent(sessionId)}`);
          if (v.paid) onStep?.(2);
          if (v.unlocked) break;
        } else {
          const { shop: s } = await api('/api/shop');
          if (s?.subscriptionStatus === 'active') break;
        }
        await new Promise((r) => window.setTimeout(r, 2000));
      }
      await refresh();
      const { shop: s } = await api('/api/shop');
      const unlocked = s?.subscriptionStatus === 'active';
      if (unlocked) {
        onStep?.(3);
        setPendingPlan(null);
      }
      return unlocked;
    },
    [refresh],
  );

  const activate = useCallback(() => {
    refresh();
  }, [refresh]);

  const addCamera = useCallback(async () => {
    if (!plan) return;
    await api('/api/billing/cameras', { body: { cameras: plan.cameras + 1 } });
    // The webhook creates the camera; give it a moment, then refresh.
    window.setTimeout(() => refreshRef.current(), 2500);
    await refresh();
  }, [plan, refresh]);

  const uploadClipAction = useCallback((_v: { fileName: string; sizeBytes: number; durationSeconds: number; cameraId: string | null }) => {
    throw new Error('Use uploadFile in live mode.');
  }, []) as unknown as Demo['uploadClip'];

  const uploadFile = useCallback(
    async (v: UploadInput, onProgress: (pct: number) => void) => {
      if (!v.file) throw new Error('Choose a clip from this computer.');
      const res = await uploadClip(v.file, v.cameraId ? { cameraId: v.cameraId } : {}, onProgress);
      await refresh();
      return res.clip.id as string;
    },
    [refresh],
  );

  const decide = useCallback(
    async (eventId: string, status: EventStatus, checklist: Checklist) => {
      await api(`/api/events/${eventId}/review`, { body: { decision: DECISION[status], checklist: fromChecklist(checklist) } });
      await refresh();
    },
    [refresh],
  );

  const reopen = useCallback(
    async (eventId: string) => {
      await api(`/api/events/${eventId}/review`, { body: { decision: 'pending' } });
      await refresh();
    },
    [refresh],
  );

  const createReport = useCallback(
    async (eventId: string): Promise<string> => {
      const { incident } = await api(`/api/events/${eventId}/incident`, { method: 'POST' });
      await refresh();
      return incident.id;
    },
    [refresh],
  );

  const openBillingPortal = useCallback(async () => {
    const { url } = await api('/api/billing/portal', { method: 'POST' });
    return url as string;
  }, []);

  const markShared = useCallback(
    async (reportId: string, shared: boolean) => {
      await api(`/api/incidents/${reportId}`, { method: 'PATCH', body: { sharedWithGardai: shared } });
      await refresh();
    },
    [refresh],
  );

  const noop = useCallback(() => {}, []);

  return {
    version: 3,
    mode: 'live',
    loading,
    loadError,
    signedIn: session.signedIn,
    shop,
    subscription,
    plan,
    pendingPlan,
    cameras,
    clips,
    events,
    reports,
    nextReportNo: 0,
    entitlements,
    isActive,
    queueCount,
    lastFlagAt,
    signUp,
    logIn,
    logOut,
    startCheckout,
    activate,
    addCamera,
    uploadClip: uploadClipAction,
    decide,
    reopen,
    createReport,
    setSubscription: noop,
    loadPreset: noop,
    uploadFile,
    beginCheckout,
    confirmCheckout,
    openBillingPortal,
    markShared,
    refresh,
  };
}


