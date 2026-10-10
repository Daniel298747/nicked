import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { CreditCard, LayoutGrid, ListChecks, LogOut, Menu, Monitor, Moon, Sun, Upload, X } from 'lucide-react';
import { Logo } from '../brand/Logo';
import { ButtonLink } from '../ui/Button';
import { useDemo } from '../../demo/store';
import { PreviewControls } from '../../demo/ScreenStates';
import { cn } from '../../lib/hooks';

function SkipLink() {
  return (
    <a href="#main" className="sr-only z-[60] rounded-full bg-primary px-4 py-2 text-label text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
      Skip to content
    </a>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

type Theme = 'system' | 'light' | 'dark';
export function ThemeToggle({ onNav = false }: { onNav?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('nicked-theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('nicked-theme');
      else localStorage.setItem('nicked-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const opts: Array<{ v: Theme; icon: typeof Sun; label: string }> = [
    { v: 'system', icon: Monitor, label: 'Match device' },
    { v: 'light', icon: Sun, label: 'Light' },
    { v: 'dark', icon: Moon, label: 'Dark' },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex gap-0.5 rounded-full p-0.5', onNav ? 'bg-nav-active' : 'bg-section')}>
      {opts.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={theme === v}
          aria-label={label}
          title={label}
          onClick={() => setTheme(v)}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full transition-colors duration-[140ms]',
            onNav
              ? theme === v ? 'bg-nav text-nav-ink' : 'text-nav-muted hover:text-nav-ink'
              : theme === v ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

const marketingLinks = [
  { to: '/#how', label: 'How it works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/#faq', label: 'FAQ' },
];

export function MarketingLayout() {
  const [open, setOpen] = useState(false);
  const { signedIn } = useDemo();
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <ScrollTop />
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Nicked home" className="text-ink">
            <Logo />
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-6 md:flex">
            {marketingLinks.map((l) => (
              <Link key={l.to} to={l.to} className="text-label text-ink-muted hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {signedIn ? (
              <ButtonLink to="/app" variant="secondary" size="sm">Open dashboard</ButtonLink>
            ) : (
              <>
                <Link to="/login" className="px-3 text-label text-ink hover:underline">Log in</Link>
                <ButtonLink to="/signup?next=free-scan" size="sm">Scan a clip free</ButtonLink>
              </>
            )}
          </div>
          <button
            type="button"
            className="ml-auto inline-flex size-10 items-center justify-center rounded-full md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
          </button>
        </div>
        {open && (
          <nav id="mobile-menu" aria-label="Main" className="border-t border-hairline px-4 pb-4 md:hidden">
            {marketingLinks.map((l) => (
              <Link key={l.to} to={l.to} className="block border-b border-hairline py-3 text-body font-semibold">
                {l.label}
              </Link>
            ))}
            <div className="mt-4 flex gap-2">
              <ButtonLink to={signedIn ? '/app' : '/signup?next=free-scan'} className="flex-1">
                {signedIn ? 'Open dashboard' : 'Scan a clip free'}
              </ButtonLink>
              {!signedIn && <ButtonLink to="/login" variant="secondary">Log in</ButtonLink>}
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-hairline bg-section">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 text-body text-ink-muted">We flag. You decide.</p>
            <p className="mt-6 text-caption text-ink-muted">Prices exclude VAT. © 2026 Nicked.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-body">
            <Link to="/pricing" className="hover:underline">Pricing</Link>
            <Link to="/#faq" className="hover:underline">FAQ</Link>
            <Link to="/login" className="hover:underline">Log in</Link>
          </nav>
          <div>
            <p className="eyebrow text-ink-muted">Theme</p>
            <div className="mt-2"><ThemeToggle /></div>
          </div>
        </div>
      </footer>
      <PreviewControls />
    </div>
  );
}

export function BareLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <ScrollTop />
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Link to="/" aria-label="Nicked home" className="text-ink"><Logo /></Link>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <PreviewControls />
    </div>
  );
}

export function RequireAuth() {
  const { signedIn } = useDemo();
  const loc = useLocation();
  if (!signedIn) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <Outlet />;
}

export function AppShell() {
  const demo = useDemo();
  const plan = demo.plan;
  const items = [
    { to: '/app', label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: '/app/queue', label: 'Review queue', short: 'Queue', icon: ListChecks, count: demo.queueCount },
    { to: '/app/upload', label: 'Upload clip', short: 'Upload', icon: Upload },
    { to: '/app/settings/billing', label: 'Billing', icon: CreditCard },
  ];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <SkipLink />
      <ScrollTop />
      <aside className="sticky top-0 hidden h-dvh flex-col bg-nav px-4 py-6 text-nav-ink lg:flex">
        <Link to="/" aria-label="Nicked home" className="px-2"><Logo reversed /></Link>
        <div className="mt-8 px-2">
          <p className="text-label text-nav-ink">{demo.shop.name}</p>
          <p className="eyebrow mt-1 text-nav-muted">
            {plan && demo.isActive ? `${plan.cameras} cameras · ${plan.interval === 'month' ? 'Monthly' : 'Yearly'}` : 'No plan'}
          </p>
        </div>
        <nav aria-label="App" className="mt-6 flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon, end, count }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-full px-3 text-label transition-colors duration-[140ms]',
                  isActive ? 'bg-nav-active text-nav-ink' : 'text-nav-muted hover:text-nav-ink',
                )
              }
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {label}
              {!!count && (
                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1.5 font-mono text-caption text-on-signal">
                  {count}
                  <span className="sr-only"> flagged</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-4 px-2">
          <ThemeToggle onNav />
          <button type="button" onClick={demo.logOut} className="flex items-center gap-2 text-label text-nav-muted hover:text-nav-ink">
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" /> Log out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-page px-4 lg:hidden">
        <Link to="/" aria-label="Nicked home" className="text-ink"><Logo className="h-6" /></Link>
        <span className="ml-auto truncate text-caption text-ink-muted">{demo.shop.name}</span>
      </header>

      <main id="main" className="min-w-0 pb-24 lg:pb-0">
        <Outlet />
      </main>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-hairline bg-page lg:hidden">
        {items.map(({ to, label, short, icon: Icon, end, count }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn('relative flex h-16 flex-col items-center justify-center gap-1 text-caption', isActive ? 'text-ink' : 'text-ink-muted')
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-x-6 top-0 h-0.5 bg-ink" aria-hidden="true" />}
                <span className="relative">
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  {!!count && (
                    <span className="absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 font-mono text-[0.625rem] text-on-signal">
                      {count}
                    </span>
                  )}
                </span>
                {short ?? label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <PreviewControls raised />
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-hairline px-4 pb-6 pt-6 sm:px-8 sm:pt-10 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow text-ink-muted">{eyebrow}</p>}
        <h1 className="mt-1 text-h1 text-ink">{title}</h1>
        {children && <div className="mt-1 text-body text-ink-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
