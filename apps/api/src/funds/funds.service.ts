import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  FUND_COMMITMENT_PREVIEW,
  PREVIEW_LIMIT,
  SITEMAP_PAGE_SIZE,
  fundIndexable,
  gateLimit,
  partnerVisible,
  type FundDetailResponse,
  type FundListQuery,
  type FundSlugEntry,
  type FundSummary,
  type FundTerms,
  type Paginated,
  type Role,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import {
  FUND_BLANKS,
  limitRows,
  listAccess,
  maskFields,
  maskPartnerFields,
  publicRowsWhere,
  rowVisible,
  stubFor,
  takeFor,
  unmaskedFilters,
} from '../gate/gate';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_INVESTOR } from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { UsersService } from '../users/users.service';
import {
  toFundCommitmentRow,
  toFundMetricRow,
  toFundSummary,
  toFundTerms,
  type CommitmentWithInvestor,
  type FundWithManager,
} from './fund.mapper';

const MANAGER_SELECT = { select: { slug: true, name: true, domain: true } };

/** Funds are ingest-only and auto-APPROVED; the filter matches every sibling. */
const PUBLIC_FUND = { moderationStatus: 'APPROVED' } satisfies Prisma.FundWhereInput;

/** A commitment is public when it is approved and its LP is a live, public
 *  firm — a merged-away LP's row would otherwise link to a tombstone. */
export const PUBLIC_FUND_COMMITMENTS = {
  moderationStatus: 'APPROVED',
  investor: PUBLIC_INVESTOR,
} satisfies Prisma.FundCommitmentWhereInput;

/** `fundIndexable` (`@repo/api`) restated as a query — the sitemap's filter. */
const INDEXABLE_FUND = {
  ...PUBLIC_FUND,
  slug: { not: null },
  // A partner-only fund is a stub for crawlers (who are signed out): noindex.
  partnerOnly: false,
  OR: [
    { commitments: { some: PUBLIC_FUND_COMMITMENTS } },
    { closedUsd: { not: null } },
    { targetUsd: { not: null } },
    { finalCloseDate: { not: null } },
    { managementFeePct: { not: null } },
  ],
} satisfies Prisma.FundWhereInput;

/**
 * Read side for private funds.
 *
 * Funds are ingest-only and auto-APPROVED, but the read still filters on
 * `moderationStatus` so it matches every sibling table and a later ticket can
 * open contributions without touching this file.
 */
/** The terms only a contributor sees (`GATED_SECTIONS.fundTerms`). Region
 *  focus is a description, not a term, and stays with the facts. */
const GATED_TERMS = [
  'launchDate',
  'latestCloseDate',
  'finalCloseDate',
  'hardCapUsd',
  'managementFeePct',
  'carriedInterestPct',
  'hurdleRatePct',
  'targetIrrNetMinPct',
  'targetIrrNetMaxPct',
  'targetIrrGrossMinPct',
  'targetIrrGrossMaxPct',
] as const satisfies readonly (keyof FundTerms)[];

/** Every fund fact a partner-only stub withholds: all but its name, slug and
 *  manager. */
