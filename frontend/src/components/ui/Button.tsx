import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/hooks';

// Every button is a pill (brand PDF). One primary per view.
// primary   navy fill: the main action on a screen
// signal    Signal Orange: only for opening a flag ("Review flag")
// secondary outlined
// ghost     text only, for low-stakes actions like Dismiss
type Variant = 'primary' | 'signal' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,transform] duration-[140ms] ease-[var(--ease-press)] ' +
  'active:translate-y-px disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover disabled:bg-hairline disabled:text-ink-muted aria-disabled:bg-hairline aria-disabled:text-ink-muted',
  signal: 'bg-signal text-on-signal hover:bg-[color-mix(in_srgb,var(--signal)_88%,#0e1f35)] disabled:bg-hairline disabled:text-ink-muted',
  secondary: 'border-[1.5px] border-control bg-transparent text-ink hover:border-ink disabled:text-ink-muted disabled:border-hairline',
  ghost: 'bg-transparent text-ink underline-offset-4 hover:underline disabled:text-ink-muted',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-label',
  md: 'h-11 px-5 text-label',
  lg: 'h-12 px-6 text-[0.9375rem]',
};

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  className?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Common & ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], variant === 'ghost' && 'px-3', className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  className,
  children,
  ...rest
}: Omit<Common, 'loading'> & LinkProps) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], variant === 'ghost' && 'px-3', className)} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-4 animate-spin', className)} aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Inline text link with an arrow, for secondary navigation. */
export function TextLink({ className, children, ...rest }: LinkProps & { className?: string }) {
  return (
    <Link className={cn('font-semibold text-ink underline decoration-control underline-offset-4 hover:decoration-ink', className)} {...rest}>
      {children}
    </Link>
  );
}
