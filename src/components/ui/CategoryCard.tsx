import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

interface CategoryCardProps {
  title: string;
  icon: ReactNode;
  href?: string;
  description?: string | null;
}

export default function CategoryCard({ title, icon, href = '/help', description }: CategoryCardProps) {
  return (
    <Link
      to={href}
      className="group relative flex flex-col items-center justify-between rounded-card border border-line bg-surface p-5 text-center transition-colors hover:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="absolute top-3 right-3 text-slate-300 transition-colors group-hover:text-primary">
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </div>

      <div className="flex h-12 w-12 items-center justify-center rounded-control bg-primary-soft text-primary">
        {icon}
      </div>

      <div className="mt-3 w-full">
        <span className="block text-sm font-semibold text-ink group-hover:text-primary transition-colors sm:text-base">
          {title}
        </span>
        {description && (
          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-ink-muted">
            {description}
          </span>
        )}
      </div>
    </Link>
  );
}
