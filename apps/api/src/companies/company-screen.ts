/**
 * The company directory's screening criteria as Prisma `where` fragments —
 * pure, so the predicate shapes are unit-tested without a database.
 *
 *   - Scale ranges match a RECORDED value only: 0 (and a null valuation) is the
 *     "unknown" sentinel, so `gt: 0` is unconditional — `raisedMin=0` still
 *     excludes an unknown total.
 *   - Every financing criterion lands in ONE `rounds: { some }` (SQL EXISTS):
 *     amount and date must hold for the same round, and a company with several
 *     matching rounds is still one row (no join fan-out, so `count` and pages
 *     agree).
 *   - The investor is matched by firm id (slug → survivor), never by name.
 *
 * Every relation filter carries the section's provenance filter
 * (`dir.rows(section)`), so a viewer below a section's partner audience never
 * matches on — and so never learns of — the partner's rows. Each `rows` value
 * brings its own `OR`, so these fragments go in the company `AND`, never beside
 * the `q` filter's top-level `OR`.
 */
import { hasRoundCriteria, type CompanyScreenQuery, type InvestorScope } from '@repo/api';
import type { Prisma } from '@repo/db';

import type { DirectoryGate } from '../gate/gate';

export interface ScreenInputs {
  query: CompanyScreenQuery;
  /** From `directoryFilters` (`use` / `rows` / `partnerColumns`). */
  dir: Pick<DirectoryGate, 'use' | 'rows' | 'partnerColumns'>;
  /** `resolveRoundWindow`'s half-open UTC bounds, or null. */
  window: { from?: Date; toExclusive?: Date } | null;
  /** Null: no investor filter applies. []: sent but unresolved (matches nothing). */
  investorIds: string[] | null;
  /** What the investor filter matches on (decided by the service from the gate). */
  investorScope: InvestorScope | null;
  /** For the `holdingsAndRounds` scope: the companies the firm is linked to,
   *  pre-resolved by `investorLinkReads` (an OR of two EXISTS would scan every
   *  company). Null: not resolved (too many links) — the EXISTS form is used. */
  investorCompanyIds?: string[] | null;
}

/** Above this many linked rows per branch the id set is not built; the EXISTS
 *  form answers instead (slower, but never an unbounded parameter list). */
export const INVESTOR_LINK_CAP = 10_000;

/**
 * The two reads that resolve a firm's linked companies for the
 * `holdingsAndRounds` scope: its approved holdings, and the approved rounds it
 * is named on — each with its section's provenance filter, the same predicates
 * the EXISTS form uses. Each is capped at `INVESTOR_LINK_CAP + 1` rows so the
 * caller can tell when to fall back.
 */
export function investorLinkReads(
  dir: Pick<DirectoryGate, 'rows'>,
  investorIds: string[],
): { holdings: Prisma.InvestorHoldingFindManyArgs; rounds: Prisma.FundingRoundFindManyArgs } {
  const rounds = dir.rows('companyRounds');
  return {
    holdings: {
      where: { investorId: { in: investorIds }, moderationStatus: 'APPROVED', ...dir.rows('companyInvestors') },
      select: { companyId: true },
      take: INVESTOR_LINK_CAP + 1,
    },
    rounds: {
      where: {
        moderationStatus: 'APPROVED',
        ...rounds,
        investors: { some: { investorId: { in: investorIds }, ...rounds } },
      },
      select: { companyId: true },
      take: INVESTOR_LINK_CAP + 1,
    },
  };
}

type Bounds<T> = { gt: T; gte?: T; lte?: T };

const bounds = <T>(zero: T, lo: T | undefined, hi: T | undefined): Bounds<T> => ({
  gt: zero,
  ...(lo !== undefined && { gte: lo }),
  ...(hi !== undefined && { lte: hi }),
});

const big = (n: number | undefined): bigint | undefined => (n === undefined ? undefined : BigInt(n));

const set = (...vs: (number | undefined)[]) => vs.some((v) => v !== undefined);

/** Whether the investor filter applies at all. */
const investorApplies = (i: ScreenInputs): i is ScreenInputs & { investorIds: string[]; investorScope: InvestorScope } =>
  i.investorIds !== null && i.investorScope !== null && i.dir.use('investor');

