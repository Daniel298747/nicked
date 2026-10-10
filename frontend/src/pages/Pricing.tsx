import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Checkbox, Segmented, Stepper } from '../components/ui/Form';
import { ErrorState } from '../components/ui/States';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { ADDONS, CAMERA_TIERS, MAX_CAMERAS, MIN_CAMERAS, quote } from '../lib/pricing';
import { euro } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';
import type { Plan } from '../data/types';

const INCLUDED = [
  'Analysis of up to 12 hours of footage a day',
  'The review queue',
  'The four-question confirmation checklist',
  'Unlimited incident reports',
  'Flagged clips kept for 30 days',
];

const OFFERS = [
  ['Free first scan', 'One clip, up to an hour, before you pay a cent.'],
  ['Founding Shop price', 'The first 100 shops keep this price for good.'],
  ['30-day money-back guarantee', 'Not for you? We refund your first invoice.'],
  ['Cancel anytime', 'Your plan runs to the end of the period you paid for.'],
];

export default function Pricing() {
  useDocumentTitle('Pricing');
  const demo = useDemo();
  const navigate = useNavigate();
  const screen = useScreenState(['error']);
  const [plan, setPlan] = useState<Plan>(demo.pendingPlan ?? { cameras: 4, interval: 'month', addons: { always_on: 0, retention: false, location: 0 } });
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const q = quote(plan);
  const per = plan.interval === 'month' ? 'month' : 'year';
  const set = (p: Partial<Plan>) => setPlan((prev) => ({ ...prev, ...p }));
  const setAddon = (a: Partial<Plan['addons']>) => setPlan((prev) => ({ ...prev, addons: { ...prev.addons, ...a } }));

  const subscribe = async () => {
    setBusy(true);
    setCheckoutError('');
    if (!demo.signedIn) {
      demo.startCheckout(plan);
      navigate('/signup?next=checkout');
      return;
    }
    try {
      // POST /api/billing/checkout { cameras, interval, addons } → redirect to Stripe Checkout
      const how = await demo.beginCheckout(plan);
      if (how === 'local') window.setTimeout(() => navigate('/billing/success?session_id=cs_test_preview'), 500);
    } catch (err) {
      setCheckoutError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
      <p className="eyebrow text-ink-muted">Pricing</p>
      <h1 className="mt-2 max-w-3xl text-display text-ink sm:text-display-xl">€29 a camera. Less the more you have.</h1>
      <p className="mt-4 max-w-xl text-body-lg text-ink-muted">Use the cameras you already have. Pick how many, see the price, change it any time.</p>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_22rem] lg:gap-16">
        <div>
          <section aria-labelledby="cams" className="border-t border-hairline pt-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="cams" className="text-h2">How many cameras?</h2>
                <p className="mt-1 text-body text-ink-muted">From {MIN_CAMERAS} to {MAX_CAMERAS}.</p>
              </div>
              <Stepper label="Cameras" hideLabel size="lg" value={plan.cameras} min={MIN_CAMERAS} max={MAX_CAMERAS} onChange={(cameras) => set({ cameras })} />
            </div>
            <input
              type="range"
              min={MIN_CAMERAS}
              max={MAX_CAMERAS}
              value={plan.cameras}
              onChange={(e) => set({ cameras: Number(e.target.value) })}
              aria-label="Cameras"
              className="mt-6 w-full accent-[var(--primary)]"
            />
            <table className="mt-6 w-full text-body">
              <caption className="sr-only">Price per camera by tier</caption>
              <tbody>
                {CAMERA_TIERS.map((t) => {
                  const line = q.lines.find((l) => l.key === `tier-${t.from}`);
                  return (
                    <tr key={t.from} className={line ? 'text-ink' : 'text-ink-muted'}>
                      <th scope="row" className="border-b border-hairline py-2.5 text-left font-normal">{t.label}</th>
                      <td className="border-b border-hairline py-2.5 text-right font-mono tabular">
                        {line ? `${line.qty} × ${euro(line.unit)}` : `${euro(plan.interval === 'month' ? t.monthly : t.monthly * 10)} each`}
                      </td>
                      <td className="w-24 border-b border-hairline py-2.5 text-right font-mono tabular">{line ? euro(line.total) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="billing" className="mt-12 border-t border-hairline pt-8">
            <h2 id="billing" className="text-h2">Pay monthly or yearly</h2>
            <Segmented
              className="mt-4"
              label="Billing interval"
              value={plan.interval}
              onChange={(interval) => set({ interval })}
              options={[
                { value: 'month', label: 'Monthly' },
                { value: 'year', label: <>Yearly <span className="font-normal opacity-80">· 2 months free</span></> },
              ]}
            />
          </section>

          <section aria-labelledby="addons" className="mt-12 border-t border-hairline pt-8">
            <h2 id="addons" className="text-h2">Add-ons</h2>
            <div className="mt-6 flex flex-col gap-6">
              <Checkbox
                checked={plan.addons.always_on > 0}
                onChange={(v) => setAddon({ always_on: v ? Math.min(1, plan.cameras) : 0 })}
                description={<>Watch round the clock instead of 12 hours a day. <span className="font-mono">{euro(ADDONS.always_on.monthly * (plan.interval === 'year' ? 10 : 1))}</span> per camera a {per}.</>}
                aside={plan.addons.always_on > 0 && (
                  <div className="mt-3">
                    <Stepper label="Cameras with 24/7" value={plan.addons.always_on} min={1} max={plan.cameras} onChange={(always_on) => setAddon({ always_on })} />
                  </div>
                )}
              >
                {ADDONS.always_on.name}
              </Checkbox>
              <Checkbox
                checked={plan.addons.retention}
                onChange={(retention) => setAddon({ retention })}
                description={<>Keep flagged clips for 90 days instead of 30. <span className="font-mono">{euro(ADDONS.retention.monthly * (plan.interval === 'year' ? 10 : 1))}</span> a {per}.</>}
              >
                {ADDONS.retention.name}
              </Checkbox>
              <Checkbox
                checked={plan.addons.location > 0}
                onChange={(v) => setAddon({ location: v ? 1 : 0 })}
                description={<>Run more than one shop from one account. <span className="font-mono">{euro(ADDONS.location.monthly * (plan.interval === 'year' ? 10 : 1))}</span> per extra location a {per}.</>}
                aside={plan.addons.location > 0 && (
                  <div className="mt-3">
                    <Stepper label="Extra locations" value={plan.addons.location} min={1} max={20} onChange={(location) => setAddon({ location })} />
                  </div>
                )}
              >
                {ADDONS.location.name}
              </Checkbox>
            </div>
          </section>

          <section aria-labelledby="included" className="mt-12 border-t border-hairline pt-8">
            <h2 id="included" className="text-h2">Every camera includes</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {INCLUDED.map((i) => (
                <li key={i} className="flex items-start gap-2 text-body">
                  <Check size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {i}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside aria-labelledby="total" className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg bg-section p-6">
            <h2 id="total" className="eyebrow text-ink-muted">Your total</h2>
            <p className="mt-3 flex items-baseline gap-2" aria-live="polite">
              <span className="text-stat tabular">{euro(q.total)}</span>
              <span className="text-body text-ink-muted">/ {per}</span>
            </p>
            <p className="mt-1 text-caption font-semibold text-ink">Prices exclude VAT</p>
            {plan.interval === 'year' && (
              <p className="mt-2 text-caption text-ink-muted">
                Same plan monthly: <span className="font-mono">{euro(q.yearAtMonthly)}</span> a year. You save <span className="font-mono">{euro(q.saved)}</span>.
              </p>
            )}
            <dl className="mt-5 border-t border-hairline pt-4 text-caption">
              {q.lines.map((l) => (
                <div key={l.key} className="flex justify-between gap-3 py-1">
                  <dt className="text-ink-muted">{l.label}{l.qty > 1 ? ` × ${l.qty}` : ''}</dt>
                  <dd className="font-mono tabular text-ink">{euro(l.total)}</dd>
                </div>
              ))}
            </dl>
            {screen === 'error' && (
              <ErrorState className="mt-5" title="Checkout didn't open" code="checkout_unavailable">
                Nothing was charged. Try again in a minute.
              </ErrorState>
            )}
            <Button size="lg" className="mt-6 w-full" onClick={subscribe} loading={busy}>
              Subscribe
            </Button>
              {checkoutError && <p className="mt-3 text-caption font-semibold text-ink" role="alert">{checkoutError}</p>}
            <p className="mt-3 text-caption text-ink-muted">Secure payment by Stripe. You can change cameras later.</p>
          </div>
          <ul className="mt-6 flex flex-col gap-4">
            {OFFERS.map(([t, d]) => (
              <li key={t} className="border-l-2 border-ink pl-3">
                <p className="text-label text-ink">{t}</p>
                <p className="text-caption text-ink-muted">{d}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
