import { useState } from 'react';
import { useParams } from 'react-router';
import { ArrowLeft, Download, FileDown, Film } from 'lucide-react';
import { Link } from 'react-router';
import { Button, ButtonLink } from '../components/ui/Button';
import { ErrorState, LoadingAnnouncer, Skeleton } from '../components/ui/States';
import { FeedFrame } from '../components/feed/FeedFrame';
import { Scene } from '../components/feed/Scene';
import { actorAt } from '../components/feed/script';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { clockAt, clockTime, longDate, pct, timecode } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const LABELS: Record<string, string> = {
  pickedUp: 'Picked up an item',
  concealed: 'Concealed it',
  passedTill: 'Passed the till without paying',
  leftShop: 'Left the shop',
};
const ANSWER: Record<string, string> = { yes: 'Yes', no: 'No', cant_tell: "Can't tell" };

export default function Report() {
  const { id } = useParams();
  const demo = useDemo();
  const screen = useScreenState(['loading', 'error']);
  const report = demo.reports.find((r) => r.id === id);
  const event = demo.events.find((e) => e.id === report?.eventId);
  useDocumentTitle(report ? `Incident report ${report.ref}` : 'Incident report');

  if (screen === 'loading' || (!report && demo.loading)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LoadingAnnouncer what="report" />
        <Skeleton className="h-8 w-48" /><Skeleton className="mt-4 h-24 w-full" /><Skeleton className="mt-6 h-48 w-full" />
      </div>
    );
  }
  if (screen === 'error' || !report || !event) {
    return (
      <div className="px-4 py-10 sm:px-8">
        <ErrorState title="We can't open that report" code="report_not_found" actions={<ButtonLink to="/app/queue?status=confirmed">See confirmed events</ButtonLink>}>
          Reports are only made for events you confirmed.
        </ErrorState>
      </div>
    );
  }

  const camera = demo.cameras.find((c) => c.id === event.cameraId);
  const cam = camera ? `${camera.code} · ${camera.name}` : 'Free scan';
  const start = event.segments[0].start;
  const end = event.segments.at(-1)!.end;
  const frames = [event.script.reach, event.script.conceal + 0.5, event.script.exit - 3];
  const evidence = event.media?.evidence.slice(0, 6) ?? [];

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="no-print mx-auto mb-6 flex max-w-3xl flex-wrap items-center gap-3">
        <Link to={`/app/events/${event.id}`} className="inline-flex items-center gap-1.5 text-label text-ink-muted hover:text-ink">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" /> Back to event
        </Link>
        {/* Real app: GET /reports/:id; the PDF comes from the backend if it provides one. */}
        <span className="ml-auto" />
        {report.markdownUrl && <ButtonLink to={report.markdownUrl} reloadDocument variant="ghost" icon={<FileDown size={16} strokeWidth={1.75} />}>Report text</ButtonLink>}
        {report.clipUrl && <ButtonLink to={report.clipUrl} reloadDocument variant="ghost" icon={<Film size={16} strokeWidth={1.75} />}>Clip (MP4)</ButtonLink>}
        <Button icon={<Download size={16} strokeWidth={1.75} />} onClick={() => window.print()}>Download PDF</Button>
      </div>
      {demo.mode === 'live' && <SharedToggle reportId={report.id} shared={Boolean(report.sharedWithGardai)} />}
      {report.languageWarnings && report.languageWarnings.length > 0 && (
        <p className="no-print mx-auto mb-6 max-w-3xl text-caption font-semibold text-ink">{report.languageWarnings.join(' ')}</p>
      )}

      <article className="mx-auto max-w-3xl rounded-md border border-hairline bg-surface p-6 sm:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-6">
          <div>
            <p className="eyebrow text-ink-muted">Incident report</p>
            <h1 className="mt-1 text-h1">Owner-confirmed event, {camera?.name.toLowerCase() ?? 'free scan'}</h1>
            <p className="mt-2 text-body text-ink-muted">{[demo.shop.name, demo.shop.address].filter(Boolean).join(' · ')}</p>
          </div>
          <dl className="text-right">
            <dt className="eyebrow text-ink-muted">Reference</dt>
            <dd className="font-mono text-body">{report.ref}</dd>
            <dt className="eyebrow mt-2 text-ink-muted">Created</dt>
            <dd className="font-mono text-caption">{longDate(report.createdAt)}, {clockTime(report.createdAt)}</dd>
          </dl>
        </header>

        <section className="print-break-avoid mt-6">
          <h2 className="text-h3">Summary</h2>
          {report.narrative ? (
            <p className="mt-2 whitespace-pre-line text-body">{report.narrative}</p>
          ) : (
          <p className="mt-2 text-body">
            On {longDate(event.recordedAt)}, between {clockAt(event.startClock, start)} and {clockAt(event.startClock, end)}, camera {cam} recorded a person
            picking up an item, concealing it, passing the till without paying and leaving the shop. The shop owner, {demo.shop.ownerName}, reviewed the footage
            and confirmed each of these four observations{event.decidedAt ? ` on ${longDate(event.decidedAt)} at ${clockTime(event.decidedAt)}` : ''}.
          </p>
          )}
        </section>

        <section className="print-break-avoid mt-8">
          <h2 className="text-h3">Key frames</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {evidence.map((f) => (
              <figure key={f.url}>
                <div className="aspect-video overflow-hidden rounded-md bg-feed">
                  <img src={f.url} alt={`Frame at ${f.label}`} className="size-full object-contain" />
                </div>
                <figcaption className="mt-1 font-mono text-caption text-ink-muted">{f.label} · clip time</figcaption>
              </figure>
            ))}
            {!event.media && frames.map((t) => (
              <figure key={t}>
                <FeedFrame camera={camera?.code ?? ''} clock={clockAt(event.startClock, t)} size="md"
                  detection={{ box: actorAt(event.script, t).box, label: '' }}
                  label={`Frame at ${clockAt(event.startClock, t)}`}>
                  <Scene script={event.script} t={t} />
                </FeedFrame>
                <figcaption className="mt-1 font-mono text-caption text-ink-muted">{timecode(t)} · {clockAt(event.startClock, t)}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="print-break-avoid mt-8">
          <h2 className="text-h3">What the footage shows</h2>
          <table className="mt-3 w-full text-body">
            <thead>
              <tr className="text-left">
                <th scope="col" className="eyebrow border-b border-hairline py-2 font-medium text-ink-muted">Clip time</th>
                {!event.media && <th scope="col" className="eyebrow border-b border-hairline py-2 font-medium text-ink-muted">Clock</th>}
                <th scope="col" className="eyebrow border-b border-hairline py-2 font-medium text-ink-muted">Observation</th>
              </tr>
            </thead>
            <tbody>
              {event.observations.map((o) => (
                <tr key={o.at}>
                  <td className="border-b border-hairline py-2 pr-3 align-top font-mono text-caption">{timecode(o.at)}</td>
                  {!event.media && <td className="border-b border-hairline py-2 pr-3 align-top font-mono text-caption">{clockAt(event.startClock, o.at)}</td>}
                  <td className="border-b border-hairline py-2">{o.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-break-avoid mt-8 grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-h3">Owner's checklist</h2>
            <dl className="mt-3">
              {Object.entries(event.checklist ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-hairline py-2">
                  <dt>{LABELS[k]}</dt>
                  <dd className="font-semibold">{v ? ANSWER[v] : '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="text-h3">Footage</h2>
            <dl className="mt-3 text-body">
              {[
                ['Camera', cam],
                ['Clip length', timecode(event.clipDuration)],
                ['Flagged section', `${timecode(start)} → ${timecode(end)}`],
                ['Flag confidence', pct(event.confidence)],
                ['Event ID', event.id],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-hairline py-2">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="font-mono text-caption">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="print-break-avoid mt-8 rounded-sm bg-section p-4 text-caption text-ink-muted">
          <p className="font-semibold text-ink">How this report was made</p>
          <p className="mt-1">
            Nicked flagged this moment automatically. A person, the shop owner, watched the footage and confirmed what happened. Nicked does not identify
            people and does not send reports to anyone. The original footage is kept for {demo.entitlements?.retentionDays ?? 30} days.
          </p>
        </section>

        <footer className="print-break-avoid mt-10 grid gap-8 sm:grid-cols-2">
          <div><div className="h-10 border-b border-ink" /><p className="mt-1 text-caption text-ink-muted">Signed: {demo.shop.ownerName}</p></div>
          <div><div className="h-10 border-b border-ink" /><p className="mt-1 text-caption text-ink-muted">Date</p></div>
        </footer>
      </article>
    </div>
  );
}

/** The app never sends anything. The owner records that they gave the report to the Gardaí. */
function SharedToggle({ reportId, shared }: { reportId: string; shared: boolean }) {
  const demo = useDemo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = () => {
    setBusy(true);
    setError('');
    demo.markShared(reportId, !shared).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <div className="no-print mx-auto mb-6 flex max-w-3xl flex-wrap items-center gap-3 rounded-md bg-section px-4 py-3">
      <p className="text-body">
        {shared ? 'You marked this report as given to the Gardaí.' : 'Nicked never sends this for you. Give it to the Gardaí yourself if you choose to.'}
      </p>
      <Button size="sm" variant={shared ? 'ghost' : 'secondary'} className="ml-auto" onClick={toggle} loading={busy}>
        {shared ? 'Undo' : 'I gave it to the Gardaí'}
      </Button>
      {error && <p className="w-full text-caption text-ink">{error}</p>}
    </div>
  );
}
