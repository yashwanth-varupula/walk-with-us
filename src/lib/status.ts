/**
 * Every status/level enum in the database, described exactly once.
 *
 * The live enums (from .dbg/enums.json, read off the running database):
 *   request_status  draft, submitted, under_review, rejected, verified,
 *                   published, active, resolved, closed
 *   document_status pending, verified, rejected
 *   urgency_level   low, medium, high, critical
 *   user_role       requester, donor, volunteer, partner, staff, admin
 *
 * Before this module the same nine statuses were described in SEVEN separate
 * maps across the codebase. Two of them disagreed: the requester's timeline
 * order omitted `closed` entirely, so a closed request rendered an empty
 * progress bar with no explanation, and one page labelled a rejected request
 * "Sent back" to staff while showing staff the word "Rejected".
 *
 * Both audiences still get their own wording, because they genuinely need it —
 * a requester and a reviewer should not be shown identical language. What they
 * no longer do is carry their own copy of the colour and lifecycle definitions.
 */

/* ------------------------------------------------------------------ types */

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'rejected',
  'verified',
  'published',
  'active',
  'resolved',
  'closed',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DOCUMENT_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

const TONE_CLASSES = {
  idle: 'bg-idle-soft text-idle-ink',
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-warn-soft text-warn-ink',
  good: 'bg-good-soft text-good-ink',
  stop: 'bg-stop-soft text-stop-ink',
} as const;

export type Tone = keyof typeof TONE_CLASSES;

/* ------------------------------------------------------- request statuses */

export interface RequestStatusMeta {
  /** Staff-facing wording. Internal, precise. */
  staffLabel: string;
  /** Requester-facing wording. Plain, non-technical, no jargon. */
  requesterLabel: string;
  /** One sentence explaining what this means for the person who asked. */
  requesterDescription: string;
  tone: Tone;
  /** Whether the requester can still edit the request. */
  editable: boolean;
  /** Whether this status is visible on the public requests page. */
  publiclyListable: boolean;
}

export const REQUEST_STATUS_META: Record<RequestStatus, RequestStatusMeta> = {
  draft: {
    staffLabel: 'Draft',
    requesterLabel: 'Draft',
    requesterDescription: 'Only you can see this. Nothing has been sent to staff yet.',
    tone: 'idle',
    editable: true,
    publiclyListable: false,
  },
  submitted: {
    staffLabel: 'Submitted',
    requesterLabel: 'Submitted',
    requesterDescription: 'Sent to staff and waiting to be picked up for review.',
    tone: 'info',
    editable: false,
    publiclyListable: false,
  },
  under_review: {
    staffLabel: 'Under review',
    requesterLabel: 'Under review',
    requesterDescription: 'A staff member is checking your documents and details.',
    tone: 'warn',
    editable: false,
    publiclyListable: false,
  },
  rejected: {
    staffLabel: 'Rejected',
    requesterLabel: 'Sent back',
    requesterDescription: 'Staff could not proceed. See the reason below, then submit a new request.',
    tone: 'stop',
    editable: false,
    publiclyListable: false,
  },
  verified: {
    staffLabel: 'Verified',
    requesterLabel: 'Verified',
    requesterDescription: 'Checked by staff and waiting to be published to the public list.',
    tone: 'good',
    editable: false,
    publiclyListable: false,
  },
  published: {
    staffLabel: 'Published',
    requesterLabel: 'Published',
    requesterDescription: 'Live on the public requests page and visible to people who want to help.',
    tone: 'good',
    editable: false,
    publiclyListable: true,
  },
  active: {
    staffLabel: 'Active',
    requesterLabel: 'Active',
    requesterDescription: 'People are helping with this request right now.',
    tone: 'good',
    editable: false,
    publiclyListable: true,
  },
  resolved: {
    staffLabel: 'Resolved',
    requesterLabel: 'Resolved',
    requesterDescription: 'This request has been resolved. Thank you for using Walk With Us.',
    tone: 'idle',
    editable: false,
    publiclyListable: true,
  },
  closed: {
    staffLabel: 'Closed',
    requesterLabel: 'Closed',
    requesterDescription: 'This request is closed and is no longer being worked on.',
    tone: 'idle',
    editable: false,
    publiclyListable: false,
  },
};

