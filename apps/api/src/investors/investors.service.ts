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
  fieldGate,
  gateLimit,
  gateView,
  normalizeDomain,
  partnerVisible,
  sectionPartnerRows,
  type Citation,
  type CountryFacet,
  type DirectoryPage,
  type EntityIdentifierRef,
  type FundStrategy,
  type InvestorCommitmentRow,
  type InvestorDetailResponse,
  type InvestorEditFields,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type GatePolicy,
  type Role,
  type ViewerAccess,
} from '@repo/api';
import { Prisma } from '@repo/db';

import { toPerson } from '../companies/company.mapper';
import { toFund } from '../funds/fund.mapper';
import { toInvestorFocus } from './investor-focus.mapper';
import {
  FUND_BLANKS,
  INVESTOR_BLANKS,
  PARTNER_SOURCE,
  directoryFilters,
  gateFields,
  listAccessFor,
  maskFields,
  publicRowsWhere,
  stubFor,
  takeFor,
} from '../gate/gate';
import { GatePolicyService } from '../gate/gate-policy.service';
import { toFacets } from '../prisma/country-facets';
import { PrismaService } from '../prisma/prisma.service';
import { resolveInvestorSurvivor } from '../prisma/merge-chain';
import {
  PUBLIC_COMPANY_RELATION,
  PUBLIC_INVESTOR,
} from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { toEntityIdentifiers } from '../provenance/identifier.mapper';
import { UsersService } from '../users/users.service';
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

/** A firm with non-empty public prose, matching Boolean(row.description). */
const HAS_DESCRIPTION = {
  AND: [{ description: { not: null } }, { NOT: { description: '' } }],
} satisfies Prisma.InvestorWhereInput;

/** Public prose makes any firm indexable, including a partner-only stub.
 *  Otherwise a public-record firm needs a holding, fund, officer or commitment.
 *  `findOne` uses the same description and relation counts for robots metadata. */
const INDEXABLE_INVESTOR = {
  ...PUBLIC_INVESTOR,
  OR: [
    {
      partnerOnly: false,
      OR: [
        { holdings: { some: PUBLIC_HOLDINGS } },
        { funds: { some: PUBLIC_FUNDS } },
        { people: { some: PUBLIC_OFFICERS } },
        { commitments: { some: PUBLIC_LP_COMMITMENTS } },
      ],
    },
    HAS_DESCRIPTION,
  ],
} satisfies Prisma.InvestorWhereInput;

/** Same cadence as the company facet: the investor table only moves on ingest. */
const COUNTRY_FACET_TTL_MS = 15 * 60_000;

const COMPANY_SELECT = {
  select: { slug: true, name: true, domain: true, primarySector: true },
};

/** One row of the directory's portfolio sample: a holding's company, per firm. */
type SampleRow = { investorId: string; slug: string; name: string; domain: string; primarySector: string | null };
type SampleHolding = { company: Omit<SampleRow, 'investorId'> };

/** Every Investor field a partner-only stub withholds: all but the identity
 *  (slug, name), the prose (which follows its field policy — public by
 *  default) and — unless the partner wrote it — the logo domain. */
const INVESTOR_STUB_HIDDEN = [
  'legalName',
  'type',
  'hq',
  'countryCode',
  'websiteUrl',
  'linkedinUrl',
  'fundCount',
  'assetsUsd',
  'foundedYear',
];

/** Holdings a viewer may see on a card or profile: the partner's edges only
 *  when the portfolio section's partner audience is met, and no partner-only
 *  company signed out (the fixed entity rule). */
const visibleHoldings = (access: ViewerAccess, policy: GatePolicy): Prisma.InvestorHoldingWhereInput => ({
  ...PUBLIC_HOLDINGS,
  ...publicRowsWhere(access, policy, 'investorPortfolio'),
  company: partnerVisible(access) ? PUBLIC_COMPANY_RELATION : { ...PUBLIC_COMPANY_RELATION, partnerOnly: false },
});

