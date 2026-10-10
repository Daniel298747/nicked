import type { EventStatus } from '../../data/types';
import { hours, pct } from '../../lib/format';
import { cn } from '../../lib/hooks';

// Status = word + shape + colour, never colour alone (brand PDF).
//   Flagged   ● circle     Unsure  ◐ half    Confirmed ■ square    Cleared ○ ring
const STATUS: Record<EventStatus, { label: string; cls: string; shape: 'dot' | 'half' | 'square' | 'ring' }> = {
  needs_review: { label: 'Flagged', cls: 'bg-flagged-bg text-flagged', shape: 'dot' },
  unsure: { label: 'Unsure', cls: 'bg-unsure-bg text-unsure', shape: 'half' },
  confirmed: { label: 'Confirmed', cls: 'bg-confirmed-bg text-confirmed', shape: 'square' },
  dismissed: { label: 'Cleared', cls: 'bg-cleared-bg text-cleared', shape: 'ring' },
};

export const statusLabel = (s: EventStatus) => STATUS[s].label;

export function StatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold', s.cls, className)}>
      <Shape shape={s.shape} flagged={status === 'needs_review'} />
      {s.label}
    </span>
  );
}

export function ReportBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-reported-bg px-2.5 text-caption font-semibold text-reported', className)}>
      <svg viewBox="0 0 8 8" className="size-2" aria-hidden="true">
        <path d="M1 1h4l2 2v4H1z" fill="currentColor" />
      </svg>
      Report ready
    </span>
  );
}

function Shape({ shape, flagged }: { shape: 'dot' | 'half' | 'square' | 'ring'; flagged: boolean }) {
  return (
    <svg viewBox="0 0 8 8" className="size-2 shrink-0" aria-hidden="true">
      {shape === 'dot' && <circle cx="4" cy="4" r="4" fill={flagged ? 'var(--flagged-dot)' : 'currentColor'} />}
      {shape === 'half' && (
        <>
          <circle cx="4" cy="4" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 0.75A3.25 3.25 0 0 1 4 7.25z" fill="currentColor" />
        </>
      )}
      {shape === 'square' && <rect x="0.5" y="0.5" width="7" height="7" rx="1" fill="currentColor" />}
      {shape === 'ring' && <circle cx="4" cy="4" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

/** Ten cells plus the exact number in mono. Cells fill one by one. */
export function ConfidenceMeter({
  value,
  animate = true,
  onFeed = false,
  className,
  showLabel = false,
}: {
  value: number;
  animate?: boolean;
  onFeed?: boolean;
  className?: string;
  showLabel?: boolean;
}) {
  const filled = Math.round(value * 10);
  return (
    <span className={cn('inline-flex items-center gap-2', className)} role="img" aria-label={`Confidence ${pct(value)}`}>
      {showLabel && <span className={cn('eyebrow', onFeed ? 'text-feed-muted' : 'text-ink-muted')}>Confidence</span>}
      <span className="inline-flex gap-[2px]" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn('relative h-3 w-1.5 overflow-hidden rounded-[1.5px]', onFeed ? 'bg-feed-track' : 'bg-hairline')}>
            {i < filled && (
              <span
                className={cn('absolute inset-0', onFeed ? 'bg-feed-ink' : 'bg-ink', animate && 'anim-cell')}
                style={animate ? { animationDelay: `${i * 35}ms` } : undefined}
              />
            )}
          </span>
        ))}
      </span>
      <span className={cn('font-mono text-caption tabular', onFeed ? 'text-feed-ink' : 'text-ink')} aria-hidden="true">
        {pct(value)}
      </span>
    </span>
  );
}

/** "7.5 of 12 hours today" with a bar. */
export function UsageBar({ used, cap, className }: { used: number; cap: number; className?: string }) {
  const ratio = Math.min(1, used / cap);
  const atCap = used >= cap;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink">
          <span className="font-mono tabular">{hours(used)}</span> of <span className="font-mono tabular">{hours(cap)}</span> hours today
        </span>
        {atCap && <span className="text-caption font-semibold text-ink">Limit reached</span>}
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-section"
        role="meter"
        aria-label="Analysis used today"
        aria-valuemin={0}
        aria-valuemax={Math.round(cap / 360) / 10}
        aria-valuenow={Math.round(used / 360) / 10}
        aria-valuetext={`${hours(used)} of ${hours(cap)} hours used today${atCap ? ', limit reached' : ''}`}
      >
        <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
