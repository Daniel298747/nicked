import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SlidersHorizontal, X } from 'lucide-react';
import { useDemo } from './store';
import { cn } from '../lib/hooks';
import type { SubscriptionStatus } from '../data/types';

// Review tool, not product UI: lets you flip any screen into its loading,
// empty, error, locked or limit-reached state without a backend.

export type ScreenState = 'live' | 'loading' | 'empty' | 'error' | 'locked' | 'limit';

const LABELS: Record<ScreenState, string> = {
  live: 'Live',
  loading: 'Loading',
  empty: 'Empty',
  error: 'Error',
  locked: 'Locked (not subscribed)',
  limit: 'Limit reached',
};

interface Ctx {
  state: ScreenState;
  setState: (s: ScreenState) => void;
  supported: ScreenState[];
  setSupported: (s: ScreenState[]) => void;
}

const ScreenCtx = createContext<Ctx | null>(null);

export function ScreenStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ScreenState>('live');
  const [supported, setSupported] = useState<ScreenState[]>([]);
  const { pathname } = useLocation();
  useEffect(() => {
    setState('live');
  }, [pathname]);
  return <ScreenCtx.Provider value={{ state, setState, supported, setSupported }}>{children}</ScreenCtx.Provider>;
}

/** Each page declares which states it designs for; returns the one to render. */
export function useScreenState(supported: ScreenState[]): ScreenState {
  const ctx = useContext(ScreenCtx)!;
  const key = supported.join(',');
  useEffect(() => {
    ctx.setSupported(key ? (key.split(',') as ScreenState[]) : []);
    return () => ctx.setSupported([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return supported.includes(ctx.state) ? ctx.state : 'live';
}

export function PreviewControls({ raised = false }: { raised?: boolean }) {
  const ctx = useContext(ScreenCtx)!;
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  const states: ScreenState[] = ['live', 'loading', 'empty', 'error', 'locked', 'limit'];

  return (
    <div className={cn('no-print fixed right-4 z-50', raised ? 'bottom-20 lg:bottom-4' : 'bottom-4')}>
      {open ? (
        <div
          role="dialog"
          aria-label="Preview controls"
          className="w-72 rounded-lg border border-hairline bg-surface p-4 text-ink shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-ink-muted">Preview controls</p>
              <p className="mt-1 text-caption text-ink-muted">For reviewing the design. Not part of Nicked.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview controls"
              className="-mr-1 -mt-1 inline-flex size-8 items-center justify-center rounded-full hover:bg-section"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          <fieldset className="mt-4">
            <legend className="text-label">Screen state</legend>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {states.map((s) => {
                const available = s === 'live' || ctx.supported.includes(s);
                return (
                  <label
                    key={s}
                    className={cn(
                      'focus-ring-within flex items-center gap-2 rounded-sm border px-2 py-1.5 text-caption',
                      ctx.state === s ? 'border-ink bg-section' : 'border-hairline',
                      available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="screen-state"
                      className="sr-only"
                      checked={ctx.state === s}
                      disabled={!available}
                      onChange={() => ctx.setState(s)}
                    />
                    {LABELS[s]}
                  </label>
                );
              })}
            </div>
            {ctx.supported.length === 0 && (
              <p className="mt-2 text-caption text-ink-muted">This page has a single state.</p>
            )}
          </fieldset>

          <label className="mt-4 block text-label" htmlFor="preview-sub">
            Subscription
          </label>
          <select
            id="preview-sub"
            value={demo.subscription}
            onChange={(e) => {
              const v = e.target.value as SubscriptionStatus;
              if (v === 'active' && !demo.plan) demo.activate();
              else demo.setSubscription(v);
            }}
            className="mt-1.5 h-9 w-full rounded-sm border-[1.5px] border-control bg-surface px-2 text-caption"
          >
            <option value="none">Not subscribed</option>
            <option value="pending">Payment pending</option>
            <option value="active">Active</option>
            <option value="past_due">Payment failed (grace period)</option>
          </select>

          <p className="mt-4 text-label">Sample data</p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => demo.loadPreset('new')}
              className="h-9 flex-1 rounded-full border-[1.5px] border-control text-caption font-semibold hover:border-ink"
            >
              New shop
            </button>
            <button
              type="button"
              onClick={() => demo.loadPreset('busy')}
              className="h-9 flex-1 rounded-full border-[1.5px] border-control text-caption font-semibold hover:border-ink"
            >
              Busy shop
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-hairline bg-surface px-4 text-label text-ink shadow-[var(--shadow-pop)] hover:border-control"
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          Preview
        </button>
      )}
    </div>
  );
}
