/**
 * The amount actually raised, from a C-U progress update's free text.
 *
 * Form C's data set publishes the TARGET and MAXIMUM offering amounts as
 * columns, never the proceeds — those exist only as prose:
 *   "Vigilante Gaming Bar, LLC has raised a total of $119,700."
 *   "The Offering ended early on June 9, 2026 having raised a total of $10,522.32."
 * Measured over all 5,532 C-U filings in the 2016Q2–2026Q2 archives: ~4,900
 * yield an amount. The rest are honest misses — "Offering closed
 * unsuccessfully", "End of offering" — and correctly produce no round.
 *
 * Taking the largest dollar figure is wrong on real filings:
 *   "The issuer raised $5455.00, which fell below its minimum goal of $25,000.00."
 * so candidates are scored by the nearest preceding keyword and capped by the
 * maximum the offering registered.
 */

/** Reg CF raises are oversubscribed within a small tolerance, never doubled. */
const OVERSUBSCRIPTION_TOLERANCE = 1.05;

/** Statutory Reg CF ceilings. The cap rose from $1.07M to $5M on 2021-03-15
 *  (SEC Release 33-10884), which is the fallback when an offering filed no
 *  maximum of its own. */
const CEILING_RAISE_DATE = '2021-03-15';
const CEILING_BEFORE_USD = 1_070_000;
const CEILING_AFTER_USD = 5_000_000;

/** The statutory maximum a Reg CF offering filed on `filedAt` could raise. */
export function regCfCeilingUsd(filedAt?: string | null): number {
  return filedAt && filedAt < CEILING_RAISE_DATE ? CEILING_BEFORE_USD : CEILING_AFTER_USD;
}

/** How far back a keyword still qualifies a figure. Long enough to reach across
 *  "has raised a total of", short enough not to borrow the previous clause's. */
const CONTEXT_CHARS = 45;

/** Words that mean the figure is money that arrived. */
const RAISED_RE =
  /\b(raised|raising|proceeds|totall?(?:ing|ed|s)?|sold|received|closed|settled|invested|investments?)\b/gi;

/** Words that mean the figure is something else: a goal, or a cost deducted
 *  from the proceeds. A candidate anchored to one of these is never the raise. */
const NOT_RAISED_RE = /\b(target|minimum|goal|maximum|fee|fees|commission|commissions|net)\b/gi;

/** A unit price rather than a total: "sold at $100 each". */
const UNIT_PRICE_RE = /^[\s,)]*(per\s+[\w-]+|each\b|a\s+share\b|\/\s*(share|unit))/i;

const DOLLARS_RE = /\$\s?[\d,]+(?:\.\d{1,2})?/g;

interface Candidate {
  amount: number;
  score: number;
}

/**
 * @param text            the filing's PROGRESSUPDATE cell
 * @param maxOfferingUsd  the offering's registered maximum, when it filed one
 * @param filedAt         ISO filing date, which picks the statutory ceiling
 *                        used when no maximum was filed
 */
export function parseRaisedUsd(
  text: string,
  maxOfferingUsd: number | null,
  filedAt?: string | null,
): number | null {
  const src = (text ?? '').trim();
  if (!src) return null;

  // A raise cannot exceed the maximum the offering registered, and no Reg CF
  // raise can exceed the statutory ceiling — so a bigger figure in the prose is
  // something else (a valuation, a market size, a prior round).
  const cap = (maxOfferingUsd && maxOfferingUsd > 0 ? maxOfferingUsd : regCfCeilingUsd(filedAt)) *
    OVERSUBSCRIPTION_TOLERANCE;

  const candidates: Candidate[] = [];
  for (const match of src.matchAll(DOLLARS_RE)) {
    const raw = match[0]!;
    const at = match.index ?? 0;

    const amount = Number(raw.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (UNIT_PRICE_RE.test(src.slice(at + raw.length, at + raw.length + 24))) continue;
    if (amount > cap) continue;

    const score = scoreContext(src.slice(Math.max(0, at - CONTEXT_CHARS), at));
    // Score 0 means the nearest keyword says this figure is a goal or a cost.
    // Printing one of those as proceeds is exactly the failure to avoid.
    if (score === 0) continue;
    candidates.push({ amount, score });
  }

  if (candidates.length === 0) return null;
  // Highest score wins; ties break to the larger amount (a filing that restates
  // its raise mid-sentence quotes the running total last and largest).
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0]!.amount;
}

/** 2 when the last keyword before the figure says "money that arrived", 0 when
 *  it says "goal or cost", 1 when the figure stands unqualified. */
function scoreContext(before: string): number {
  const raised = lastIndexOfMatch(before, RAISED_RE);
  const other = lastIndexOfMatch(before, NOT_RAISED_RE);
  if (raised < 0 && other < 0) return 1;
  return raised > other ? 2 : 0;
}

function lastIndexOfMatch(text: string, re: RegExp): number {
  let last = -1;
  for (const m of text.matchAll(re)) last = m.index ?? last;
  return last;
}