/**
 * The round predicate on its own, or null when no round condition applies.
 * Used inside the company EXISTS and by the matched-round read, so the row the
 * directory shows as context always satisfies exactly what the filter did.
 * With `investorOn=round` it is built even with no other round criterion:
 * "named on any approved round".
 */
export function roundCriteriaWhere(i: ScreenInputs): Prisma.FundingRoundWhereInput | null {
  const q = i.query;
  const criteria = i.dir.use('round') && hasRoundCriteria(q);
  const onRound = investorApplies(i) && i.investorScope === 'round';
  if (!criteria && !onRound) return null;

  const rounds = i.dir.rows('companyRounds');
  const where: Prisma.FundingRoundWhereInput = { moderationStatus: 'APPROVED', ...rounds };
  const partnerNot: Prisma.FundingRoundWhereInput[] = [];
  const partner = new Set(i.dir.partnerColumns('companyRounds'));
  const guard = (column: string) => {
    if (partner.has(column)) partnerNot.push({ NOT: { partnerFields: { has: column } } });
  };

  if (criteria) {
    if (q.roundKind) {
      where.kind = q.roundKind;
      guard('kind');
    }
    if (i.window && (i.window.from || i.window.toExclusive)) {
      where.date = {
        ...(i.window.from && { gte: i.window.from }),
        ...(i.window.toExclusive && { lt: i.window.toExclusive }),
      };
      guard('date');
    }
    if (set(q.roundMin, q.roundMax)) {
      // 0 is an undisclosed amount: it never matches a size.
      where.amountUsd = bounds(BigInt(0), big(q.roundMin), big(q.roundMax));
      guard('amountUsd');
    }
  }
  if (onRound) {
    where.investors = { some: { investorId: { in: i.investorIds! }, ...rounds } };
  }
  if (partnerNot.length) where.AND = partnerNot;
  return where;
}

/** AND entries to append to the company `where` (empty when nothing applies). */
export function companyScreenWhere(i: ScreenInputs): Prisma.CompanyWhereInput[] {
  const q = i.query;
  const and: Prisma.CompanyWhereInput[] = [];

  if (i.dir.use('raised') && set(q.raisedMin, q.raisedMax)) {
    and.push({ totalRaisedUsd: bounds(BigInt(0), big(q.raisedMin), big(q.raisedMax)) });
  }
  if (i.dir.use('valuation') && set(q.valuationMin, q.valuationMax)) {
    and.push({ lastValuationUsd: { not: null, ...bounds(BigInt(0), big(q.valuationMin), big(q.valuationMax)) } });
  }
  if (i.dir.use('founded') && set(q.foundedMin, q.foundedMax)) {
    and.push({ founded: bounds(0, q.foundedMin, q.foundedMax) });
  }
  if (i.dir.use('headcount') && set(q.headcountMin, q.headcountMax)) {
    and.push({ headcount: bounds(0, q.headcountMin, q.headcountMax) });
  }

  const round = roundCriteriaWhere(i);
  if (round) and.push({ rounds: { some: round } });

  if (investorApplies(i)) {
    const ids = i.investorIds;
    if (ids.length === 0) {
      and.push({ id: { in: [] } });
    } else if (i.investorScope !== 'round') {
      const holdings: Prisma.CompanyWhereInput = {
        investors: {
          some: { investorId: { in: ids }, moderationStatus: 'APPROVED', ...i.dir.rows('companyInvestors') },
        },
      };
      if (i.investorScope === 'holdings') {
        and.push(holdings);
      } else if (i.investorCompanyIds) {
        and.push({ id: { in: i.investorCompanyIds } });
      } else {
        const rounds = i.dir.rows('companyRounds');
        and.push({
          OR: [
            holdings,
            {
              rounds: {
                some: {
                  moderationStatus: 'APPROVED',
                  ...rounds,
                  investors: { some: { investorId: { in: ids }, ...rounds } },
                },
              },
            },
          ],
        });
      }
    }
    // `round` scope: already inside the round predicate above.
  }
  return and;
}
