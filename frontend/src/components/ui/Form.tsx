import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { CircleAlert, Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/hooks';

const control =
  'h-11 w-full rounded-sm border-[1.5px] border-control bg-surface px-3 text-body text-ink placeholder:text-ink-muted ' +
  'transition-colors duration-[140ms] hover:border-ink aria-invalid:border-ink aria-invalid:border-2';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-caption font-semibold text-ink">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...rest
}: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-label text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-caption text-ink-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        className={cn(control, 'mt-1.5')}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint && hintId, error && errId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  className,
  ...rest
}: { label: string; hint?: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-label text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-caption text-ink-muted">
          {hint}
        </p>
      )}
      <div className="relative mt-1.5">
        <select
          id={id}
          className={cn(control, 'appearance-none pr-10')}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint && hintId, error && errId].filter(Boolean).join(' ') || undefined}
          {...rest}
        >
          {children}
        </select>
        <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

/** Square checkbox; the tick draws in when checked. */
export function Checkbox({
  checked,
  onChange,
  children,
  description,
  aside,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={description ? `${id}-d` : undefined}
          className="peer size-5 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-control bg-surface transition-colors duration-[140ms] checked:border-primary checked:bg-primary hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
        />
        {checked && (
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute inset-0 text-on-primary" aria-hidden="true">
            <path
              d="M5.5 10.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="anim-draw"
              style={{ ['--dash' as string]: 16 }}
            />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="cursor-pointer text-body font-semibold text-ink">
          {children}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-caption text-ink-muted">
            {description}
          </p>
        )}
        {aside}
      </div>
    </div>
  );
}

/** Two or three options in a pill, built on native radios (arrow keys work). */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex rounded-full border-[1.5px] border-control p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'focus-ring-within relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-label transition-colors duration-[140ms]',
              value === o.value ? 'bg-primary text-on-primary' : 'text-ink hover:bg-section',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Number with − / + buttons. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  size = 'md',
  hideLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  size?: 'md' | 'lg';
  hideLabel?: boolean;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : min));
  const btn =
    'inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-control text-ink transition-[border-color,transform] duration-[140ms] hover:border-ink active:translate-y-px disabled:opacity-40 disabled:pointer-events-none';
  const lg = size === 'lg';
  return (
    <div>
      <label htmlFor={id} className={cn('block text-label text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className={cn('flex items-center gap-2', !hideLabel && 'mt-1.5')}>
        <button type="button" className={cn(btn, lg ? 'size-12' : 'size-9')} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Fewer: ${label}`}>
          <Minus size={lg ? 20 : 16} strokeWidth={1.75} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
          className={cn(
            'rounded-sm border-[1.5px] border-control bg-surface text-center font-bold tabular text-ink [appearance:textfield] hover:border-ink [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            lg ? 'h-12 w-20 text-h2' : 'h-9 w-14 text-body',
          )}
        />
        <button type="button" className={cn(btn, lg ? 'size-12' : 'size-9')} onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`More: ${label}`}>
          <Plus size={lg ? 20 : 16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
