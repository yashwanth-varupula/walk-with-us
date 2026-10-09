import { useEffect, useState } from 'react';
import { getCategories } from '../../services/helpRequests';

/**
 * Resolves a category id to its display name, for every staff screen.
 *
 * WHY A HOOK AND NOT A PROP
 * -------------------------
 * The three staff pages (dashboard, queue, review) all need a category label,
 * and `help_requests.category_id` is a uuid. The review page had solved this
 * with two pieces of state — the whole category list plus the one resolved
 * name — and an effect that had to re-run whenever either changed. That is two
 * sources of truth for one value, and it is a stale-label bug waiting to happen
 * when the request changes under a slow lookup.
 *
 * A `Map` lookup is used instead of a second state variable, so a label is
 * derived at render time and can never lag behind the row it belongs to.
 *
 * WHY A FAILURE IS NOT FATAL
 * --------------------------
 * A category name is a display label, not authorisation and not a data field the
 * reviewer needs to make a decision. If `categories` cannot be read, every
 * screen still works and the label falls back to a neutral placeholder. That is
 * deliberately the same treatment the review page already gave it — a missing
 * label must never blank the review screen or block a decision.
 */
export function useCategoryNames(): { categoryName: (id: string | null) => string; loaded: boolean } {
  const [byId, setById] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let active = true;
    getCategories().then(({ data, error }) => {
      if (!active) return;
      setById(
        error
          ? new Map()
          : new Map(data.map((c) => [c.id, c.name] as const)),
      );
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    // `null` while the lookup is in flight, and for a category that has since
    // been deactivated or deleted: both render as the same honest placeholder
    // rather than an empty cell.
    categoryName: (id) => (id && byId ? (byId.get(id) ?? '') : ''),
    loaded: byId !== null,
  };
}
