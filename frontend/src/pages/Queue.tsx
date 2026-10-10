import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '../components/layout/Layouts';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingAnnouncer, Notice, Skeleton } from '../components/ui/States';
import { ConfidenceMeter, ReportBadge, StatusBadge } from '../components/ui/Status';
import { FeedFrame } from '../components/feed/FeedFrame';
import { Scene } from '../components/feed/Scene';
import { actorAt, keyMoment } from '../components/feed/script';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { clockTime, dayLabel, timecode } from '../lib/format';
import { cn, useDocumentTitle, useHotkeys } from '../lib/hooks';
import type { EventStatus } from '../data/types';

const FILTERS: Array<{ value: EventStatus | 'all'; label: string }> = [
  { value: 'needs_review', label: 'Flagged' },
  { value: 'unsure', label: 'Unsure' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dismissed', label: 'Cleared' },
  { value: 'all', label: 'All' },
];

export default function Queue() {
  useDocumentTitle('Review queue');
  const demo = useDemo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const screen = useScreenState(['loading', 'empty', 'error']);
  const filter = (params.get('status') as EventStatus | 'all') ?? 'needs_review';
  const all = screen === 'empty' ? [] : demo.events;
  const loading = screen === 'loading' || (demo.loading && !demo.events.length);
  const failed = screen === 'error' || (demo.loadError != null && !demo.events.length);
  const rows = all.filter((e) => filter === 'all' || e.status === filter);
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  const move = (d: number) => {
    if (!rows.length) return;
    const i = Math.min(rows.length - 1, Math.max(0, active + d));
    setActive(i);
    refs.current[i]?.focus();
  };
  useHotkeys({ j: () => move(1), k: () => move(-1) }, screen === 'live');

  return (
    <>
      <PageHeader eyebrow="Review queue" title={filter === 'needs_review' ? `${rows.length} flagged` : 'All flags'}>
        Watch only the flagged bits. Nothing goes to the Gardaí until you confirm.
      </PageHeader>
      <div className="px-4 py-6 sm:px-8">
        <div role="tablist" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {FILTERS.map((f) => {
            const count = f.value === 'all' ? all.length : all.filter((e) => e.status === f.value).length;
            const on = filter === f.value;
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => { setParams({ status: f.value }); setActive(0); }}
                className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-label transition-colors duration-[140ms]', on ? 'bg-primary text-on-primary' : 'text-ink hover:bg-section')}
              >
                {f.label}
                <span className={cn('font-mono text-caption', on ? 'text-on-primary' : 'text-ink-muted')}>{count}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 hidden text-caption text-ink-muted sm:block">
          Keys: <kbd className="font-mono">J</kbd> / <kbd className="font-mono">K</kbd> to move, <kbd className="font-mono">Enter</kbd> to open.
        </p>

        {loading ? (
          <div className="mt-6 border-t border-hairline">
            <LoadingAnnouncer what="review queue" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 border-b border-hairline py-4">
                <Skeleton className="aspect-video w-32 shrink-0" />
                <div className="flex-1"><Skeleton className="h-5 w-24" /><Skeleton className="mt-2 h-5 w-2/3" /><Skeleton className="mt-2 h-4 w-1/2" /></div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <ErrorState className="mt-6" title="Couldn't load the queue" code="network_error" actions={<Button onClick={() => location.reload()}>Try again</Button>}>
            Your flags are safe. {demo.loadError ?? 'This is a connection problem.'}
          </ErrorState>
        ) : rows.length === 0 ? (
          <EmptyState className="mt-6"
            title={filter === 'needs_review' ? `Quiet day. No flags since ${clockTime(demo.lastFlagAt)}.` : 'Nothing here yet.'}
            actions={demo.isActive ? <ButtonLink to="/app/upload">Upload clip</ButtonLink> : <ButtonLink to="/pricing">Choose a plan</ButtonLink>}>
            {filter === 'needs_review' ? 'New flags land here as soon as a clip is analysed.' : 'Events you decide on show up under their status.'}
          </EmptyState>
        ) : (
          <>
            {!demo.isActive && <Notice className="mt-6">You can review flags from your free scan. To analyse more footage, choose a plan.</Notice>}
            <ul className="mt-6 border-t border-hairline">
              {rows.map((e, i) => {
                const cam = demo.cameras.find((c) => c.id === e.cameraId);
                const t = keyMoment(e.script);
                const flagStart = e.segments[0].start;
                const flagEnd = e.segments.at(-1)!.end;
                return (
                  <li key={e.id}>
                    <Link
                      ref={(el) => { refs.current[i] = el; }}
                      to={`/app/events/${e.id}`}
                      onFocus={() => setActive(i)}
                      onKeyDown={(ev) => { if (ev.key === ' ') { ev.preventDefault(); navigate(`/app/events/${e.id}`); } }}
                      className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-1 border-b border-hairline py-4 transition-colors duration-[140ms] hover:bg-section sm:grid-cols-[10rem_1fr_auto] sm:gap-x-6"
                    >
                      <FeedFrame camera={cam?.code ?? ''} size="sm" detection={e.media ? null : { box: actorAt(e.script, t).box, label: '' }} className="row-span-2 self-start sm:row-span-3">
                        {e.media ? (
                          e.media.thumbnailUrl ? <img src={e.media.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" /> : null
                        ) : (
                          <Scene script={e.script} t={t} />
                        )}
                      </FeedFrame>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={e.status} />
                        {e.reportId && <ReportBadge />}
                        <span className="font-mono text-caption text-ink-muted">{cam?.code} · {dayLabel(e.recordedAt)} {e.media ? clockTime(e.recordedAt) : e.startClock}</span>
                      </div>
                      <div className="min-w-0 sm:col-start-2">
                        <p className="text-h3">{e.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-body text-ink-muted sm:line-clamp-1">{e.reason}</p>
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:flex-col sm:items-end sm:justify-center sm:pt-0">
                        <ConfidenceMeter value={e.confidence} animate={false} />
                        <span className="font-mono text-caption text-ink">{timecode(flagStart)} → {timecode(flagEnd)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
