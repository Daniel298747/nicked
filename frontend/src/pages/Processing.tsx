import { Link, useParams } from 'react-router';
import { Check } from 'lucide-react';
import { PageHeader } from '../components/layout/Layouts';
import { ButtonLink } from '../components/ui/Button';
import { ErrorState, LoadingAnnouncer, Skeleton } from '../components/ui/States';
import { ConfidenceMeter, StatusBadge } from '../components/ui/Status';
import { FeedFrame, ScanLine } from '../components/feed/FeedFrame';
import { Scene } from '../components/feed/Scene';
import { Timeline } from '../components/feed/Player';
import { cameraLabel, useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { minutes, timecode } from '../lib/format';
import { cn, useDocumentTitle } from '../lib/hooks';
import type { ScriptParams } from '../data/types';

const EMPTY_AISLE: ScriptParams = { scene: 'aisle', side: 'right', enter: 999, reach: 999, conceal: 999, exit: 999 };

export default function Processing() {
  useDocumentTitle('Analysing clip');
  const { id } = useParams();
  const demo = useDemo();
  const screen = useScreenState(['loading', 'error']);
  const clip = demo.clips.find((c) => c.id === id);
  const camera = demo.cameras.find((c) => c.id === clip?.cameraId);
  const events = demo.events.filter((e) => clip?.eventIds.includes(e.id));
  const failed = screen === 'error' || clip?.status === 'failed';
  const done = clip?.status === 'done' && !failed;

  if (!clip && screen === 'live') {
    return (
      <div className="px-4 py-10 sm:px-8">
        <ErrorState title="We can't find that clip" code="clip_not_found" actions={<ButtonLink to="/app/upload">Upload clip</ButtonLink>}>
          It may have been removed after 30 days.
        </ErrorState>
      </div>
    );
  }

  const progress = screen === 'loading' ? 0 : Math.round(clip?.progress ?? 0);
  const duration = clip?.durationSeconds ?? 1;
  const segs = events.map((e, i) => {
    const at = ((i + 1) * 0.27 - 0.08) * duration;
    return { start: at, end: at + duration * 0.03, confidence: e.confidence };
  });
  const scene = events[0]?.script ?? { ...EMPTY_AISLE, scene: camera?.scene ?? 'aisle' };
  const steps = ['Uploaded', 'Checking every frame for movement', 'Taking a closer look at flagged moments', 'Done'];
  const stepAt = done ? 4 : progress < 5 ? 1 : progress < 70 ? 2 : 3;

  return (
    <>
      <PageHeader eyebrow={clip ? cameraLabel(camera) : 'Clip'} title={done ? 'Analysis done' : failed ? 'Analysis stopped' : 'Analysing clip'}>
        {clip && <span className="font-mono">{clip.fileName}</span>}
      </PageHeader>
      <div className="grid gap-10 px-4 py-8 sm:px-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {screen === 'loading' ? (
            <><LoadingAnnouncer what="clip" /><Skeleton className="aspect-video w-full" /></>
          ) : (
            <div className="overflow-hidden rounded-md bg-feed">
              <FeedFrame camera={camera ? `${camera.code} · ${camera.name}` : 'Free scan'} clock={clip?.startClock} rounded={false}
                overlay={!done && !failed ? <ScanLine /> : undefined}>
                <Scene script={scene} t={done ? scene.reach + 0.5 : 0} />
              </FeedFrame>
              <div className="px-3 pb-3 pt-1 sm:px-4">
                <Timeline duration={duration} segments={segs} progress={done ? 100 : progress} label="Analysis timeline" />
                <div className="mt-1 flex justify-between font-mono text-caption text-feed-muted">
                  <span>00:00</span>
                  <span>{timecode(duration)}</span>
                </div>
              </div>
            </div>
          )}

          {failed && (
            <ErrorState className="mt-6" title="The analysis timed out on this clip" code="model_timeout"
              actions={<><ButtonLink to="/app/upload">Upload clip again</ButtonLink><ButtonLink to="/app" variant="ghost">Back to dashboard</ButtonLink></>}>
              Nothing was flagged and today's hours weren't used. Shorter clips (under an hour) analyse more reliably.
            </ErrorState>
          )}

          {done && (
            <section aria-labelledby="results" className="mt-8">
              <h2 id="results" className="text-h2">
                {events.length ? `${events.length} moments flagged in ${minutes(duration)} of footage` : `Nothing flagged in ${minutes(duration)} of footage`}
              </h2>
              {events.length > 0 ? (
                <ul className="mt-4 border-t border-hairline">
                  {events.map((e) => (
                    <li key={e.id} className="anim-rise">
                      <Link to={`/app/events/${e.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-hairline py-3 hover:bg-section sm:grid-cols-[auto_1fr_auto]">
                        <StatusBadge status={e.status} />
                        <span className="text-body font-semibold sm:order-none">{e.title}</span>
                        <ConfidenceMeter value={e.confidence} className="col-span-2 sm:col-span-1" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-body text-ink-muted">Quiet clip. Nothing looked like concealment.</p>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                {events[0] && <ButtonLink to={`/app/events/${events[0].id}`} variant="signal">Review flag</ButtonLink>}
                <ButtonLink to="/app/queue" variant="secondary">Open review queue</ButtonLink>
              </div>
            </section>
          )}
        </div>

        <aside aria-label="Progress">
          <p className="eyebrow text-ink-muted">Progress</p>
          <p className="mt-2 text-stat tabular" aria-live="polite">{failed ? '—' : `${done ? 100 : progress}%`}</p>
          <ol className="mt-6 border-t border-hairline">
            {steps.map((s, i) => {
              const n = i + 1;
              const complete = stepAt > n || (done && n === 4);
              const current = stepAt === n && !done && !failed;
              return (
                <li key={s} className="flex items-center gap-3 border-b border-hairline py-3">
                  <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]', complete ? 'border-ink bg-ink text-page' : 'border-control')} aria-hidden="true">
                    {complete && <Check size={12} strokeWidth={2.5} />}
                    {current && <span className="anim-pulse size-1.5 rounded-full bg-ink" />}
                  </span>
                  <span className={cn('text-body', complete || current ? 'text-ink' : 'text-ink-muted')}>{s}</span>
                </li>
              );
            })}
          </ol>
          {!done && !failed && (
            <p className="mt-4 text-caption text-ink-muted">
              <span className="font-mono">{events.length}</span> {events.length === 1 ? 'moment' : 'moments'} flagged so far. You can leave this page; we'll keep going.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