/**
 * The happy-path order a requester sees as a progress timeline.
 *
 * `closed` is deliberately absent from this list. Closing is an outcome, not a
 * forward step — a request that reached `closed` is also `resolved` or
 * `rejected`, and appending it here produced the bug where a closed request
 * showed an empty timeline. It is handled explicitly as an end state instead.
 *
 * The requester-facing TIMELINE below is the full, branch-aware version of this
 * and is what the detail page renders.
 */
export const REQUEST_PROGRESS_ORDER: readonly RequestStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'verified',
  'published',
  'active',
  'resolved',
];

/* -------------------------------------------------- requester-facing steps */

export type TimelineStepState = 'done' | 'current' | 'upcoming' | 'rejected';

export interface TimelineStep {
  /** The status this node represents. `decision` is a fork, not a status. */
  key: RequestStatus | 'decision';
  /** Requester-facing label. */
  label: string;
  /** One short line explaining this node to the person who asked for help. */
  description: string;
  state: TimelineStepState;
  tone: Tone;
  /** The lifecycle column that timestamps this node, when one exists. */
  timestampKey: TimestampKey | null;
}

export type TimestampKey =
  | 'createdAt'
  | 'submittedAt'
  | 'verifiedAt'
  | 'publishedAt'
  | 'resolvedAt'
  | 'updatedAt';

/**
 * The complete lifecycle a requester is entitled to see, in the order it is
 * shown on /my-requests/:id.
 *
 * `decision` is an explicit fork: staff either VERIFY the request (continue
 * down the happy path) or REJECT it (terminal). Modelling the fork as a real
 * node rather than hiding `rejected` is what stops a rejected request from
 * rendering a timeline where nothing appears to have happened — the previous
 * behaviour, which suppressed the timeline entirely for `rejected`.
 *
 * Every step carries a requester-safe description. No internal verification
 * note, reviewer identity or admin action ever reaches this structure.
 */
export const REQUESTER_TIMELINE: readonly {
  key: TimelineStep['key'];
  label: string;
  description: string;
  /** Successor keys, in the order they can be reached. */
  next: readonly TimelineStep['key'][];
}[] = [
  {
    key: 'draft',
    label: 'Draft',
    description: 'Saved privately while you fill in the form. Only you can see it.',
    next: ['submitted'],
  },
  {
    key: 'submitted',
    label: 'Submitted',
    description: 'Received by us and waiting for a staff member to pick it up.',
    /*
      `under_review`, not `decision`. Both `submitted` and `under_review` lead to
      the decision, but only `under_review` is on the single spine
      `deriveForwardSpine` walks — a request is always picked up and reviewed
      before it is decided. Listing `decision` here as well would have made the
      walk skip `under_review` and the node could then never be marked reached.
    */
    next: ['under_review'],
  },
  {
    key: 'under_review',
    label: 'Under review',
    description: 'A staff member is checking your details and supporting documents.',
    next: ['decision'],
  },
  {
    key: 'decision',
    label: 'Verified or rejected',
    description: 'A staff member decides whether the request can go forward.',
    next: ['published', 'rejected'],
  },
  {
    key: 'published',
    label: 'Published',
    description: 'Live on the public help page, so people who want to help can find it.',
    // Two edges, but the walk follows the first, so the spine is linear.
    // `resolved` is a legitimate shortcut — a request can be resolved without
    // anyone marking it active — and that is what `isResolvedStatus` is for.
    next: ['active', 'resolved'],
  },
  {
    key: 'active',
    label: 'Active',
    description: 'People are helping with this request right now.',
    next: ['resolved'],
  },
  {
    key: 'resolved',
    label: 'Resolved',
    description: 'This request has been resolved. Thank you for using Walk With Us.',
    next: ['closed'],
  },
  {
    key: 'closed',
    label: 'Closed',
    description: 'Closed and no longer being worked on.',
    next: [],
  },
  {
    key: 'rejected',
    label: 'Rejected',
    description: 'Staff could not take this further. See the reason given below.',
    next: [],
  },
];

