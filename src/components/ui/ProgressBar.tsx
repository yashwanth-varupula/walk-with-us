import type { HTMLAttributes } from 'react';
import { formatINR } from '../../lib/format';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  target?: number | null;
  raised?: number | null;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  tone?: 'primary' | 'accent' | 'good';
}

export function ProgressBar({
  value,
  target,
  raised,
  size = 'md',
  showLabel = false,
  className = '',
  tone = 'primary',
  ...rest
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-3.5',
  };

  const toneClasses = {
    primary: 'bg-primary',
    accent: 'bg-accent',
    good: 'bg-emerald-600',
  };

  return (
    <div className={`w-full ${className}`} {...rest}>
      {showLabel && target && target > 0 && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-semibold text-ink">
            {formatINR(raised ?? 0)}{' '}
            <span className="font-normal text-ink-muted">raised of {formatINR(target)}</span>
          </span>
          <span className="font-bold text-ink tabular-nums">{clamped}%</span>
        </div>
      )}
      <div
        className={`w-full overflow-hidden rounded-full bg-slate-200/80 ${sizeClasses[size]}`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          target && target > 0
            ? `${formatINR(raised ?? 0)} raised of ${formatINR(target)}, ${clamped} percent funded`
            : `Funding progress: ${clamped} percent`
        }
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${toneClasses[tone]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
