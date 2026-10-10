import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { PageHeader } from '../components/layout/Layouts';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, ErrorState, LimitState, LoadingAnnouncer, LockedState, Notice, Skeleton } from '../components/ui/States';
import { UsageBar, StatusBadge } from '../components/ui/Status';
import { capFor, useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { clockTime, euro, longDate } from '../lib/format';
import { nextCameraPrice } from '../lib/pricing';
import { useDocumentTitle } from '../lib/hooks';
import { Link } from 'react-router';

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const demo = useDemo();
  const screen = useScreenState(['loading', 'empty', 'error', 'locked', 'limit']);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const loading = screen === 'loading' || demo.loading;
  const failed = screen === 'error' || (demo.loadError != null && !demo.shop.id);
  const locked = screen === 'locked' || (!demo.isActive && screen === 'live');
  const flagged = demo.events.filter((e) => e.status === 'needs_review');
  const analysing = demo.clips.filter((c) => c.status === 'queued' || c.status === 'analysing');
  const cameras = screen === 'empty' ? [] : demo.cameras;
  const atCameraLimit = screen === 'limit' || (demo.entitlements && demo.cameras.length >= demo.entitlements.camerasAllowed);

  return (
    <>
      <PageHeader eyebrow={longDate(new Date().toISOString())} title={demo.shop.name}
        actions={!locked && screen !== 'error' && <ButtonLink to="/app/upload" icon={<Upload size={16} strokeWidth={1.75} />}>Upload clip</ButtonLink>}
      />
      <div className="px-4 py-8 sm:px-8">
        {demo.subscription === 'past_due' && screen === 'live' && (
          <Notice tone="warn" className="mb-8" action={<ButtonLink to="/app/settings/billing" size="sm">Update card</ButtonLink>}>
            Your last payment didn't go through. Analysis stops in 3 days unless the card is updated.
          </Notice>
        )}

        {loading ? (
          <div>
            <LoadingAnnouncer what="dashboard" />
            <Skeleton className="h-28 w-full max-w-xl" />
            <div className="mt-10 flex flex-col gap-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          </div>
        ) : failed ? (
          <ErrorState title="Couldn't load your cameras" code="network_error" actions={<Button onClick={() => location.reload()}>Try again</Button>}>
            {demo.loadError ?? "Check the shop's internet connection."} Your footage and flags are safe.
          </ErrorState>
        ) : (
          <>
            {locked ? (
              <LockedState
                title={demo.shop.freeScanUsed ? 'Choose a plan to keep flagging.' : 'Try one clip free, or choose a plan.'}
                actions={<>
                  <ButtonLink to="/pricing">Choose a plan</ButtonLink>
                  {!demo.shop.freeScanUsed && <ButtonLink to="/app/upload" variant="secondary">Scan a clip free</ButtonLink>}
                </>}
              >
                {demo.shop.freeScanUsed
                  ? 'Your free scan is done. Flags from it are still in your queue.'
                  : 'Your first scan is free: one clip, up to an hour. A plan starts at €29 a camera a month.'}
              </LockedState>
            ) : (
              <section aria-labelledby="queue-h" className="grid gap-6 border-b border-hairline pb-8 md:grid-cols-[auto_1fr] md:items-end md:gap-12">
                <div>
                  <h2 id="queue-h" className="eyebrow text-ink-muted">Waiting for you</h2>
                  <p className="mt-2 flex items-baseline gap-3">
                    <span className="text-stat tabular">{flagged.length}</span>
                    <span className="text-h3">{flagged.length === 1 ? 'flag to review' : 'flags to review'}</span>
                  </p>
                </div>
                {flagged.length ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <ButtonLink to={`/app/events/${flagged[0].id}`} variant="signal">Review flag</ButtonLink>
                    <ButtonLink to="/app/queue" variant="ghost">See the queue</ButtonLink>
                  </div>
                ) : (
                  <p className="text-body text-ink-muted">Quiet day. No flags since {clockTime(demo.lastFlagAt)}.</p>
                )}
              </section>
            )}

            {analysing.length > 0 && (
              <Notice className="mt-8" action={<ButtonLink to={`/app/clips/${analysing[0].id}`} size="sm" variant="secondary">Watch progress</ButtonLink>}>
                Analysing <span className="font-mono">{analysing[0].fileName}</span> · <span className="font-mono">{Math.round(analysing[0].progress)}%</span>
              </Notice>
            )}

            <section aria-labelledby="cams-h" className="mt-10">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="cams-h" className="text-h2">Cameras</h2>
                  {demo.entitlements && (
                    <p className="mt-1 text-body text-ink-muted">
                      <span className="font-mono">{demo.cameras.length}</span> of <span className="font-mono">{demo.entitlements.camerasAllowed}</span> cameras active
                    </p>
                  )}
                </div>
                {!locked && (
                  <Button variant="secondary" size="sm" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setConfirmAdd(true)}>
                    Add a camera
                  </Button>
                )}
              </div>

              {confirmAdd && demo.plan && (
                <LimitState
                  className="mt-6"
                  label={atCameraLimit ? 'Camera limit reached' : 'Add a camera'}
                  title={`You're using ${demo.cameras.length} of ${demo.plan.cameras} cameras.`}
                  actions={<>
                    <Button onClick={() => { demo.addCamera().catch((e: Error) => alert(e.message)); setConfirmAdd(false); }}>Add camera for {euro(nextCameraPrice(demo.plan.cameras, demo.plan.interval))}</Button>
                    <Button variant="ghost" onClick={() => setConfirmAdd(false)}>Keep {demo.plan.cameras}</Button>
                  </>}
                >
                  Adding one updates your plan. Stripe charges the difference for the rest of this period.
                </LimitState>
              )}

              {cameras.length === 0 ? (
                <EmptyState className="mt-6" title="No cameras yet." actions={<Button onClick={() => setConfirmAdd(true)}>Add a camera</Button>}>
                  Add the cameras you already have. Name each one so flags say where they happened.
                </EmptyState>
              ) : (
                <ul className="mt-6 border-t border-hairline">
                  {cameras.map((c) => {
                    const cap = capFor(c);
                    const used = screen === 'limit' && c === cameras[0] ? cap : c.usedSecondsToday;
                    const camFlags = demo.events.filter((e) => e.cameraId === c.id && e.status === 'needs_review').length;
                    return (
                      <li key={c.id} className="grid gap-3 border-b border-hairline py-4 sm:grid-cols-[11rem_1fr_minmax(12rem,18rem)_auto] sm:items-center sm:gap-6">
                        <div>
                          <p className="font-mono text-caption text-ink-muted">{c.code}</p>
                          <p className="text-body font-semibold">{c.name}</p>
                        </div>
                        <p className="text-caption text-ink-muted">
                          {locked ? 'Off until you choose a plan' : used >= cap ? 'Paused until midnight' : c.alwaysOn ? '24/7 monitoring' : 'Up to 12 hours a day'}
                          {camFlags > 0 && <> · <Link to="/app/queue" className="font-semibold text-ink underline">{camFlags} flagged</Link></>}
                        </p>
                        <UsageBar used={locked ? 0 : used} cap={cap} />
                        <div className="sm:text-right">
                          {!locked && used < cap && (
                            <ButtonLink to={`/app/upload?camera=${c.id}`} variant="ghost" size="sm">Upload clip</ButtonLink>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {demo.events.some((e) => e.status !== 'needs_review') && (
              <section aria-labelledby="recent-h" className="mt-12">
                <h2 id="recent-h" className="text-h2">Recent decisions</h2>
                <ul className="mt-4 border-t border-hairline">
                  {demo.events.filter((e) => e.status !== 'needs_review').slice(0, 4).map((e) => (
                    <li key={e.id}>
                      <Link to={`/app/events/${e.id}`} className="flex flex-wrap items-center gap-3 border-b border-hairline py-3 hover:bg-section">
                        <StatusBadge status={e.status} />
                        <span className="text-body">{e.title}</span>
                        <span className="ml-auto font-mono text-caption text-ink-muted">{e.startClock}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