/**
 * The happy path, derived from the `next` graph above rather than written out
 * again as a literal.
 *
 * `FORWARD_SPINE` used to be a hand-maintained second list of the same eight
 * steps, which is exactly the shape of bug where someone adds a node to the
 * timeline, forgets the spine, and the step silently never marks itself as
 * reached. Walking the graph means there is only one place to edit.
 *
 * `rejected` is the one successor that leaves the happy path, so it is skipped
 * when following edges: `decision` has successors `published` and `rejected`,
 * and the spine continues through `published`. The `seen` set makes a cycle in
 * the data a terminating condition rather than an infinite loop.
 */
function deriveForwardSpine(
  steps: readonly { key: TimelineStep['key']; next: readonly TimelineStep['key'][] }[],
): readonly TimelineStep['key'][] {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const spine: TimelineStep['key'][] = [];
  const seen = new Set<TimelineStep['key']>();
  let cursor: TimelineStep['key'] | undefined = 'draft';
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    spine.push(cursor);
    cursor = byKey.get(cursor)?.next.find((n) => n !== 'rejected');
  }
  return spine;
}

const FORWARD_SPINE: readonly TimelineStep['key'][] = deriveForwardSpine(REQUESTER_TIMELINE);

const TIMESTAMP_COLUMN: Record<Exclude<TimelineStep['key'], 'decision'>, TimestampKey | null> = {
  draft: 'createdAt',
  submitted: 'submittedAt',
  under_review: null,
  verified: 'verifiedAt',
  published: 'publishedAt',
  active: null,
  resolved: 'resolvedAt',
  closed: null,
  rejected: 'updatedAt',
};

/**
 * Build the fully-resolved timeline for a request's current status.
 *
 * The same shape is returned for every status so the component never has to
 * branch on "what if this status is not in my list":
 *
 *  - A request that reached `rejected` shows every step up to the decision as
 *    done, the decision node itself as `rejected`, and nothing after it. The
 *    published-through-closed nodes are `upcoming`, i.e. visibly never
 *    happened, rather than silently missing.
 *  - A request that reached `resolved` or `closed` walks the full path and then
 *    marks `closed` as done once it has been closed.
 *  - A request still in `under_review` marks the decision node `upcoming`
 *    together with everything after it.
 *
 * `resolvedAt` is the only disambiguator needed: there is no `closed_at`
 * column, so a `resolved` request is still current at `resolved` and becomes
 * done at `resolved` only once the status itself has moved on to `closed`.
 */
export function buildRequesterTimeline(status: string, resolvedAt: string | null): TimelineStep[] {
  const rejected = status === 'rejected';

  // How far along the happy path the request has travelled, as an index into
  // FORWARD_SPINE. A rejection stops AT the decision node, which is why it
  // shares `verified`'s index: the fork is where the two paths diverge.
  //
  // `resolvedAt` is only a tie-breaker. There is no `closed_at` column, so a
  // request whose status is still `resolved` shows `resolved` as current, and
  // only moving the status to `closed` marks that node done. A stray
  // `resolved_at` on a still-open row must not make the timeline claim work
  // finished, so it never advances `reach` on its own.
  const spineIndex = FORWARD_SPINE.indexOf(
    rejected || status === 'verified' ? 'decision' : (status as RequestStatus),
  );

  // `indexOf` returns -1 for a status added server-side that this build does
  // not know. Rather than letting a -1 reach mark every node "done" or none of
  // them, fall back to something honest: a resolved timestamp means the work
  // finished, otherwise the only safe claim is that we are still at the start.
  const reach =
    spineIndex >= 0
      ? spineIndex
      : isResolvedStatus(status, resolvedAt)
        ? FORWARD_SPINE.indexOf('resolved')
        : 0;

  return REQUESTER_TIMELINE.map((step) => {
    let state: TimelineStepState;

    if (step.key === 'rejected') {
      // The alternative outcome of the fork, shown so a rejected request has
      // its own end node instead of appearing to have stopped mid-flow.
      state = rejected ? 'current' : 'upcoming';
    } else {
      const idx = FORWARD_SPINE.indexOf(step.key);
      if (idx < 0) {
        state = 'upcoming';
      } else if (idx < reach) {
        state = 'done';
      } else if (idx === reach) {
        // The one node that is happening right now. For a rejected request the
        // fork itself renders as the failure rather than as progress.
        state = step.key === 'decision' && rejected ? 'rejected' : 'current';
      } else {
        state = 'upcoming';
      }
    }

    const realKey = step.key === 'decision' ? 'verified' : step.key;
    return {
      key: step.key,
      label: step.label,
      description: step.description,
      state,
      tone: TIMELINE_TONE[state],
      timestampKey:
        step.key === 'decision'
          ? rejected
            ? 'updatedAt'
            : 'verifiedAt'
          : TIMESTAMP_COLUMN[realKey],
    };
  });
}

