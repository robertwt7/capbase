import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  FUND_COMMITMENT_PREVIEW,
  SITEMAP_PAGE_SIZE,
  fundIndexable,
  gateLimit,
  gateView,
  partnerVisible,
  sectionPartnerRows,
  type DirectoryPage,
  type FundDetailResponse,
  type FundListQuery,
  type FundSlugEntry,
  type FundSummary,
  type FundTerms,
  type Role,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import {
  FUND_BLANKS,
  directoryFilters,
  gateFields,
  gateRowFields,
  limitRows,
  listAccessFor,
  maskFields,
  publicRowsWhere,
  rowVisible,
  stubFor,
  takeFor,
} from '../gate/gate';
import { GatePolicyService } from '../gate/gate-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_INVESTOR } from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { UsersService } from '../users/users.service';
import {
  toFundCommitmentRow,
  toFundMandate,
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
/** The terms block (`fundTerms`, contributors by default). Region focus is a
 *  description, not a term, and stays with the facts. */
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

/** The stored columns behind `FundMandate`. */
const MANDATE_COLUMNS = [
  'detailedStrategy',
  'industries',
  'verticals',
  'geographicFocus',
  'geographicExposure',
  'domicile',
  'structure',
  'legalStructure',
  'mandateReportedOn',
];

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
    private readonly gatePolicy: GatePolicyService,
  ) {}

  /**
   * One page of funds. A signed-out viewer never sees a partner-only fund.
   * Every value follows its field policy: masked, a filter on it ignored or
   * narrowed (`directoryFilters` — the status filter, a partner-only column,
   * is ignored below its partner audience), a sort on it falling back to name.
   */
  async findAll(query: FundListQuery = {}, viewer?: { id: string; role: Role }): Promise<DirectoryPage<FundSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const policy = this.gatePolicy.current();
    const access = await listAccessFor(viewer, policy, 'fund', (v) => this.users.accessFor(v));
    const dir = directoryFilters(policy, 'fund', access, {
      strategy: Boolean(query.strategy),
      status: Boolean(query.status),
    });
    // The default sort (size) is itself a sort on gross assets / capital closed.
    const sort = dir.sortLocked(query.sort ?? 'size') ? 'name' : query.sort;

    const where: Prisma.FundWhereInput = {
      ...PUBLIC_FUND,
      ...(partnerVisible(access) ? {} : { partnerOnly: false }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.strategy && dir.use('strategy') && { strategy: query.strategy }),
      ...(query.status && dir.use('status') && { status: query.status }),
      ...(query.manager && { manager: { slug: query.manager } }),
      AND: dir.and,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fund.count({ where }),
      this.prisma.fund.findMany({
        where,
        orderBy: fundOrderBy(sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { manager: MANAGER_SELECT },
      }),
    ]);

    return {
      items: rows.map((r) =>
        gateFields('fund', toFundSummary(r as FundWithManager), r.partnerFields, access, policy, FUND_BLANKS),
      ),
      total,
      page,
      pageSize,
      locked: dir.locked,
    };
  }

  /**
   * The fund page: facts, terms, the largest commitments, metrics, and the
   * citations SEC funds carry. 404 for an unknown or unpublished fund.
   *
   * Gated by the policy: commitments and metrics are capped (`gateLimit`, the
   * partner's rows only above the section's partner audience) against counts
   * over all of them; the terms (`termsHidden`) and the reported mandate
   * (`mandateHidden`) are blocks, whole or withheld; every fact follows its
   * field policy; a partner-only fund is a stub for a signed-out viewer. A
   * block switched off for everyone is withheld without saying so.
   */
  async findOne(slug: string, viewer?: { id: string; role: Role }): Promise<FundDetailResponse> {
    const policy = this.gatePolicy.current();
    const access = await this.users.accessFor(viewer);
    const limit = (section: Parameters<typeof gateLimit>[0]) => gateLimit(section, access, policy);
    const row = await this.prisma.fund.findFirst({
      where: { slug, ...PUBLIC_FUND },
      include: {
        manager: MANAGER_SELECT,
        commitments: {
          where: { ...PUBLIC_FUND_COMMITMENTS, ...publicRowsWhere(access, policy, 'fundCommitments') },
          orderBy: [{ amountUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: takeFor(Math.min(FUND_COMMITMENT_PREVIEW, limit('fundCommitments'))),
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
    const mandate = toFundMandate(row);
    const commitmentCount = row._count.commitments;
    const gate = gateView(policy, 'fund', access);
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
      access,
      gate,
    };

    if (stubFor(row.partnerOnly, access)) {
      const fund = maskFields({ ...summary, ...terms }, FUND_STUB_HIDDEN, FUND_BLANKS);
      return {
        ...base,
        fund: { ...fund, manager: { ...fund.manager, domain: null }, partnerOnly: true },
        commitments: [],
        metrics: [],
        termsHidden: false,
        // The stub renders no sections; the gate never reaches the mandate.
        mandate: null,
        mandateHidden: false,
        citations: [],
      };
    }

    // A switched-off block is withheld without a lock (nothing to unlock).
    const termsWithheld = limit('fundTerms') === 0;
    const termsHidden =
      termsWithheld &&
      !gate.sections.fundTerms?.disabled &&
      GATED_TERMS.some((t) => terms[t] !== null && terms[t] !== undefined);
    // Every mandate column is the partner's: below the block's partner
    // audience it is withheld like a gated block (sign in reveals it).
    const mandateWithheld =
      limit('fundMandate') === 0 ||
      (!sectionPartnerRows(policy, 'fundMandate', access) &&
        MANDATE_COLUMNS.some((c) => (row.partnerFields ?? []).includes(c)));
    const mandateHidden = mandateWithheld && !gate.sections.fundMandate?.disabled && mandate !== null;
    // Facts follow the fund field policy; the terms, the terms section's partner audience.
    const termSet = new Set<string>(GATED_TERMS);
    const partnerFields = row.partnerFields ?? [];
    let fund = gateFields(
      'fund',
      { ...summary, ...terms },
      partnerFields.filter((f) => !termSet.has(f)),
      access,
      policy,
      FUND_BLANKS,
    );
    if (termsWithheld) {
      fund = { ...fund };
      for (const t of GATED_TERMS) fund[t] = null;
    } else {
      fund = gateRowFields(
        fund,
        partnerFields.filter((f) => termSet.has(f)),
        access,
        policy,
        'fundTerms',
        FUND_BLANKS,
      );
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
        row.metrics.filter((m) => rowVisible(m, access, policy, 'fundMetrics')),
        limit('fundMetrics'),
      ).map(toFundMetricRow),
      termsHidden,
      mandate: mandateWithheld ? null : mandate,
      mandateHidden,
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
