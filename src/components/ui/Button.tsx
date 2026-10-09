import { Link, type LinkProps } from 'react-router-dom';
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-slate-50 shadow-sm',
  ghost: 'bg-transparent text-ink-muted hover:bg-slate-100 hover:text-ink',
  danger: 'bg-rose-700 text-white hover:bg-rose-800 shadow-sm',
  accent: 'bg-accent text-white hover:bg-accent/90 shadow-sm',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-control font-medium transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none min-h-[38px] sm:min-h-0';

/**
 * Spinner shown while a button's action is in flight.
 *
 * The visible label stays in the DOM and is merely hidden from sight, so the
 * button keeps its accessible name while it is busy. Replacing the label with a
 * bare "Loading…" was previously announced as a name change mid-interaction.
 */
function Busy({ label }: { label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
      />
      <span className="sr-only">{label}</span>
    </>
  );
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  /** Renders a spinner and blocks interaction. `aria-busy` is set for you. */
  loading?: boolean;
  /** Announced to screen readers while loading. Defaults to "Working…". */
  loadingLabel?: string;
  /** Stretches to the full width of its container. */
  block?: boolean;
  className?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel = 'Working…',
    block = false,
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Busy label={loadingLabel} /> : children}
    </button>
  );
});

export interface LinkButtonProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  /** Stretches to the full width of its container. */
  block?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A router link that looks like a button.
 *
 * This exists so navigation can be rendered as a link (correct semantics,
 * middle-clickable, announced as a link) while still looking like the primary
 * action. The previous pattern wrapped a real <button> inside an <a>, which
 * produced nested interactive elements and a keyboard trap.
 */
export function LinkButton({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </Link>
  );
}

/**
 * A link that must look like a button but points outside the router (a mailto:,
 * tel:, or a real external URL). Kept separate from LinkButton so an internal
 * path can never be rendered as a full page reload.
 */
export function ExternalLinkButton({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
}

export default Button;
