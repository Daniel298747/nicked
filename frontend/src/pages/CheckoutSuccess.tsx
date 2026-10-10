import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ButtonLink, Spinner } from '../components/ui/Button';
import { ErrorState } from '../components/ui/States';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { euro } from '../lib/format';
import { quote } from '../lib/pricing';
import { cn, useDocumentTitle } from '../lib/hooks';

// Access only changes when the backend's Stripe webhook lands, so this page
// waits on GET /me until subscriptionStatus is "active".
export default function CheckoutSuccess() {
  useDocumentTitle('Confirming your payment');
  const demo = useDemo();
  const screen = useScreenState(['loading', 'error']);
  const [step, setStep] = useState(demo.isActive ? 3 : 1);

  useEffect(() => {
    if (screen !== 'live' || demo.isActive) return;
    const a = window.setTimeout(() => setStep(2), 1200);
    const b = window.setTimeout(() => {
      demo.activate();
      setStep(3);
    }, 2800);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const done = screen === 'live' && (step === 3 || demo.isActive);
  const steps = ['Payment taken by Stripe', 'Waiting for confirmation', 'Turning on your cameras'];
  const active = screen === 'loading' ? 1 : done ? 3 : step;
  const plan = demo.plan ?? demo.pendingPlan;

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      {screen === 'error' ? (
        <ErrorState
          title="We haven't heard back from Stripe yet"
          code="payment_unconfirmed"
          actions={<><ButtonLink to="/billing/success">Check again</ButtonLink><ButtonLink to="/pricing" variant="secondary">Back to pricing</ButtonLink></>}
        >
          Your card may still have been charged. It usually takes under a minute. If it's been longer, check again.
        </ErrorState>
      ) : (
        <>
          <p className="eyebrow text-ink-muted">Step 2 of 2</p>
          <h1 className="mt-2 text-display" aria-live="polite">{done ? "You're set." : 'Confirming your payment'}</h1>
          <p className="mt-3 text-body-lg text-ink-muted">
            {done && plan
              ? `${plan.cameras} cameras active. ${euro(quote(plan).total)} a ${plan.interval === 'month' ? 'month' : 'year'}, excl. VAT.`
              : 'This takes a few seconds. Keep this page open.'}
          </p>
          <ol className="mt-10 border-t border-hairline">
            {steps.map((s, i) => {
              const n = i + 1;
              const complete = active > n || done;
              const current = active === n && !done;
              return (
                <li key={s} className="flex items-center gap-3 border-b border-hairline py-4">
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full border-[1.5px]',
                      complete ? 'border-ink bg-ink text-page' : 'border-control text-ink-muted',
                    )}
                    aria-hidden="true"
                  >
                    {complete ? <Check size={14} strokeWidth={2.5} /> : current ? <Spinner className="size-3.5" /> : <span className="font-mono text-caption">{n}</span>}
                  </span>
                  <span className={cn('text-body', complete || current ? 'text-ink' : 'text-ink-muted')}>{s}</span>
                  <span className="sr-only">{complete ? 'done' : current ? 'in progress' : 'waiting'}</span>
                </li>
              );
            })}
          </ol>
          {done && (
            <div className="anim-rise mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/app" size="lg">Open dashboard</ButtonLink>
              <ButtonLink to="/app/upload" size="lg" variant="secondary">Upload clip</ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}
