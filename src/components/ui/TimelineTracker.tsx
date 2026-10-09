import { formatDateTime } from '../../lib/format';

export interface TimelineNode {
  key: 'submitted' | 'under_review' | 'verified' | 'published' | 'active' | 'resolved';
  title: string;
  description: string;
  date?: string | null;
  status: 'done' | 'current' | 'upcoming' | 'rejected';
}

interface TimelineTrackerProps {
  status: string;
  rejectionReason?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  className?: string;
}

export function buildLifecycleNodes({
  status,
  rejectionReason,
  submittedAt,
  verifiedAt,
  publishedAt,
  updatedAt,
}: {
  status: string;
  rejectionReason?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
}): TimelineNode[] {
  const isDraft = status === 'draft';
  const isRejected = status === 'rejected';

  const getStageStatus = (
    stage: 'submitted' | 'under_review' | 'verified' | 'published' | 'active' | 'resolved',
  ): 'done' | 'current' | 'upcoming' | 'rejected' => {
    if (isDraft) {
      return 'upcoming';
    }

    if (isRejected) {
      if (stage === 'submitted' || stage === 'under_review') return 'done';
      if (stage === 'verified') return 'rejected';
      return 'upcoming';
    }

    if (status === 'closed') {
      if (stage === 'submitted' && submittedAt) return 'done';
      if (stage === 'under_review' && (verifiedAt || publishedAt)) return 'done';
      if (stage === 'verified' && (verifiedAt || publishedAt)) return 'done';
      if (stage === 'published' && publishedAt) return 'done';
      return 'upcoming';
    }

    const order: Array<TimelineNode['key']> = [
      'submitted',
      'under_review',
      'verified',
      'published',
      'active',
      'resolved',
    ];

    const currentKey: TimelineNode['key'] =
      status === 'submitted'
        ? 'submitted'
        : status === 'under_review'
          ? 'under_review'
          : status === 'verified'
            ? 'verified'
            : status === 'published'
              ? 'published'
              : status === 'active'
                ? 'active'
                : status === 'resolved'
                  ? 'resolved'
                  : 'submitted';

    const currentIdx = order.indexOf(currentKey);
    const stageIdx = order.indexOf(stage);

    if (stageIdx < currentIdx) return 'done';
    if (stageIdx === currentIdx) {
      return status === 'resolved' ? 'done' : 'current';
    }
    return 'upcoming';
  };

  return [
    {
      key: 'submitted',
      title: 'Submitted',
      description: isDraft
        ? 'Waiting for submission. Remains private until submitted.'
        : 'Received and placed in the staff verification queue.',
      date: submittedAt,
      status: getStageStatus('submitted'),
    },
    {
      key: 'under_review',
      title: 'Under Review',
      description:
        status === 'under_review'
          ? 'Staff reviewer is actively examining details and verifying documents.'
          : 'Staff reviews situation authenticity and supporting documents.',
      date: status === 'under_review' ? updatedAt : null,
      status: getStageStatus('under_review'),
    },
    {
      key: 'verified',
      title: isRejected ? 'Review Update' : 'Verified',
      description: isRejected
        ? rejectionReason || 'Review team noted revisions required.'
        : 'Request and documentation authenticated by staff.',
      date: isRejected ? updatedAt : verifiedAt,
      status: getStageStatus('verified'),
    },
    {
      key: 'published',
      title: 'Published',
      description: 'Request made live on the public directory for community support.',
      date: publishedAt,
      status: getStageStatus('published'),
    },
    {
      key: 'active',
      title: 'Active Support',
      description: 'Community members, donors, and volunteers contribute assistance.',
      date: null,
      status: getStageStatus('active'),
    },
    {
      key: 'resolved',
      title: 'Resolved',
      description: 'Need has been fulfilled and support delivered.',
      date: status === 'resolved' ? updatedAt : null,
      status: getStageStatus('resolved'),
    },
  ];
}

export function TimelineTracker({
  status,
  rejectionReason,
  createdAt,
  submittedAt,
  verifiedAt,
  publishedAt,
  updatedAt,
  className = '',
}: TimelineTrackerProps) {
  const nodes = buildLifecycleNodes({
    status,
    rejectionReason,
    createdAt,
    submittedAt,
    verifiedAt,
    publishedAt,
    updatedAt,
  });

  return (
    <div className={className} aria-label="Request lifecycle journey">
      <ol className="relative space-y-0" aria-label="Request journey steps">
        {nodes.map((node, index) => {
          const isLast = index === nodes.length - 1;

          return (
            <li key={node.key} className="relative flex gap-3.5 sm:gap-4">
              {/* Thin Connecting Line */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={`absolute left-[7px] top-3 -bottom-2 w-[2px] ${
                    node.status === 'done'
                      ? 'bg-primary'
                      : node.status === 'rejected'
                        ? 'bg-rose-300'
                        : 'bg-line'
                  }`}
                />
              )}

              {/* Status Marker: Small, restrained dot/circle */}
              <div className="relative z-10 flex shrink-0 items-start pt-1">
                {node.status === 'done' ? (
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white ring-4 ring-canvas"
                    aria-label={`Completed: ${node.title}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                ) : node.status === 'current' ? (
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-4 ring-primary-soft-strong"
                    aria-label={`Current stage: ${node.title}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                ) : node.status === 'rejected' ? (
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 ring-4 ring-rose-100"
                    aria-label={`Needs revision: ${node.title}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                ) : (
                  <span
                    className="h-4 w-4 rounded-full border-2 border-line bg-canvas ring-4 ring-canvas"
                    aria-label={`Upcoming: ${node.title}`}
                  />
                )}
              </div>

              {/* Text Content */}
              <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-5'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm ${
                        node.status === 'current'
                          ? 'font-bold text-ink'
                          : node.status === 'rejected'
                            ? 'font-bold text-rose-900'
                            : node.status === 'done'
                              ? 'font-semibold text-ink'
                              : 'font-normal text-ink-muted'
                      }`}
                    >
                      {node.title}
                    </span>

                    {node.status === 'current' && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                        Current
                      </span>
                    )}
                  </div>

                  {node.date && (
                    <time
                      dateTime={node.date}
                      className="text-xs text-ink-subtle font-normal tabular-nums"
                    >
                      {formatDateTime(node.date)}
                    </time>
                  )}
                </div>

                <p
                  className={`mt-0.5 text-xs sm:text-sm leading-relaxed ${
                    node.status === 'rejected'
                      ? 'text-rose-800'
                      : node.status === 'upcoming'
                        ? 'text-ink-subtle'
                        : 'text-ink-muted'
                  }`}
                >
                  {node.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default TimelineTracker;
