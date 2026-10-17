import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  INVESTOR_COMMITMENT_PREVIEW,
  INVESTOR_PEOPLE_PREVIEW,
  INVESTOR_PORTFOLIO_PREVIEW,
  SITEMAP_PAGE_SIZE,
  normalizeDomain,
  type Citation,
  type CountryFacet,
  type EntityIdentifierRef,
  type FundStrategy,
  type InvestorCommitmentRow,
  type InvestorDetailResponse,
  type InvestorEditFields,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { toPerson } from '../companies/company.mapper';
import { toFund } from '../funds/fund.mapper';
import { toFacets } from '../prisma/country-facets';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_MERGE_HOPS,
  PUBLIC_COMPANY_RELATION,
  PUBLIC_INVESTOR,
} from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { toEntityIdentifiers } from '../provenance/identifier.mapper';
import { CreateInvestorProposalDto } from './dto/create-investor-proposal.dto';
import {
  toInvestorEditFields,
  toInvestorSummary,
  type InvestorWithHoldings,
} from './investor.mapper';

/** How many portfolio companies to include in each investor's preview sample. */
const PORTFOLIO_SAMPLE = 6;

/** How many named funds the profile shows before linking to /funds. The SPV
 *  platforms report tens of thousands, so this is a preview, not a list. */
export const FUND_PREVIEW = 12;

/** Funds are ingest-only and auto-APPROVED; the filter matches every sibling
 *  read so a later contribution path needs no change here. */
const PUBLIC_FUNDS = { moderationStatus: 'APPROVED' } satisfies Prisma.FundWhereInput;

/** Only approved holdings on approved companies count towards a portfolio. */
const PUBLIC_HOLDINGS = {
  moderationStatus: 'APPROVED',
  company: PUBLIC_COMPANY_RELATION,
} satisfies Prisma.InvestorHoldingWhereInput;

/** The firm's own officers (Wikidata P112/P169) that the profile lists. */
const PUBLIC_OFFICERS = { moderationStatus: 'APPROVED' } satisfies Prisma.PersonRoleWhereInput;

/** An LP's commitments that the profile lists: approved, to a published fund. */
const PUBLIC_LP_COMMITMENTS = {
  moderationStatus: 'APPROVED',
  fund: PUBLIC_FUNDS,
} satisfies Prisma.FundCommitmentWhereInput;

/**
 * Worth a search engine's time: the profile shows at least one portfolio
 * company, named fund or officer. Built from the SAME filters the detail read
 * counts with, so a firm can't be indexable on a row its page doesn't show —
 * and `findOne` derives `indexable` from those counts, so the sitemap and the
 * robots meta always agree.
 */
const INDEXABLE_INVESTOR = {
  ...PUBLIC_INVESTOR,
  OR: [
    { holdings: { some: PUBLIC_HOLDINGS } },
    { funds: { some: PUBLIC_FUNDS } },
    { people: { some: PUBLIC_OFFICERS } },
    { commitments: { some: PUBLIC_LP_COMMITMENTS } },
  ],
} satisfies Prisma.InvestorWhereInput;

/** Same cadence as the company facet: the investor table only moves on ingest. */
const COUNTRY_FACET_TTL_MS = 15 * 60_000;

const COMPANY_SELECT = {
  select: { slug: true, name: true, domain: true, primarySector: true },
};

@Injectable()
export class InvestorsService {
  private countryFacet: { items: CountryFacet[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** How many public investors each country holds, most first — the
   *  directory's country filter. Same contract as CompaniesService.countries. */
  async countries(): Promise<CountryFacet[]> {
    if (this.countryFacet && this.countryFacet.expiresAt > Date.now()) return this.countryFacet.items;
    const rows = await this.prisma.investor.groupBy({
      by: ['countryCode'],
      where: { ...PUBLIC_INVESTOR, countryCode: { not: null } },
      _count: { _all: true },
    });
    const items = toFacets(rows);
    this.countryFacet = { items, expiresAt: Date.now() + COUNTRY_FACET_TTL_MS };
    return items;
  }

  /**
   * One page of investors, read straight from the Investor table.
   *
   * Investors with no known portfolio are included on purpose: the SEC Form ADV
   * universe is mostly firms whose investments no free source discloses, and
   * their profiles invite a contribution rather than hiding.
   */
  async findAll(query: InvestorListQuery = {}): Promise<Paginated<InvestorSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.InvestorWhereInput = {
      ...PUBLIC_INVESTOR,
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.type && { type: query.type }),
      ...(query.country && { countryCode: query.country }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.investor.count({ where }),
      this.prisma.investor.findMany({
        where,
        orderBy:
          query.sort === 'name'
            ? [{ name: 'asc' }]
            : [{ holdings: { _count: 'desc' } }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          holdings: {
            where: PUBLIC_HOLDINGS,
            take: PORTFOLIO_SAMPLE,
            include: { company: COMPANY_SELECT },
          },
          _count: { select: { holdings: { where: PUBLIC_HOLDINGS } } },
        },
      }),
    ]);

    return { items: rows.map((r) => toInvestorSummary(r as InvestorWithHoldings)), total, page, pageSize };
  }