const FUND_STUB_HIDDEN = [
  'strategy',
  'status',
  'vintageYear',
  'targetUsd',
  'closedUsd',
  'grossAssetsUsd',
  'hq',
  'regionFocus',
  ...GATED_TERMS,
];

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /**
   * One page of funds. A signed-out viewer never sees a partner-only fund, a
   * partner-written value (masked) or a filter match on one; the status filter
   * — a partner-only column — is ignored for them outright.
   */
  async findAll(query: FundListQuery = {}, viewer?: { id: string; role: Role }): Promise<Paginated<FundSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const access = listAccess(viewer);
    const status = partnerVisible(access) ? query.status : undefined;

    const where: Prisma.FundWhereInput = {
      ...PUBLIC_FUND,
      ...(partnerVisible(access) ? {} : { partnerOnly: false }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.strategy && { strategy: query.strategy }),
      ...(status && { status }),
      ...(query.manager && { manager: { slug: query.manager } }),
      AND: unmaskedFilters(access, [query.strategy && 'strategy']),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fund.count({ where }),
      this.prisma.fund.findMany({
        where,
        orderBy: fundOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { manager: MANAGER_SELECT },
      }),
    ]);

    return {
      items: rows.map((r) => maskPartnerFields(toFundSummary(r as FundWithManager), r.partnerFields, access, FUND_BLANKS)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * The fund page: facts, terms, the largest commitments, metrics, and the
   * citations SEC funds carry. 404 for an unknown or unpublished fund.
   *
   * Gated: commitments and metrics are previewed (`gateLimit`, no partner rows
   * signed out) against counts over all of them; the terms are a contributor's
   * (`termsHidden`); partner-written facts are masked signed out; a
   * partner-only fund is a stub for a signed-out viewer.
   */
  async findOne(slug: string, viewer?: { id: string; role: Role }): Promise<FundDetailResponse> {
    const access = await this.users.accessFor(viewer);
    const row = await this.prisma.fund.findFirst({
      where: { slug, ...PUBLIC_FUND },
      include: {
        manager: MANAGER_SELECT,
        commitments: {
          where: { ...PUBLIC_FUND_COMMITMENTS, ...publicRowsWhere(access) },
          orderBy: [{ amountUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: takeFor(Math.min(FUND_COMMITMENT_PREVIEW, gateLimit('fundCommitments', access))),
          include: { investor: { select: { slug: true, name: true, type: true } } },
        },
        // A handful per fund: loaded whole, so the count covers every one.
        metrics: { orderBy: { asAt: 'asc' } },
        _count: { select: { commitments: { where: PUBLIC_FUND_COMMITMENTS } } },
      },
    });
    if (!row) throw new NotFoundException(`Fund "${slug}" not found`);

    const summary = toFundSummary(row as FundWithManager);
    const terms = toFundTerms(row);
    const commitmentCount = row._count.commitments;
    const gate = { ...access, previewLimit: PREVIEW_LIMIT };
    const base = {
      commitmentCount,
      metricCount: row.metrics.length,
      // Read off the stored row, before anything is withheld: indexing is a
      // property of the fund, not of the viewer.
      indexable:
        !row.partnerOnly &&
        fundIndexable({
          commitmentCount,
          closedUsd: summary.closedUsd,
          targetUsd: summary.targetUsd,
          finalCloseDate: terms.finalCloseDate,
          managementFeePct: terms.managementFeePct,
        }),
      access: gate,
    };

    if (stubFor(row.partnerOnly, access)) {
      const fund = maskFields({ ...summary, ...terms }, FUND_STUB_HIDDEN, FUND_BLANKS);
      return {
        ...base,
        fund: { ...fund, manager: { ...fund.manager, domain: null }, partnerOnly: true },
        commitments: [],
        metrics: [],
        termsHidden: false,
        citations: [],
      };
    }

    const termsHidden =
      gateLimit('fundTerms', access) === 0 && GATED_TERMS.some((t) => terms[t] !== null && terms[t] !== undefined);
    let fund = maskPartnerFields({ ...summary, ...terms }, row.partnerFields, access, FUND_BLANKS);
    if (gateLimit('fundTerms', access) === 0) {
      fund = { ...fund };
      for (const t of GATED_TERMS) fund[t] = null;
    }

    const citations = await this.prisma.citation.findMany({
      where: { entityType: 'fund', entityId: row.id },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...base,
      fund,
      commitments: row.commitments.map((c) => toFundCommitmentRow(c as CommitmentWithInvestor)),
      metrics: limitRows(
        row.metrics.filter((m) => rowVisible(m, access)),
        gateLimit('fundMetrics', access),
      ).map(toFundMetricRow),
      termsHidden,
      citations: citations.map(toCitation),
    };
  }

  /**
   * Every INDEXABLE fund slug, for the sitemap. Restates `fundIndexable` (in
   * `@repo/api`) as a Prisma filter — keep the two in step.
   */
  /** One `SITEMAP_PAGE_SIZE` page of the indexable funds, by slug. */
  async listSlugs(page = 0): Promise<FundSlugEntry[]> {
    const rows = await this.prisma.fund.findMany({
      where: INDEXABLE_FUND,
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
      skip: page * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
    });
    return rows.map((r) => ({ slug: r.slug!, updatedAt: r.updatedAt.toISOString() }));
  }

  countSlugs(): Promise<number> {
    return this.prisma.fund.count({ where: INDEXABLE_FUND });
  }
}

/**
 * Default sort is by size, deliberately.
 *
 * AngelList-style SPV platforms report tens of thousands of near-empty funds
 * (one filer alone reports 22,277, some with $101 of gross assets). Sorting by
 * name or vintage would let them own every page; sorting by size puts the funds
 * a reader came for first. `sizeUsd` is the figure the row shows (gross assets,
 * else capital closed), so a partner fund with a size but no Form ADV NAV ranks
 * by it. Nulls sort last either way — an unreported value is not a small one.
 */
export function fundOrderBy(sort: FundListQuery['sort']): Prisma.FundOrderByWithRelationInput[] {
  if (sort === 'name') return [{ name: 'asc' }];
  if (sort === 'vintage') return [{ vintageYear: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
  return [{ sizeUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
}
