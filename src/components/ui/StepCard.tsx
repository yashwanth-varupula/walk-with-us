import type { ReactNode } from 'react';

interface StepCardProps {
  stepNumber: string; // e.g., "01"
  title: string;
  description: string;
  icon?: ReactNode;
}

/**
 * One numbered step in the "how it works" band.
 *
 * `text-slate-900` / `text-slate-600` were replaced with `text-ink` /
 * `text-ink-muted`, which are the same values expressed through the token the
 * rest of the app uses.
 */
export default function StepCard({ stepNumber, title, description, icon }: StepCardProps) {
  return (
    <div className="flex flex-col items-center p-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="text-lg font-bold">{stepNumber}</span>
      </div>
      {icon && <div className="mb-2 text-primary">{icon}</div>}
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-ink-muted">{description}</p>
    </div>
  );
}