@Injectable()
export class InvestorsService {
  private countryFacet: { items: CountryFacet[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly gatePolicy: GatePolicyService,
  ) {}

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
   *
   * A signed-out viewer never sees a partner-only firm. Every value follows its
   * field policy (masked, its filter ignored or narrowed — see
   * `directoryFilters`), the card's portfolio sample the portfolio section's
   * partner audience and the company field policy (domain, sector).
   */
  async findAll(
    query: InvestorListQuery = {},
    viewer?: { id: string; role: Role },
  ): Promise<DirectoryPage<InvestorSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const policy = this.gatePolicy.current();
    const access = await listAccessFor(viewer, policy, ['investor', 'company'], (v) => this.users.accessFor(v));
    const dir = directoryFilters(policy, 'investor', access, {
      type: Boolean(query.type),
      country: Boolean(query.country),
    });

    const where: Prisma.InvestorWhereInput = {
      ...PUBLIC_INVESTOR,
      ...(partnerVisible(access) ? {} : { partnerOnly: false }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.type && dir.use('type') && { type: query.type }),
      ...(query.country && dir.use('country') && { countryCode: query.country }),
      AND: dir.and,
    };

    // The sort and the card's count both read the stored `holdingCount`
    // (refreshDirectoryCounts — kept fresh by moderation, merges and the end of
    // every ingest run). A relation-count orderBy, or a `_count` include,
    // GROUP BYs the whole InvestorHolding table before the LIMIT, and a live
    // count of the page joined its ~27k holdings to Company.
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.investor.count({ where }),
      this.prisma.investor.findMany({
        where,
        orderBy: query.sort === 'name' ? [{ name: 'asc' }] : [{ holdingCount: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const sample = await this.portfolioSample(
      rows.map((r) => r.id),
      access,
      policy,
    );

    return {
      items: rows.map((r) =>
        gateFields(
          'investor',
          toInvestorSummary({
            ...r,
            holdings: sample.get(r.id) ?? [],
            _count: { holdings: r.holdingCount },
          } as unknown as InvestorWithHoldings),
          r.partnerFields,
          access,
          policy,
          INVESTOR_BLANKS,
        ),
      ),
      total,
      page,
      pageSize,
      locked: dir.locked,
    };
  }

  /**
   * The card's portfolio sample — up to PORTFOLIO_SAMPLE visible holdings per
   * firm — in one query. Prisma does not push a nested `take` into SQL: the
   * include this replaces loaded every holding of the page's firms (27,521 rows
   * on page 1) to keep six each.
   *
   * Restates `visibleHoldings` inline (keep them in step). Ordered by
   * (externalSource, id) to walk InvestorHolding_investorId_externalSource_id_idx;
   * "not PARTNER" is spelled as three ranges so a read without the partner's
   * holdings skips them (560k of 562k) instead of filtering them. A company
   * domain or sector follows the company field policy, as in /search.
   */
  private async portfolioSample(
    ids: string[],
    access: ViewerAccess,
    policy: GatePolicy,
  ): Promise<Map<string, SampleHolding[]>> {
    if (ids.length === 0) return new Map();
    const signedOut = !partnerVisible(access);
    const partnerHoldings = sectionPartnerRows(policy, 'investorPortfolio', access);
    const unmarked = (column: string, expr: Prisma.Sql, blank: Prisma.Sql) => {
      const gate = fieldGate(policy, 'company', column, access);
      if (gate === 'hide') return blank;
      return gate === 'hidePartner'
        ? Prisma.sql`CASE WHEN ${column} = ANY(c."partnerFields") THEN ${blank} ELSE ${expr} END`
        : expr;
    };
    const rows = await this.prisma.$queryRaw<SampleRow[]>`
      SELECT p.id AS "investorId", s.slug, s.name, s.domain, s."primarySector"
        FROM unnest(${ids}::text[]) AS p(id)
       CROSS JOIN LATERAL (
         SELECT c.slug, c.name,
                ${unmarked('domain', Prisma.sql`c.domain`, Prisma.sql`''`)} AS domain,
                ${unmarked('primarySector', Prisma.sql`c."primarySector"`, Prisma.sql`NULL`)} AS "primarySector"
           FROM "InvestorHolding" h
           JOIN "Company" c ON c.id = h."companyId"
          WHERE h."investorId" = p.id
            AND h."moderationStatus" = 'APPROVED'
            AND c."moderationStatus" = 'APPROVED'
            AND c."mergedIntoId" IS NULL
            ${
              partnerHoldings
                ? Prisma.empty
                : Prisma.sql`AND (h."externalSource" IS NULL OR h."externalSource" < ${PARTNER_SOURCE} OR h."externalSource" > ${PARTNER_SOURCE})`
            }
            ${signedOut ? Prisma.sql`AND NOT c."partnerOnly"` : Prisma.empty}
          ORDER BY h."externalSource", h.id
          LIMIT ${PORTFOLIO_SAMPLE}
       ) s`;

    const byFirm = new Map<string, SampleHolding[]>();
    for (const { investorId, ...company } of rows) {
      const list = byFirm.get(investorId) ?? [];
      list.push({ company });
      byFirm.set(investorId, list);
    }
    return byFirm;
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

  /**
   * Full profile: the largest slice of the approved portfolio (with the full
   * count and every sector), the largest funds we can name and the citations
   * attesting them — each section capped by the gate (`gateLimit`), with the
   * partner's rows only when its partner audience is met, while every count
   * covers all rows. A partner-only firm is a stub for a signed-out viewer.
   */
  async findOne(slug: string, viewer?: { id: string; role: Role }): Promise<InvestorDetailResponse> {
    const policy = this.gatePolicy.current();
    const access = await this.users.accessFor(viewer);
    const take = (cap: number, section: Parameters<typeof gateLimit>[0]) =>
      takeFor(Math.min(cap, gateLimit(section, access, policy)));
    const found = await this.prisma.investor.findFirst({
      where: { slug, ...PUBLIC_INVESTOR },
      include: {
        holdings: {
          where: visibleHoldings(access, policy),
          orderBy: [{ company: { totalRaisedUsd: 'desc' } }, { id: 'asc' }],
          take: take(INVESTOR_PORTFOLIO_PREVIEW, 'investorPortfolio'),
          include: { company: COMPANY_SELECT },
        },
        funds: {
          where: { ...PUBLIC_FUNDS, ...publicRowsWhere(access, policy, 'investorFunds') },
          orderBy: [{ grossAssetsUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
          take: take(FUND_PREVIEW, 'investorFunds'),
        },
        // Capped: a large firm lists thousands of staff. `peopleCount` says how
        // many the page is not showing.
        people: {
          where: { ...PUBLIC_OFFICERS, ...publicRowsWhere(access, policy, 'investorPeople') },
          orderBy: [{ since: 'desc' }, { id: 'asc' }],
          take: take(INVESTOR_PEOPLE_PREVIEW, 'investorPeople'),
          include: { person: { select: { slug: true, mergedIntoId: true, suppressedAt: true } } },
        },
        commitments: {
          where: { ...PUBLIC_LP_COMMITMENTS, ...publicRowsWhere(access, policy, 'investorCommitments') },
          orderBy: [{ amountUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: take(INVESTOR_COMMITMENT_PREVIEW, 'investorCommitments'),
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
    // The reported focus is ≤ 2 rows per role (`investorFocus`): the role
    // probe is public like every count, and the rows themselves are loaded
    // only for a viewer the gate lets see them — never signed out.
    const focusVisible = gateLimit('investorFocus', access, policy) > 0;
    const [holdingCount, fundCount, peopleCount, commitmentCount, focusRoles, focusRows] = await Promise.all([
      this.prisma.investorHolding.count({ where: { investorId: found.id, ...PUBLIC_HOLDINGS } }),
      this.prisma.fund.count({ where: { managerId: found.id, ...PUBLIC_FUNDS } }),
      this.prisma.personRole.count({ where: { investorId: found.id, ...PUBLIC_OFFICERS } }),
      this.prisma.fundCommitment.count({ where: { investorId: found.id, ...PUBLIC_LP_COMMITMENTS } }),
      this.prisma.investorFocus.findMany({
        where: { investorId: found.id },
        distinct: ['role'],
        select: { role: true },
      }),
      focusVisible
        ? this.prisma.investorFocus.findMany({
            // Read gate rule 2, as `publicRowsWhere` states it — but this
            // column is non-nullable, so the plain `not` form is exact here.
            where: {
              investorId: found.id,
              ...(sectionPartnerRows(policy, 'investorFocus', access)
                ? {}
                : { externalSource: { not: PARTNER_SOURCE } }),
            },
            orderBy: [{ reportedOn: 'desc' }, { externalId: 'asc' }],
          })
        : Promise.resolve([]),
    ]);
    const focusCount = focusRoles.length;
    const row = {
      ...found,
      _count: { holdings: holdingCount, funds: fundCount, people: peopleCount, commitments: commitmentCount },
    };
    const gate = gateView(policy, 'investor', access);

    if (stubFor(row.partnerOnly, access)) {
      const hidden = row.partnerFields.includes('domain') ? [...INVESTOR_STUB_HIDDEN, 'domain'] : INVESTOR_STUB_HIDDEN;
      const summary = maskFields(
        gateFields(
          'investor',
          toInvestorSummary({ ...row, holdings: [] } as unknown as InvestorWithHoldings),
          row.partnerFields,
          access,
          policy,
          INVESTOR_BLANKS,
        ),
        hidden,
        INVESTOR_BLANKS,
      );
      return {
        ...summary,
        partnerOnly: true,
        people: [],
        peopleCount: row._count.people,
        commitments: [],
        commitmentCount: row._count.commitments,
        funds: [],
        namedFundCount: row._count.funds,
        citations: [],
        focus: null,
        focusCount,
        indexable: Boolean(row.description),
        access,
        gate,
      };
    }

    const funds = row.funds.map((f) => gateFields('fund', toFund(f), f.partnerFields, access, policy, FUND_BLANKS));
    const summary = gateFields(
      'investor',
      toInvestorSummary(row as unknown as InvestorWithHoldings),
      row.partnerFields,
      access,
      policy,
      INVESTOR_BLANKS,
    );
    // The portfolio tiles' logo domain and the sector list follow the company
    // field policy's audience (a value hidden from this viewer whoever wrote it).
    const sectorGate = fieldGate(policy, 'company', 'primarySector', access);
    if (fieldGate(policy, 'company', 'domain', access) === 'hide') {
      summary.companies = summary.companies.map((c) => ({ ...c, domain: '' }));
    }
    if (sectorGate === 'hide') summary.sectors = [];
    // The holdings above are a capped slice, so the sector list is read across
    // the whole portfolio rather than off the sample — the part of it this
    // viewer may see (no hidden partner edge or partner-written sector).
    else if (summary.portfolioCount > row.holdings.length) {
      summary.sectors = (
        await this.prisma.company.findMany({
          where: {
            ...PUBLIC_COMPANY_RELATION,
            primarySector: { not: null },
            investors: { some: { ...visibleHoldings(access, policy), investorId: row.id } },
            ...(sectorGate === 'show' ? {} : { NOT: { partnerFields: { has: 'primarySector' } } }),
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
      // Partner data, gated `members`; never part of the indexable rule.
      focus: toInvestorFocus(focusRows),
      focusCount,
      // INDEXABLE_INVESTOR, read off the counts this response already carries.
      indexable:
        Boolean(row.description) ||
        (!row.partnerOnly &&
          (summary.portfolioCount > 0 ||
            row._count.funds > 0 ||
            row._count.people > 0 ||
            row._count.commitments > 0)),
      access,
      gate,
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

  /** The slug of the live firm a merged-away slug now answers to, or null.
   *  Capped so a cycle cannot hang the request (`resolveInvestorSurvivor`). */
  private async resolveMerged(slug: string): Promise<string | null> {
    const survivor = await resolveInvestorSurvivor(this.prisma, slug);
    return survivor && survivor.slug !== slug ? survivor.slug : null;
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
   * `noindex`, and join the sitemap on their own once public prose, a holding, fund,
   * officer or commitment arrives.
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
