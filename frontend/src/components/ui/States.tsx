import type { ReactNode } from 'react';
import { CircleAlert, Gauge, Lock, Info } from 'lucide-react';
import { cn } from '../../lib/hooks';

// Designed states. Errors are ink + icon + a bordered panel: never red
// (red means Confirmed) and never orange (orange means flagged).

interface StateProps {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ title, children, actions, className, art }: StateProps & { art?: ReactNode }) {
  return (
    <div className={cn('border-t border-hairline py-12 sm:py-16', className)}>
      {art}
      <h2 className="max-w-md text-h2 text-ink">{title}</h2>
      {children && <div className="mt-2 max-w-md text-body text-ink-muted">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function ErrorState({ title, children, actions, code, className }: StateProps & { code?: string }) {
  return (
    <div role="alert" className={cn('rounded-md border-2 border-ink p-5 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <CircleAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-h3 text-ink">{title}</h2>
          {children && <div className="mt-1 text-body text-ink-muted">{children}</div>}
          {code && (
            <p className="mt-3 text-caption text-ink-muted">
              Error code <span className="font-mono text-ink">{code}</span>
            </p>
          )}
          {actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function LockedState({ title, children, actions, className }: StateProps) {
  return (
    <div className={cn('rounded-md bg-section p-5 sm:p-8', className)}>
      <p className="eyebrow flex items-center gap-2 text-ink-muted">
        <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
        Analysis off
      </p>
      <h2 className="mt-3 max-w-lg text-h2 text-ink">{title}</h2>
      {children && <div className="mt-2 max-w-lg text-body text-ink-muted">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function LimitState({ title, children, actions, className, label = 'Limit reached' }: StateProps & { label?: string }) {
  return (
    <div className={cn('rounded-md border-[1.5px] border-control p-5 sm:p-6', className)}>
      <p className="eyebrow flex items-center gap-2 text-ink-muted">
        <Gauge size={14} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </p>
      <h2 className="mt-2 text-h3 text-ink">{title}</h2>
      {children && <div className="mt-1 text-body text-ink-muted">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function Notice({
  children,
  tone = 'info',
  className,
  action,
}: {
  children: ReactNode;
  tone?: 'info' | 'warn';
  className?: string;
  action?: ReactNode;
}) {
  const Icon = tone === 'warn' ? CircleAlert : Info;
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-md px-4 py-3 sm:flex-row sm:items-center',
        tone === 'warn' ? 'border-2 border-ink bg-surface' : 'bg-section',
        className,
      )}
    >
      <div className="flex flex-1 items-start gap-2.5 text-body text-ink">
        <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** Screen-reader announcement for skeleton screens. */
export function LoadingAnnouncer({ what }: { what: string }) {
  return (
    <p className="sr-only" role="status">
      Loading {what}
    </p>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('eyebrow text-ink-muted', className)}>{children}</p>;
}
