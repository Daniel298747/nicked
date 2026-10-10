import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/layout/Layouts';
import { Button, ButtonLink } from '../components/ui/Button';
import { ErrorState, LoadingAnnouncer, LockedState, Notice, Skeleton } from '../components/ui/States';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { quote } from '../lib/pricing';
import { euro, longDate } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

export default function Billing() {
  useDocumentTitle('Billing');
  const demo = useDemo();
  const screen = useScreenState(['loading', 'error', 'locked']);
  const [opening, setOpening] = useState(false);
  const [note, setNote] = useState('');
  const plan = demo.plan;
  const locked = screen === 'locked' || !demo.isActive || !plan;
  const ent = demo.entitlements;
  const renew = new Date();
  renew.setMonth(renew.getMonth() + (plan?.interval === 'year' ? 12 : 1));

  const manage = async () => {
    // POST /api/billing/portal → { url }, then Stripe's billing portal
    setOpening(true);
    try {
      const url = await demo.openBillingPortal();
      if (url) return window.location.assign(url);
      setNote("In the live app this opens Stripe's billing portal: change card, cameras, or cancel.");
    } catch (err) {
      setNote((err as Error).message);
    }
    setOpening(false);
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Billing" />
      <div className="max-w-3xl px-4 py-8 sm:px-8">
        {screen === 'loading' ? (
          <><LoadingAnnouncer what="billing" /><Skeleton className="h-10 w-48" /><Skeleton className="mt-6 h-48 w-full" /></>
        ) : screen === 'error' ? (
          <ErrorState title="Couldn't load your plan" code="billing_unavailable" actions={<Button onClick={() => location.reload()}>Try again</Button>}>
            Stripe didn't answer. Your plan hasn't changed.
          </ErrorState>
        ) : locked ? (
          <LockedState title="No active plan." actions={<ButtonLink to="/pricing">Choose a plan</ButtonLink>}>
            From €29 a camera a month. Prices exclude VAT.
          </LockedState>
        ) : (
          <>
            {demo.subscription === 'past_due' && (
              <Notice tone="warn" className="mb-8">Your last payment didn't go through. Update the card within 3 days to keep analysis running.</Notice>
            )}
            <section aria-labelledby="plan-h">
              <h2 id="plan-h" className="eyebrow text-ink-muted">Your plan</h2>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="text-stat tabular">{euro(quote(plan).total)}</span>
                <span className="text-body text-ink-muted">/ {plan.interval === 'month' ? 'month' : 'year'} · excl. VAT</span>
              </p>
              {demo.shop.isFounding && <p className="mt-2 text-label">Founding Shop price, locked in.</p>}
              <dl className="mt-6 border-t border-hairline text-body">
                {[
                  ['Cameras', `${plan.cameras}`],
                  ['Billing', plan.interval === 'month' ? 'Monthly' : 'Yearly'],
                  ['24/7 monitoring', ent?.camerasAlwaysOn ? `${ent.camerasAlwaysOn} cameras` : 'Off'],
                  ['Clips kept for', `${ent?.retentionDays ?? 30} days`],
                  ['Locations', `${ent?.locationsAllowed ?? 1}`],
                  ['Renews', longDate(renew.toISOString())],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-hairline py-3">
                    <dt className="text-ink-muted">{k}</dt>
                    <dd className="font-mono text-caption">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={manage} loading={opening} iconRight={<ExternalLink size={16} strokeWidth={1.75} />}>Manage billing</Button>
              <ButtonLink to="/pricing" variant="ghost">Compare plans</ButtonLink>
            </div>
            <p className="mt-3 text-caption text-ink-muted">Update your card, download invoices, change cameras or cancel. Cancelling ends at the close of the period you paid for.</p>
            {note && <Notice className="mt-6">{note}</Notice>}
          </>
        )}
      </div>
    </>
  );
}
