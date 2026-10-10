import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Form';
import { ErrorState } from '../components/ui/States';
import { FeedFrame } from '../components/feed/FeedFrame';
import { Scene } from '../components/feed/Scene';
import { actorAt } from '../components/feed/script';
import { useDemo } from '../demo/store';
import { useScreenState } from '../demo/ScreenStates';
import { useDocumentTitle } from '../lib/hooks';
import type { ScriptParams } from '../data/types';

const STILL: ScriptParams = { scene: 'aisle', side: 'right', enter: 0, reach: 10, conceal: 15, exit: 30 };

function afterAuth(next: string | null) {
  if (next === 'checkout') return '/billing/success?session_id=cs_test_preview';
  if (next === 'free-scan') return '/app/upload';
  if (next && next.startsWith('/')) return next;
  return '/app';
}

function Side() {
  return (
    <div className="hidden bg-nav p-10 lg:flex lg:flex-col lg:justify-center">
      <FeedFrame
        camera="CAM 02 · Aisle 2"
        clock="14:32:07"
        detection={{ box: actorAt(STILL, 10.5).box, label: 'Possible concealment · 87%' }}
        label="CCTV still: a person at the shelf, boxed in orange as a possible concealment"
      >
        <Scene script={STILL} t={10.5} />
      </FeedFrame>
      <p className="mt-8 text-h2 text-nav-ink">Nothing goes to the Gardaí until you confirm.</p>
      <p className="mt-2 text-body text-nav-muted">Nicked flags. You watch the flagged bit and decide.</p>
    </div>
  );
}

export function Signup() {
  useDocumentTitle('Create your account');
  const demo = useDemo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const screen = useScreenState(['error']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = Object.fromEntries(f) as Record<string, string>;
    const errs: Record<string, string> = {};
    if (!v.shopName?.trim()) errs.shopName = 'Enter your shop name.';
    if (!/^\S+@\S+\.\S+$/.test(v.email ?? '')) errs.email = 'Enter an email address like name@shop.ie.';
    if ((v.password ?? '').length < 8) errs.password = 'Use at least 8 characters.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    // Real app: POST /auth/signup → { token, shop }
    window.setTimeout(() => {
      demo.signUp({ shopName: v.shopName, ownerName: v.ownerName, email: v.email });
      navigate(afterAuth(next));
    }, 400);
  };

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-2">
      <div className="px-4 py-10 sm:px-10 lg:py-16">
        <div className="mx-auto max-w-md">
          <p className="eyebrow text-ink-muted">{next === 'free-scan' ? 'Free first scan' : next === 'checkout' ? 'Step 1 of 2' : 'Sign up'}</p>
          <h1 className="mt-2 text-h1">Create your account</h1>
          <p className="mt-2 text-body text-ink-muted">
            {next === 'free-scan' ? 'Then upload one clip, up to an hour. No card needed.' : 'Then you pay securely with Stripe.'}
          </p>
          {screen === 'error' && (
            <ErrorState className="mt-6" title="That email already has an account" code="email_taken">
              <Link to="/login" className="font-semibold text-ink underline">Log in instead</Link>
            </ErrorState>
          )}
          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-5">
            <TextField label="Shop name" name="shopName" autoComplete="organization" defaultValue="Byrne's Foodstore" error={errors.shopName} />
            <TextField label="Your name" name="ownerName" autoComplete="name" defaultValue="Aoife Byrne" />
            <TextField label="Email" name="email" type="email" autoComplete="email" defaultValue="aoife@byrnesfoodstore.ie" error={errors.email} />
            <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="At least 8 characters." error={errors.password} />
            <Button type="submit" size="lg" loading={busy} className="mt-2">Create account</Button>
          </form>
          <p className="mt-6 text-body text-ink-muted">
            Have an account? <Link to={`/login${next ? `?next=${next}` : ''}`} className="font-semibold text-ink underline">Log in</Link>
          </p>
        </div>
      </div>
      <Side />
    </div>
  );
}

export function Login() {
  useDocumentTitle('Log in');
  const demo = useDemo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const screen = useScreenState(['error']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter the email you signed up with.');
    setBusy(true);
    // Real app: POST /auth/login → { token, shop }
    window.setTimeout(() => {
      demo.logIn(email);
      navigate(afterAuth(params.get('next')));
    }, 400);
  };
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-2">
      <div className="px-4 py-10 sm:px-10 lg:py-16">
        <div className="mx-auto max-w-md">
          <h1 className="text-h1">Log in</h1>
          {screen === 'error' && (
            <ErrorState className="mt-6" title="Email or password is wrong" code="invalid_credentials">Check them and try again.</ErrorState>
          )}
          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-5">
            <TextField label="Email" name="email" type="email" autoComplete="email" defaultValue="aoife@byrnesfoodstore.ie" error={error} />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" defaultValue="preview-only" />
            <Button type="submit" size="lg" loading={busy} className="mt-2">Log in</Button>
          </form>
          <p className="mt-6 text-body text-ink-muted">
            New to Nicked? <Link to="/signup" className="font-semibold text-ink underline">Create an account</Link>
          </p>
        </div>
      </div>
      <Side />
    </div>
  );
}
