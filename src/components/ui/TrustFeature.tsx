import type { ReactNode } from 'react';

interface TrustFeatureProps {
  icon: ReactNode;
  title: string;
  description: string;
}

/**
 * One of the four "why people trust us" items.
 *
 * The heading was an <h4> under an <h2> with no <h3> in between, which skipped a
 * level in the document outline. It is now an <h3>, matching the section
 * heading it sits under, and the raw `text-slate-*` values are the semantic
 * `text-ink` / `text-ink-muted` tokens.
 */
export default function TrustFeature({ icon, title, description }: TrustFeatureProps) {
  return (
    <div className="flex flex-col items-center p-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center text-primary">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-ink-muted">{description}</p>
    </div>
  );
}
