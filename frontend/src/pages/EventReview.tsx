import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Button, ButtonLink } from '../components/ui/Button';
import { ErrorState, LoadingAnnouncer, LockedState, Skeleton } from '../components/ui/States';
import { ConfidenceMeter, ReportBadge, StatusBadge } from '../components/ui/Status';
import { FeedPlayer, usePlayer } from '../components/feed/Player';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { clockAt, dayLabel, pct, timecode } from '../lib/format';
import { cn, useDocumentTitle, useHotkeys } from '../lib/hooks';
import type { Answer, Checklist, FlagEvent } from '../data/types';

const QUESTIONS: Array<{ key: keyof Checklist; q: string }> = [
  { key: 'pickedUp', q: 'Did the person pick up an item?' },
  { key: 'concealed', q: 'Did they conceal it (pocket, bag, clothing)?' },
  { key: 'passedTill', q: 'Did they pass the till without paying?' },
  { key: 'leftShop', q: 'Did they leave the shop?' },
];
const ANSWERS: Array<{ v: Answer; label: string }> = [
  { v: 'yes', label: 'Yes' },
  { v: 'no', label: 'No' },
  { v: 'cant_tell', label: "Can't tell" },
];
const BLANK: Checklist = { pickedUp: null, concealed: null, passedTill: null, leftShop: null };

export default function EventReview() {
  const { id } = useParams();
  const demo = useDemo();
  const screen = useScreenState(['loading', 'error', 'locked']);
  const event = demo.events.find((e) => e.id === id);
  useDocumentTitle(event?.title ?? 'Review flag');

  if (screen === 'loading') {
    return (
      <div className="grid gap-8 px-4 py-8 sm:px-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <LoadingAnnouncer what="flag" />
        <Skeleton className="aspect-video w-full" />
        <div><Skeleton className="h-6 w-24" /><Skeleton className="mt-3 h-8 w-3/4" /><Skeleton className="mt-6 h-40 w-full" /></div>
      </div>
    );
  }
  if (screen === 'locked') {
    return (
      <div className="px-4 py-10 sm:px-8">
        <LockedState title="Your plan has ended." actions={<ButtonLink to="/pricing">Choose a plan</ButtonLink>}>
          Flagged clips are kept until your retention period runs out. Choose a plan to review and report them.
        </LockedState>
      </div>
    );
  }
  if (screen === 'error' || !event) {
    return (
      <div className="px-4 py-10 sm:px-8">
        <ErrorState title="We can't find that flag" code="event_not_found" actions={<ButtonLink to="/app/queue">Back to queue</ButtonLink>}>
          It may have been deleted after the retention period.
        </ErrorState>
      </div>
    );
  }
  return <Review key={event.id} event={event} />;
}

