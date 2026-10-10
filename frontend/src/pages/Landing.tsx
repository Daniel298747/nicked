import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Lock } from 'lucide-react';
import { Button, ButtonLink } from '../components/ui/Button';
import { useDemo } from '../demo/store';
import { ConfidenceMeter } from '../components/ui/Status';
import { FeedFrame } from '../components/feed/FeedFrame';
import { Scene } from '../components/feed/Scene';
import { Timeline } from '../components/feed/Player';
import { actorAt, segmentAt } from '../components/feed/script';
import { euro, clockAt, pct, timecode } from '../lib/format';
import { quote } from '../lib/pricing';
import { useDocumentTitle, usePrefersReducedMotion } from '../lib/hooks';
import type { Interval, Plan, ScriptParams, Segment } from '../data/types';

const SCRIPT: ScriptParams = { scene: 'aisle', side: 'right', enter: 2, reach: 16, conceal: 21, exit: 34 };
const SEGMENTS: Segment[] = [
  { start: 12, end: 27, confidence: 0.87 },
  { start: 27, end: 34, confidence: 0.64 },
];
const LOOP = 40;

// The illustrated hero, kept for when the video isn't wanted.
export function HeroFeed() {
  const reduced = usePrefersReducedMotion();
  const [t, setT] = useState(reduced ? 17 : 6);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      setT((p) => (p + (now - last) / 1000) % LOOP);
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  const seg = segmentAt(SEGMENTS, t);
  const a = actorAt(SCRIPT, t);
  return (
    <div className="overflow-hidden rounded-md bg-feed">
      <FeedFrame
        camera="CAM 02 · Aisle 2"
        clock={clockAt('14:31:51', t)}
        rounded={false}
        label="Illustrated CCTV clip: a shopper in aisle 2 takes an item and tucks it into a jacket. Nicked boxes the moment as possible concealment."
        detection={seg && a.visible ? { box: a.box, label: `Possible concealment · ${pct(seg.confidence)}`, low: seg.confidence < 0.7 } : null}
      >
        <Scene script={SCRIPT} t={t} />
      </FeedFrame>
      <div className="px-3 pb-3 pt-1 sm:px-4">
        <Timeline duration={LOOP} t={t} segments={SEGMENTS} label="Clip timeline" />
      </div>
    </div>
  );
}

const STEPS = [
  ['01', 'Upload', 'Export footage from the cameras you already have and drop it in. No new kit.'],
  ['02', 'Detect', 'Nicked watches every frame and flags moments that look like concealment.'],
  ['03', 'Review', 'Watch only the flagged bits. Answer four questions. Confirm, mark unsure, or dismiss.'],
  ['04', 'Report', 'Confirmed? Download a ready-made, factual report to give the Gardaí.'],
];

const WALK = [
  { at: 12, text: 'Person stops at the right-hand shelf, middle row.' },
  { at: 16, text: 'Right hand lifts a small item from the shelf.' },
  { at: 21, text: 'Hand moves inside the jacket. The item is no longer visible.' },
  { at: 34, text: 'Person leaves the aisle towards the door.' },
];

const FAQ = [
  ['Do I need new cameras?', 'No. Nicked works on footage from the cameras you have. Export a clip from your recorder and upload it.'],
  ['Does Nicked accuse anyone?', 'No. It flags possible concealment. You watch the clip and decide. Nothing goes to the Gardaí until you confirm, and even then Nicked never sends anything. You hand over the report yourself.'],
  ['How much footage can it check?', 'Up to 12 hours a day per camera. Add 24/7 monitoring for €16 a camera a month.'],
  ['How long do you keep clips?', 'Flagged clips are kept for 30 days. Add 90-day retention for €5 a month.'],
  ['What does it cost?', '€29 a camera a month for your first two cameras, €19 for the third and fourth, €15 from the fifth. Pay yearly and get two months free. Prices exclude VAT.'],
  ['Can I try it first?', 'Yes. Your first scan is free: one clip, up to an hour, no card.'],
  ['Can I cancel?', 'Any time. Your plan runs to the end of the period you paid for. There is also a 30-day money-back guarantee on your first invoice.'],
];

