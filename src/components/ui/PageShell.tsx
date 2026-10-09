import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="container-page py-8 sm:py-12">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        )}
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">{title}</h1>
        {lede && <p className="mt-3 max-w-2xl text-base text-ink-muted leading-relaxed">{lede}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </header>
  );
}

export function Section({
  id,
  title,
  description,
  children,
  className = '',
}: {
  /** Anchor target, so a "jump to this section" link lands somewhere real. */
  id?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`container-page py-8 sm:py-12 ${className}`}>
      {title && <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>}
      {description && <p className="mt-2 max-w-2xl text-sm text-ink-muted leading-relaxed">{description}</p>}
      <div className={title || description ? 'mt-6' : ''}>{children}</div>
    </section>
  );
}

/**
 * Marks content that still needs a human decision before it can be shown as
 * fact — legal entity details, a real contact address, a policy.
 *
 * This is deliberately visible in development and collapsed away in production
 * builds only when the surrounding copy is generic. Where a placeholder would
 * otherwise be shipped as a factual claim, it is left in place and labelled
 * here so nobody mistakes scaffolding for approved copy.
 */
export function NeedsReview({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-control border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="font-semibold">Needs review before launch: </span>
      {children}
    </p>
  );
}