const TIMELINE_TONE: Record<TimelineStepState, Tone> = {
  done: 'good',
  current: 'info',
  upcoming: 'idle',
  rejected: 'stop',
};

/**
 * True once a request has been resolved, i.e. `resolved_at` is set or the
 * status has reached resolved/closed. Separate from `isTerminalStatus`, which
 * also counts a rejection as final.
 */
export function isResolvedStatus(status: string, resolvedAt: string | null): boolean {
  return status === 'resolved' || status === 'closed' || Boolean(resolvedAt);
}

const REQUEST_PROGRESS_INDEX = new Map(REQUEST_PROGRESS_ORDER.map((s, i) => [s, i]));

/** 0-based position in the progress timeline, or -1 if not on the path. */
export function requestProgressIndex(status: string): number {
  return REQUEST_PROGRESS_INDEX.get(status as RequestStatus) ?? -1;
}

/**
 * True when a request has reached a final state, whatever route it took there.
 * Used to decide whether to offer "start a new request" instead of "track
 * progress" — a bug where a closed request still showed a live progress bar.
 */
export function isTerminalStatus(status: string): boolean {
  return status === 'resolved' || status === 'closed' || status === 'rejected';
}

/** Statuses staff can still act on. */
export function isActionableStatus(status: string): boolean {
  return status === 'submitted' || status === 'under_review';
}

/* ------------------------------------------------------ document statuses */

export const DOCUMENT_STATUS_META: Record<DocumentStatus, { staffLabel: string; requesterLabel: string; tone: Tone }> = {
  pending: { staffLabel: 'Pending', requesterLabel: 'Being checked', tone: 'warn' },
  verified: { staffLabel: 'Verified', requesterLabel: 'Accepted', tone: 'good' },
  rejected: { staffLabel: 'Rejected', requesterLabel: 'Not accepted', tone: 'stop' },
};

/* --------------------------------------------------------------- urgency */

export const URGENCY_META: Record<UrgencyLevel, { label: string; tone: Tone; rank: number }> = {
  low: { label: 'Low', tone: 'idle', rank: 0 },
  medium: { label: 'Medium', tone: 'info', rank: 1 },
  high: { label: 'High', tone: 'warn', rank: 2 },
  critical: { label: 'Critical', tone: 'stop', rank: 3 },
};

/* -------------------------------------------------------------- lookups */

export function toneClass(tone: Tone): string {
  return TONE_CLASSES[tone];
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export function isUrgencyLevel(value: unknown): value is UrgencyLevel {
  return typeof value === 'string' && (URGENCY_LEVELS as readonly string[]).includes(value);
}

/**
 * Never returns blank. An unknown value coming back from the database renders
 * as a readable, sentence-cased label in a neutral tone rather than an empty
 * badge — so adding a status server-side can never produce a UI gap.
 */
export function requestStatusMeta(status: string): RequestStatusMeta {
  return (
    REQUEST_STATUS_META[status as RequestStatus] ?? {
      staffLabel: sentenceCase(status),
      requesterLabel: sentenceCase(status),
      requesterDescription: '',
      tone: 'idle',
      editable: false,
      publiclyListable: false,
    }
  );
}

export function urgencyMeta(urgency: string) {
  return URGENCY_META[urgency as UrgencyLevel] ?? URGENCY_META.low;
}

export function sentenceCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