export default function Landing() {
  useDocumentTitle('');
  return (
    <>
      {/* Hero: asymmetric, footage is the visual */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[5fr_7fr] lg:items-center lg:gap-12">
        <div>
          <p className="eyebrow text-ink-muted">For corner shops, off-licences and pharmacies</p>
          <h1 className="mt-4 text-[2.75rem] font-extrabold leading-[1] tracking-[-0.04em] sm:text-display-xl">Nicked? Now you'll know.</h1>
          <p className="mt-5 max-w-md text-body-lg text-ink-muted">
            Upload your CCTV. Nicked flags the moments that look like concealment. You watch those, and nothing else.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to="/signup?next=free-scan" size="lg">Scan a clip free</ButtonLink>
            <ButtonLink to="/#walkthrough" size="lg" variant="secondary">Watch it flag</ButtonLink>
          </div>
          <p className="mt-4 text-caption text-ink-muted">One clip, up to an hour. No card.</p>
        </div>
        {/* Muted + playsInline so browsers allow autoplay, including on phones */}
        <video
          src="/nicked-hero.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label="Nicked flagging a possible concealment on a shop camera"
          className="aspect-video w-full rounded-md bg-feed object-cover"
        />
      </section>

      {/* The problem */}
      <section className="border-y border-hairline bg-section">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr] md:items-center">
          <h2 className="text-display">Something's gone. The footage is 11 hours long.</h2>
          <div>
            <p className="text-body-lg text-ink-muted">You have a shop to run. You're not going to sit and scrub through a day of CCTV. Nicked does it, and shows you only the bits worth a look.</p>
            <div className="mt-6" aria-hidden="true">
              <div className="relative h-3 rounded-[3px] bg-hairline">
                {[0.18, 0.47, 0.81].map((f) => (
                  <span key={f} className="absolute top-0 h-3 w-1.5 rounded-[2px] bg-signal" style={{ left: `${f * 100}%` }} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-caption text-ink-muted"><span>08:00</span><span>3 flags</span><span>19:00</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works: the PDF's numbered strip, step 02 carries the flag colour */}
      <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-16 sm:px-6">
        <p className="eyebrow text-ink-muted">How it works</p>
        <h2 id="how-h" className="mt-2 text-display">We flag. You decide.</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([n, title, body]) => (
            <li key={n}>
              <div className={n === '02' ? 'h-1 bg-signal' : 'h-1 bg-hairline'} aria-hidden="true" />
              <p className="mt-4 font-mono text-caption text-ink-muted">{n}</p>
              <h3 className="mt-1 text-h2">{title}</h3>
              <p className="mt-2 text-body text-ink-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* One real flag, walked through */}
      <section id="walkthrough" aria-labelledby="walk-h" className="scroll-mt-6 border-t border-hairline">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[7fr_5fr]">
          <div>
            <p className="eyebrow text-ink-muted">One flag, start to finish</p>
            <h2 id="walk-h" className="mt-2 text-display">Possible concealment, aisle 2</h2>
            <div className="mt-8 overflow-hidden rounded-md bg-feed">
              <FeedFrame camera="CAM 02 · Aisle 2" clock="14:32:12" rounded={false}
                detection={{ box: actorAt(SCRIPT, 21.5).box, label: 'Possible concealment · 87%' }}
                label="Still frame at 14:32:12: hand moving inside the jacket, boxed in orange">
                <Scene script={SCRIPT} t={21.5} />
              </FeedFrame>
              <div className="px-3 pb-3 pt-1 sm:px-4">
                <Timeline duration={LOOP} t={21.5} segments={SEGMENTS} label="Clip timeline" />
              </div>
            </div>
          </div>
          <div className="lg:pt-24">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-caption text-ink-muted">CAM 02 · 14:32:03 · 0:22 flagged</p>
              <ConfidenceMeter value={0.87} />
            </div>
            <ol className="mt-4 border-t border-hairline">
              {WALK.map((w) => (
                <li key={w.at} className="grid grid-cols-[4rem_1fr] gap-3 border-b border-hairline py-3">
                  <span className="font-mono text-caption">{timecode(w.at)}</span>
                  <span className="text-body">{w.text}</span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-h3">Then it's your call.</p>
            <p className="mt-1 text-body text-ink-muted">
              Four questions: picked up an item? Concealed it? Passed the till without paying? Left the shop? Yes to all four and you can confirm. One tap to dismiss.
            </p>
            <p className="mt-4 text-body font-semibold">Nothing goes to the Gardaí until you confirm.</p>
          </div>
        </div>
      </section>

      {/* Stat tiles: only true numbers */}
      <section aria-label="Nicked in numbers" className="border-t border-hairline">
        <dl className="mx-auto grid max-w-6xl gap-px bg-hairline sm:grid-cols-3">
          {[
            ['€0', 'New cameras needed. Nicked uses the ones you have.'],
            ['12 h', 'Of footage checked per camera, every day. Round the clock with 24/7.'],
            ['4', 'Questions you answer before anything is confirmed.'],
          ].map(([n, d]) => (
            <div key={n} className="bg-page px-4 py-10 sm:px-6">
              <dt className="sr-only">{d}</dt>
              <dd>
                <span className="block text-stat">{n}</span>
                <span className="mt-2 block max-w-xs text-body text-ink-muted">{d}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Pricing + subscribe: straight to Stripe Checkout */}
      <SubscribeSection />

      {/* FAQ */}
      <section id="faq" aria-labelledby="faq-h" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
          <h2 id="faq-h" className="text-display">Questions</h2>
          <div className="border-t border-hairline">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border-b border-hairline">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-h3 [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden="true" className="font-mono text-body text-ink-muted group-open:hidden">+</span>
                  <span aria-hidden="true" className="hidden font-mono text-body text-ink-muted group-open:inline">−</span>
                </summary>
                <p className="pb-5 text-body text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
        <p className="mt-12 text-body">
          Ready? <Link to="/signup?next=free-scan" className="font-semibold underline">Scan your first clip free</Link>.
        </p>
      </section>
    </>
  );
}

const CAMERA_OPTIONS = [1, 2, 4, 8];

/**
 * Pick cameras and billing period, then subscribe. POST /api/billing/checkout
 * creates a Stripe Checkout Session and the browser goes to Stripe; the webhook
 * unlocks the shop and /billing/success waits for it.
 */
function SubscribeSection() {
  const demo = useDemo();
  const navigate = useNavigate();
  const [cameras, setCameras] = useState(2);
  const [interval, setBillingInterval] = useState<Interval>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plan: Plan = { cameras, interval, addons: { always_on: 0, retention: false, location: 0 } };
  const per = interval === 'month' ? 'month' : 'year';

  const subscribe = async () => {
    setBusy(true);
    setError('');
    try {
      const how = await demo.beginCheckout(plan);
      // Preview mode has no Stripe: go straight to the success page.
      if (how === 'local') navigate('/billing/success?session_id=cs_test_preview');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section id="pricing" aria-labelledby="price-h" className="scroll-mt-6 border-t border-hairline bg-section">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1fr] md:items-start">
        <div>
          <p className="eyebrow text-ink-muted">Pricing</p>
          <h2 id="price-h" className="mt-2 text-display">From €29 a camera a month.</h2>
          <p className="mt-3 text-body-lg text-ink-muted">Cheaper per camera the more you have. Pay yearly and get two months free. Prices exclude VAT.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink to="/pricing" size="lg" variant="secondary">Add 24/7 or longer retention</ButtonLink>
            <ButtonLink to="/signup?next=free-scan" size="lg" variant="ghost">Scan a clip free</ButtonLink>
          </div>
        </div>

        <div className="rounded-lg border border-hairline bg-surface p-6 sm:p-8">
          <fieldset>
            <legend className="text-label">Billing</legend>
            <div className="mt-2 inline-flex rounded-full border-[1.5px] border-control p-0.5">
              {(['month', 'year'] as const).map((i) => (
                <label key={i} className={`focus-ring-within inline-flex h-9 cursor-pointer items-center rounded-full px-4 text-label ${interval === i ? 'bg-primary text-on-primary' : 'text-ink'}`}>
                  <input type="radio" name="interval" className="sr-only" checked={interval === i} onChange={() => setBillingInterval(i)} />
                  {i === 'month' ? 'Monthly' : 'Yearly'}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-label">Cameras</legend>
            <div className="mt-2 border-t border-hairline">
              {CAMERA_OPTIONS.map((n) => {
                const on = cameras === n;
                return (
                  <label key={n} className="focus-ring-within flex cursor-pointer items-center gap-3 border-b border-hairline py-3">
                    <input type="radio" name="cameras" className="size-4 accent-[var(--primary)]" checked={on} onChange={() => setCameras(n)} />
                    <span className={`flex-1 text-body ${on ? 'font-semibold' : ''}`}>{n} {n === 1 ? 'camera' : 'cameras'}</span>
                    <span className="font-mono text-caption tabular">{euro(quote({ ...plan, cameras: n }).total)} / {per}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className="mt-6 flex items-baseline justify-between gap-3">
            <span className="text-body text-ink-muted">Total</span>
            <span><span className="text-h2 tabular">{euro(quote(plan).total)}</span> <span className="text-body text-ink-muted">/ {per}</span></span>
          </p>
          <Button size="lg" className="mt-4 w-full" onClick={subscribe} loading={busy}>Subscribe</Button>
          {error && <p className="mt-3 text-caption font-semibold text-ink" role="alert">{error}</p>}
          <p className="mt-3 flex items-center gap-1.5 text-caption text-ink-muted">
            <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
            Secure checkout by Stripe. Test mode: card 4242 4242 4242 4242, any future date and CVC.
          </p>
        </div>
      </div>
    </section>
  );
}
