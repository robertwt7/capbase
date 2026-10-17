/**
 * Cross-source round de-duplication — the pure half, testable without Nest.
 *
 * Two sources describing the same raise (a Form D filing and a licensed
 * partner's deal record) date and size it differently: Form D's date is the
 * first sale, a deal record's is the announcement or close, and Form D reports
 * the amount sold so far. So "the same round" is a window, not an equality.
 */

/** Dates within this many days of each other can be the same raise. */
export const DEDUP_WINDOW_DAYS = 120;

/** Amounts within this fraction of the larger one can be the same raise. */
export const DEDUP_AMOUNT_TOLERANCE = 0.25;

const DAY_MS = 86_400_000;

export interface RoundLike {
  id?: string;
  date: Date;
  /** 0 means undisclosed, which matches any amount. */
  amountUsd: number;
  kind: string;
  externalSource?: string | null;
}

/**
 * A round of one kind class never matches the other: a grant is a different
 * capital event from an equity or debt raise on the same day, however alike
 * the amounts.
 */
function sameKindClass(a: string, b: string): boolean {
  return (a === 'Grant') === (b === 'Grant');
}

function amountsCompatible(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return true;
  return Math.abs(a - b) <= DEDUP_AMOUNT_TOLERANCE * Math.max(a, b);
}

/**
 * The existing round `candidate` most plausibly duplicates, or null.
 *
 * Within the window, the closest date wins, then the closest amount — so a
 * company with two raises 100 days apart pairs each with its own counterpart.
 */
export function findNearDuplicate<T extends RoundLike>(candidate: RoundLike, existing: T[]): T | null {
  let best: T | null = null;
  let bestDays = Infinity;
  let bestGap = Infinity;
  for (const r of existing) {
    if (!sameKindClass(candidate.kind, r.kind)) continue;
    const days = Math.abs(candidate.date.getTime() - r.date.getTime()) / DAY_MS;
    if (days > DEDUP_WINDOW_DAYS) continue;
    if (!amountsCompatible(candidate.amountUsd, r.amountUsd)) continue;
    const gap =
      candidate.amountUsd > 0 && r.amountUsd > 0 ? Math.abs(candidate.amountUsd - r.amountUsd) : 0;
    if (days < bestDays || (days === bestDays && gap < bestGap)) {
      best = r;
      bestDays = days;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Pair each incoming round with at most one existing round, and each existing
 * round with at most one incoming one.
 *
 * Greedy on closeness across ALL pairs (closest date, then closest amount),
 * not first-come: a source's Seed in January and Series A in March must not
 * both fold into one Form D round in February, and the one that does should be
 * the nearer. Re-running is stable — a corrected round moves to its partner's
 * date, which only makes that pair closer.
 *
 * Returns incoming index → the existing round it duplicates.
 */
export function pairNearDuplicates<T extends RoundLike>(incoming: RoundLike[], existing: T[]): Map<number, T> {
  const pairs: { i: number; e: number; days: number; gap: number }[] = [];
  incoming.forEach((c, i) => {
    existing.forEach((r, e) => {
      if (!sameKindClass(c.kind, r.kind)) return;
      const days = Math.abs(c.date.getTime() - r.date.getTime()) / DAY_MS;
      if (days > DEDUP_WINDOW_DAYS || !amountsCompatible(c.amountUsd, r.amountUsd)) return;
      const gap = c.amountUsd > 0 && r.amountUsd > 0 ? Math.abs(c.amountUsd - r.amountUsd) : 0;
      pairs.push({ i, e, days, gap });
    });
  });
  pairs.sort((a, b) => a.days - b.days || a.gap - b.gap || a.i - b.i || a.e - b.e);

  const out = new Map<number, T>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (out.has(p.i) || used.has(p.e)) continue;
    out.set(p.i, existing[p.e]!);
    used.add(p.e);
  }
  return out;
}