  /**
   * Store a field-level edit to a public firm (PENDING). Keys equal to the firm's current values
   * are dropped; an empty diff is a 400. A hidden or merged-away firm is a 404 — an edit must
   * target the row the public sees (follow the 301 on the read for a merged slug).
   */
  async proposeChange(slug: string, dto: CreateInvestorProposalDto, userId: string) {
    const firm = await this.prisma.investor.findFirst({ where: { slug, ...PUBLIC_INVESTOR } });
    if (!firm) throw new NotFoundException(`Investor "${slug}" not found`);
    const current = toInvestorEditFields(firm);

    const cleaned: InvestorEditFields = {};
    for (const key of Object.keys(dto.changes) as (keyof InvestorEditFields)[]) {
      let value = dto.changes[key];
      if (value === undefined) continue;
      if (key === 'domain' && typeof value === 'string') value = normalizeDomain(value) || null;
      if (value === current[key]) continue;
      (cleaned as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(cleaned).length === 0) {
      throw new BadRequestException('No changes proposed');
    }

    const created = await this.prisma.investorChangeProposal.create({
      data: {
        investorId: firm.id,
        changes: cleaned as Prisma.InputJsonValue,
        note: dto.note ?? null,
        sourceUrl: dto.sourceUrl ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  /** Full profile: the largest slice of the approved portfolio (with the full
   *  count and every sector), the largest funds we can name and the citations
   *  attesting them. */
  async findOne(slug: string): Promise<InvestorDetailResponse> {
    const found = await this.prisma.investor.findFirst({
      where: { slug, ...PUBLIC_INVESTOR },
      include: {
        holdings: {
          where: PUBLIC_HOLDINGS,
          orderBy: [{ company: { totalRaisedUsd: 'desc' } }, { id: 'asc' }],
          take: INVESTOR_PORTFOLIO_PREVIEW,
          include: { company: COMPANY_SELECT },
        },
        funds: {
          where: PUBLIC_FUNDS,
          orderBy: [{ grossAssetsUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
          take: FUND_PREVIEW,
        },
        // Capped: a large firm lists thousands of staff. `peopleCount` says how
        // many the page is not showing.
        people: {
          where: PUBLIC_OFFICERS,
          orderBy: [{ since: 'desc' }, { id: 'asc' }],
          take: INVESTOR_PEOPLE_PREVIEW,
          include: { person: { select: { slug: true, mergedIntoId: true, suppressedAt: true } } },
        },
        commitments: {
          where: PUBLIC_LP_COMMITMENTS,
          orderBy: [{ amountUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: INVESTOR_COMMITMENT_PREVIEW,
          include: {
            fund: {
              select: {
                slug: true,
                name: true,
                vintageYear: true,
                strategy: true,
                manager: { select: { slug: true, name: true } },
              },
            },
          },
        },
      },
    });
    // Returns `never` — either a 301 to the survivor, or a 404.
    if (!found) return this.redirectOrNotFound(slug);

    // Four targeted counts, each served by an index on the firm's id. Not
    // Prisma's `_count`: that aggregates the WHOLE child table with GROUP BY
    // before joining, which on half a million holdings and roles cost ~500 ms
    // per profile even for a firm with none.
    const [holdingCount, fundCount, peopleCount, commitmentCount] = await Promise.all([
      this.prisma.investorHolding.count({ where: { investorId: found.id, ...PUBLIC_HOLDINGS } }),
      this.prisma.fund.count({ where: { managerId: found.id, ...PUBLIC_FUNDS } }),
      this.prisma.personRole.count({ where: { investorId: found.id, ...PUBLIC_OFFICERS } }),
      this.prisma.fundCommitment.count({ where: { investorId: found.id, ...PUBLIC_LP_COMMITMENTS } }),
    ]);
    const row = {
      ...found,
      _count: { holdings: holdingCount, funds: fundCount, people: peopleCount, commitments: commitmentCount },
    };

    const funds = row.funds.map(toFund);
    const summary = toInvestorSummary(row as unknown as InvestorWithHoldings);
    // The holdings above are a capped slice, so the sector list is read across
    // the whole portfolio rather than off the sample.
    if (summary.portfolioCount > row.holdings.length) {
      summary.sectors = (
        await this.prisma.company.findMany({
          where: {
            ...PUBLIC_COMPANY_RELATION,
            primarySector: { not: null },
            investors: { some: { investorId: row.id, moderationStatus: 'APPROVED' } },
          },
          distinct: ['primarySector'],
          select: { primarySector: true },
        })
      )
        .map((c) => c.primarySector!)
        .sort((a, b) => a.localeCompare(b));
    }
    return {
      ...summary,
      identifiers: await this.loadIdentifiers(row.id),
      // Officers Wikidata names on the firm itself. Same role rows as a
      // company's people, carrying investorId instead of companyId.
      people: row.people.map(toPerson),
      peopleCount: row._count.people,
      commitments: row.commitments.map(
        (c): InvestorCommitmentRow => ({
          id: c.id,
          fund: {
            slug: c.fund.slug,
            name: c.fund.name,
            vintageYear: c.fund.vintageYear,
            strategy: c.fund.strategy as FundStrategy | null,
          },
          manager: { slug: c.fund.manager.slug, name: c.fund.manager.name },
          amountUsd: c.amountUsd === null ? null : Number(c.amountUsd),
          amountLocal: c.amountLocal === null ? null : Number(c.amountLocal),
          currency: c.currency,
        }),
      ),
      commitmentCount: row._count.commitments,
      funds,
      // What we can name, as against `fundCount` — what the firm told the SEC.
      namedFundCount: row._count.funds,
      citations: await this.loadFundCitations(funds.map((f) => f.id)),
      // INDEXABLE_INVESTOR, read off the counts this response already carries.
      indexable:
        summary.portfolioCount > 0 ||
        row._count.funds > 0 ||
        row._count.people > 0 ||
        row._count.commitments > 0,
    };
  }

  /**
   * A slug no live investor answers to: either a tombstone, or nothing. Always
   * throws.
   *
   * 301 with the survivor's slug in the body and deliberately **no** `Location`
   * header — see the identical note on CompaniesService. With one, the web
   * app's server-side fetch would follow it and render the survivor under the
   * old URL instead of moving the browser.
   */
  private async redirectOrNotFound(slug: string): Promise<never> {
    const survivor = await this.resolveMerged(slug);
    if (survivor) {
      throw new HttpException(
        { message: `Investor "${slug}" was merged`, redirectTo: survivor, statusCode: 301 },
        HttpStatus.MOVED_PERMANENTLY,
      );
    }
    throw new NotFoundException(`Investor "${slug}" not found`);
  }

  /** Follow a chain of merges to the live row at the end of it, or null. Capped
   *  so a cycle cannot hang the request. */
  private async resolveMerged(slug: string): Promise<string | null> {
    let row = await this.prisma.investor.findUnique({
      where: { slug },
      select: { slug: true, mergedIntoId: true, moderationStatus: true },
    });
    if (!row?.mergedIntoId) return null;

    let next: string | null = row.mergedIntoId;
    for (let hop = 0; hop < MAX_MERGE_HOPS && next; hop++) {
      row = await this.prisma.investor.findUnique({
        where: { id: next },
        select: { slug: true, mergedIntoId: true, moderationStatus: true },
      });
      if (!row) return null;
      if (!row.mergedIntoId) {
        return row.moderationStatus === 'APPROVED' ? row.slug : null;
      }
      next = row.mergedIntoId;
    }
    return null;
  }

  /** The firm's external identifiers (CRD, CIK, LEI, QID) for the crosswalk
   *  block. Detail read only — the directory list stays one query. */
  private async loadIdentifiers(investorId: string): Promise<EntityIdentifierRef[]> {
    const rows = await this.prisma.entityIdentifier.findMany({
      where: { entityType: 'investor', entityId: investorId },
    });
    return toEntityIdentifiers(rows);
  }

  /** Citations attaching to the fund rows in the response, in one query over a
   *  bounded id list — the same shape the company profile uses. */
  private async loadFundCitations(ids: string[]): Promise<Citation[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.citation.findMany({
      where: { entityType: 'fund', entityId: { in: ids } },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCitation);
  }

  /**
   * Every INDEXABLE investor slug, for the web sitemap. Most of the Form ADV
   * universe is a name and an address; those profiles stay public but
   * `noindex`, and join the sitemap on their own once a holding, fund or
   * officer arrives.
   */
  /** One `SITEMAP_PAGE_SIZE` page, by slug: a unique, stable order, so a row
   *  updated between two page reads can neither repeat nor go missing. */
  async listSlugs(page = 0): Promise<InvestorSlugEntry[]> {
    const rows = await this.prisma.investor.findMany({
      where: INDEXABLE_INVESTOR,
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
      skip: page * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  countSlugs(): Promise<number> {
    return this.prisma.investor.count({ where: INDEXABLE_INVESTOR });
  }
}
