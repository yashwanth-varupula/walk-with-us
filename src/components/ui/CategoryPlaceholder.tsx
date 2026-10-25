import {
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  House,
  Siren,
  Sparkles,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryVisual {
  icon: LucideIcon;
  label: string;
  gradient: string;
  badgeColor: string;
  iconBg: string;
}

export function getCategoryVisualMeta(categoryName?: string | null): CategoryVisual {
  const norm = (categoryName || '').toLowerCase();
  if (norm.includes('med') || norm.includes('health') || norm.includes('doctor')) {
    return {
      icon: HeartPulse,
      label: categoryName || 'Medical & Healthcare',
      gradient: 'from-rose-50 via-rose-50/40 to-canvas',
      badgeColor: 'text-rose-700 bg-rose-50 border-rose-200/80',
      iconBg: 'bg-rose-100/80 text-rose-700 border border-rose-200/60',
    };
  }
  if (norm.includes('edu') || norm.includes('school') || norm.includes('learn') || norm.includes('college')) {
    return {
      icon: GraduationCap,
      label: categoryName || 'Education & Learning',
      gradient: 'from-sky-50 via-sky-50/40 to-canvas',
      badgeColor: 'text-sky-700 bg-sky-50 border-sky-200/80',
      iconBg: 'bg-sky-100/80 text-sky-700 border border-sky-200/60',
    };
  }
  if (norm.includes('food') || norm.includes('nutrit') || norm.includes('meal')) {
    return {
      icon: Utensils,
      label: categoryName || 'Food & Nutrition',
      gradient: 'from-emerald-50 via-emerald-50/40 to-canvas',
      badgeColor: 'text-emerald-700 bg-emerald-50 border-emerald-200/80',
      iconBg: 'bg-emerald-100/80 text-emerald-700 border border-emerald-200/60',
    };
  }
  if (norm.includes('elder') || norm.includes('senior') || norm.includes('aging')) {
    return {
      icon: HeartHandshake,
      label: categoryName || 'Elderly Care',
      gradient: 'from-amber-50 via-amber-50/40 to-canvas',
      badgeColor: 'text-amber-700 bg-amber-50 border-amber-200/80',
      iconBg: 'bg-amber-100/80 text-amber-700 border border-amber-200/60',
    };
  }
  if (norm.includes('hous') || norm.includes('shelter') || norm.includes('repair') || norm.includes('roof')) {
    return {
      icon: House,
      label: categoryName || 'Housing & Shelter',
      gradient: 'from-teal-50 via-teal-50/40 to-canvas',
      badgeColor: 'text-teal-700 bg-teal-50 border-teal-200/80',
      iconBg: 'bg-teal-100/80 text-teal-700 border border-teal-200/60',
    };
  }
  if (norm.includes('emerg') || norm.includes('disaster') || norm.includes('urgent') || norm.includes('fire')) {
    return {
      icon: Siren,
      label: categoryName || 'Emergency Assistance',
      gradient: 'from-red-50 via-red-50/40 to-canvas',
      badgeColor: 'text-red-700 bg-red-50 border-red-200/80',
      iconBg: 'bg-red-100/80 text-red-700 border border-red-200/60',
    };
  }
  return {
    icon: Sparkles,
    label: categoryName || 'Community Need',
    gradient: 'from-indigo-50 via-indigo-50/40 to-canvas',
    badgeColor: 'text-indigo-700 bg-indigo-50 border-indigo-200/80',
    iconBg: 'bg-indigo-100/80 text-indigo-700 border border-indigo-200/60',
  };
}

interface CategoryCoverPlaceholderProps {
  categoryName?: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CategoryCoverPlaceholder({
  categoryName,
  className = '',
  size = 'md',
}: CategoryCoverPlaceholderProps) {
  const visual = getCategoryVisualMeta(categoryName);
  const Icon = visual.icon;

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  const badgePadding = {
    sm: 'p-2',
    md: 'p-3',
    lg: 'p-4',
  };

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center bg-gradient-to-br ${visual.gradient} text-center select-none ${className}`}
      aria-hidden="true"
    >
      <div className={`rounded-xl shadow-xs ${visual.iconBg} ${badgePadding[size]}`}>
        <Icon className={iconSizes[size]} aria-hidden="true" />
      </div>
      <span className="mt-2 text-[11px] font-semibold tracking-wider uppercase text-ink-subtle">
        {visual.label}
      </span>
    </div>
  );
}
