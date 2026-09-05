/**
 * The pure half of merge-candidate detection: the name key, and grouping rows
 * into pairs.
 *
 * Separate from the `detect-merges` CLI so it can be tested without booting a
 * Nest context — importing the CLI runs it.
 */

import { normalizeInvestorName } from './ingest.service';

/**
 * The detector's name key — deliberately LOOSER than the company matcher's.
 *
 * A sweep keyed on `normalizeName`, the function `upsertCompany` matches on, is
 * dead code: any pair it could find, ingest would already have merged at write
 * time. Measured on the live corpus, it finds 0 groups. The value is entirely
 * in the gap between the two: `normalizeName` DELETES punctuation, so
 * "HeavyTech,Inc." becomes "heavytechinc" and never meets "HeavyTech, Inc." →
 * "heavytech". This key replaces punctuation with a space instead, and the same
 * corpus yields 5 groups over 10 rows — including that pair.
 *
 * It is `normalizeInvestorName` because that function already does exactly
 * this, is already tested, and its extra legal suffixes (lp, gmbh, bv, …) are
 * legal suffixes on a company too. For investors it IS the matcher's key, so
 * that sweep finds nothing today; it stays as a cheap safety net for rows
 * renamed after creation, which the matcher cannot catch.
 */
export const detectorNameKey = normalizeInvestorName;

/** A normalized name shared by more than this many rows is a generic string,
 *  not that many duplicates — "holdings", "capital partners", a name that is
 *  blank once its legal suffix is stripped. Emitting every pair from a group of
 *  n costs n(n-1)/2 candidates, so a single group of 20 would put 190 rows in
 *  front of a moderator. Flooding the queue is how a moderation queue dies. */
export const GROUP_LIMIT = 8;

/** One row as the detector sees it. */
export interface DetectRow {
  id: string;
  name: string;
  domain: string | null;
}

/** A pair the detector wants reviewed. */
export interface DetectedPair {
  aId: string;
  bId: string;
  /** The shared key, shown to the reviewer so they can check the proposal
   *  rather than guess why it was made. */
  evidence: string;
}

/** One sweep's output, including what it declined to propose. */
export interface SweepResult {
  pairs: DetectedPair[];
  /** Groups too large to be credible duplicates, with their key and size. */
  skipped: { key: string; size: number }[];
}

/**
 * Group rows by `key` and emit every pair inside each surviving group.
 *
 * The caller supplies the key function because the identity of a "duplicate"
 * differs per sweep: `domain` for one, `normalizeName` for the other. An empty
 * key is skipped — a blank domain means "not recorded", not a domain two rows
 * have in common.
 */
export function sweep(
  rows: DetectRow[],
  key: (row: DetectRow) => string,
  groupLimit: number = GROUP_LIMIT,
): SweepResult {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(row.id);
    else groups.set(k, [row.id]);
  }

  const pairs: DetectedPair[] = [];
  const skipped: { key: string; size: number }[] = [];

  for (const [k, ids] of groups) {
    if (ids.length < 2) continue;
    if (ids.length > groupLimit) {
      skipped.push({ key: k, size: ids.length });
      continue;
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push({ aId: ids[i]!, bId: ids[j]!, evidence: k });
      }
    }
  }

  return { pairs, skipped };
}