function Review({ event }: { event: FlagEvent }) {
  const demo = useDemo();
  const navigate = useNavigate();
  const camera = demo.cameras.find((c) => c.id === event.cameraId);
  const camLabel = camera ? `${camera.code} · ${camera.name}` : 'Free scan';
  const player = usePlayer(event.clipDuration, Math.max(0, event.segments[0].start - 2));
  const [checklist, setChecklist] = useState<Checklist>(event.checklist ?? BLANK);
  const [notice, setNotice] = useState('');
  const pending = event.status === 'needs_review' || event.status === 'unsure';
  const allYes = QUESTIONS.every((q) => checklist[q.key] === 'yes');
  const answered = QUESTIONS.filter((q) => checklist[q.key] != null).length;

  const list = demo.events;
  const idx = list.findIndex((e) => e.id === event.id);
  const prev = list[idx - 1];
  const next = list[idx + 1];
  const nextPending = list.find((e, i) => i !== idx && e.status === 'needs_review');

  useEffect(() => {
    if (pending) return;
    setNotice('');
  }, [pending]);

  const decide = (status: 'confirmed' | 'unsure' | 'dismissed') => {
    if (status === 'confirmed' && !allYes) {
      setNotice('Answer Yes to all four questions to confirm. Otherwise mark it Unsure or Dismiss it.');
      return;
    }
    // Real app: POST /events/:id/decision { decision, checklist }
    demo.decide(event.id, status, checklist);
    setNotice(status === 'confirmed' ? 'Event confirmed.' : status === 'unsure' ? 'Marked unsure. It stays in your queue.' : 'Cleared. Nothing else happens.');
  };

  const makeReport = () => {
    // Real app: POST /events/:id/report → { reportId }
    const rid = event.reportId ?? demo.createReport(event.id);
    navigate(`/app/reports/${rid}`);
  };

  useHotkeys({
    j: () => next && navigate(`/app/events/${next.id}`),
    k: () => prev && navigate(`/app/events/${prev.id}`),
    c: () => pending && decide('confirmed'),
    u: () => pending && decide('unsure'),
    d: () => pending && decide('dismissed'),
    ' ': (e) => { e.preventDefault(); player.toggle(); },
    ArrowLeft: () => player.seek(player.t - 5),
    ArrowRight: () => player.seek(player.t + 5),
  });

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3 sm:px-8">
        <Link to="/app/queue" className="inline-flex items-center gap-1.5 text-label text-ink-muted hover:text-ink">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" /> Review queue
        </Link>
        <span className="ml-auto font-mono text-caption text-ink-muted">{idx + 1} of {list.length}</span>
        <button type="button" disabled={!prev} onClick={() => prev && navigate(`/app/events/${prev.id}`)} aria-label="Previous flag" aria-keyshortcuts="K" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-section disabled:opacity-40">
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
        <button type="button" disabled={!next} onClick={() => next && navigate(`/app/events/${next.id}`)} aria-label="Next flag" aria-keyshortcuts="J" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-section disabled:opacity-40">
          <ChevronRight size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="grid gap-10 px-4 py-6 sm:px-8 sm:py-8 xl:grid-cols-[minmax(0,1fr)_25rem] xl:gap-14">
        <div className="min-w-0">
          <FeedPlayer event={event} camera={camLabel} player={player} />

          <section aria-labelledby="why" className="mt-8">
            <h2 id="why" className="text-h3">Why this was flagged</h2>
            <ol className="mt-3 border-t border-hairline">
              {event.observations.map((o) => (
                <li key={o.at} className="border-b border-hairline">
                  <button type="button" onClick={() => player.seek(o.at)} className="grid w-full grid-cols-[4.5rem_1fr] gap-3 py-2.5 text-left hover:bg-section">
                    <span className="font-mono text-caption text-ink">{timecode(o.at)}</span>
                    <span className="text-body">{o.text}</span>
                  </button>
                </li>
              ))}
            </ol>
            {event.notSeen.length > 0 && (
              <p className="mt-3 text-body text-ink-muted">
                <span className="font-semibold text-ink">Not seen:</span> {event.notSeen.join('; ')}.
              </p>
            )}
            <p className="mt-3 text-caption text-ink-muted">Nicked can be wrong. Coats, bags and low light can look like concealment. You decide.</p>
          </section>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={event.status} />
            {event.reportId && <ReportBadge />}
          </div>
          <h1 className="mt-3 text-h1">{event.title}</h1>
          <p className="mt-2 font-mono text-caption text-ink-muted">
            {camera?.code ?? 'FREE SCAN'} · {dayLabel(event.recordedAt)} {clockAt(event.startClock, event.segments[0].start)} · {pct(event.confidence)} · {timecode(event.segments.at(-1)!.end - event.segments[0].start)} flagged
          </p>
          <ConfidenceMeter value={event.confidence} showLabel className="mt-4" />

          <div className="mt-8 border-t border-hairline pt-6">
          <fieldset disabled={!pending}>
            <legend className="text-h3">Check what you saw</legend>
            <p className="mt-1 text-body text-ink-muted">Watch the clip, then answer for yourself.</p>
            <ol className="mt-4 flex flex-col gap-5">
              {QUESTIONS.map((q, i) => (
                <li key={q.key}>
                  <fieldset>
                    <legend className="flex gap-2 text-body font-semibold">
                      <span className="font-mono text-ink-muted">{i + 1}</span>
                      {q.q}
                    </legend>
                    <div className="mt-2 flex gap-1.5 pl-5">
                      {ANSWERS.map((a) => {
                        const on = checklist[q.key] === a.v;
                        return (
                          <label key={a.v} className={cn(
                            'focus-ring-within inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-label transition-colors duration-[140ms]',
                            on ? 'border-primary bg-primary text-on-primary' : 'border-control text-ink hover:border-ink',
                            !pending && 'cursor-default',
                          )}>
                            <input type="radio" className="sr-only" name={`${event.id}-${q.key}`} checked={on} onChange={() => setChecklist((c) => ({ ...c, [q.key]: a.v }))} />
                            {on && a.v === 'yes' && (
                              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="anim-draw" style={{ ['--dash' as string]: 14 }} />
                              </svg>
                            )}
                            {a.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
          </fieldset>
          </div>

          <div className="sticky bottom-16 z-20 -mx-4 mt-8 border-t border-hairline bg-page px-4 py-4 sm:-mx-8 sm:px-8 lg:bottom-0 xl:static xl:mx-0 xl:border-t-0 xl:bg-transparent xl:p-0">
            {pending ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => decide('confirmed')} aria-keyshortcuts="C" aria-disabled={!allYes || undefined}>Confirm event</Button>
                  <Button variant="secondary" onClick={() => decide('unsure')} aria-keyshortcuts="U">Unsure</Button>
                  <Button variant="ghost" onClick={() => decide('dismissed')} aria-keyshortcuts="D">Dismiss</Button>
                </div>
                <p className="mt-3 text-caption text-ink-muted" aria-live="polite">
                  {notice || (allYes ? 'All four answered Yes. You can confirm.' : `${answered} of 4 answered. Confirm needs Yes to all four.`)}
                </p>
                <p className="mt-1 text-caption font-semibold text-ink">Nothing goes to the Gardaí until you confirm.</p>
              </>
            ) : (
              <div className="anim-rise" role="status">
                <p className="text-h3">{event.status === 'confirmed' ? 'You confirmed this event.' : 'You cleared this flag.'}</p>
                <p className="mt-1 text-body text-ink-muted">
                  {event.status === 'confirmed' ? 'Create a factual report you can give to the Gardaí. Nicked never sends it for you.' : 'Nothing else happens. It stays in Cleared.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {event.status === 'confirmed' && (
                    <Button icon={<FileText size={16} strokeWidth={1.75} />} onClick={makeReport}>{event.reportId ? 'Open incident report' : 'Create incident report'}</Button>
                  )}
                  {nextPending && <ButtonLink to={`/app/events/${nextPending.id}`} variant="signal">Review next flag</ButtonLink>}
                  <Button variant="ghost" onClick={() => demo.reopen(event.id)}>Undo decision</Button>
                </div>
              </div>
            )}
          </div>
          <p className="mt-6 hidden text-caption text-ink-muted sm:block">
            Keys: <kbd className="font-mono">C</kbd> confirm · <kbd className="font-mono">U</kbd> unsure · <kbd className="font-mono">D</kbd> dismiss · <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> next/previous · <kbd className="font-mono">Space</kbd> play
          </p>
        </div>
      </div>
    </div>
  );
}
