import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONTRIBUTION_WINDOW_DAYS,
  DEFAULT_PAGE_SIZE,
  PREVIEW_LIMIT,
  type CitableType,
  type Citation,
  type Company,
  type CompanyDetailResponse,
  type CompanyEditFields,
  type CompanyHistoryResponse,
  type CompanyListQuery,
  type CompanySlugEntry,
  type EntityIdentifierRef,
  type Paginated,
  type Revision,
  type RevisionAction,
  type RevisionActor,
  type Role,
} from '@repo/api';
import type { Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MAX_MERGE_HOPS, PUBLIC_COMPANY } from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { toEntityIdentifiers } from '../provenance/identifier.mapper';
import { toCompany, toCompanyEditFields } from './company.mapper';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateAcquisitionDto,
  CreateDiversityDto,
  CreateExitDto,
  CreateFundingRoundDto,
  CreateInvestorDto,
  CreatePersonDto,
} from './dto/contributions.dto';
import { CreateChangeProposalDto } from './dto/create-proposal.dto';

const approvedChildren = {
  rounds: {
    where: { moderationStatus: 'APPROVED' as const },
    include: { investors: true },
    orderBy: { date: 'asc' as const },
  },
  people: { where: { moderationStatus: 'APPROVED' as const } },
  investors: {
    where: { moderationStatus: 'APPROVED' as const },
    // The linked firm's slug turns each card into a link to its profile.
    include: { investor: { select: { slug: true, moderationStatus: true } } },
  },
  acquisitions: {
    where: { moderationStatus: 'APPROVED' as const },
    orderBy: { date: 'asc' as const },
  },
  exits: {
    where: { moderationStatus: 'APPROVED' as const },
    orderBy: { date: 'asc' as const },
  },
  diversity: { where: { moderationStatus: 'APPROVED' as const } },
};

const money = (v: number | null | undefined): bigint | null =>
  v === null || v === undefined ? null : BigInt(v);

// Field-level equality for proposal diffs (arrays = element-wise, i.e. `industry`).
const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

const WINDOW_MS = CONTRIBUTION_WINDOW_DAYS * 86_400_000;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** One page of approved companies, filtered/sorted server-side. */
  async findAllApproved(query: CompanyListQuery = {}): Promise<Paginated<Company>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.CompanyWhereInput = {
      ...PUBLIC_COMPANY,
      ...(query.slugs && { slug: { in: query.slugs.split(',').filter(Boolean) } }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' as const } },
          { oneLiner: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.sector && { primarySector: query.sector }),
      ...(query.stage && { stage: query.stage }),
      ...(query.status && { status: query.status }),
    };

    const orderBy: Prisma.CompanyOrderByWithRelationInput =
      query.sort === 'raised'
        ? { totalRaisedUsd: 'desc' }
        : query.sort === 'valuation'
          ? { lastValuationUsd: { sort: 'desc', nulls: 'last' } }
          : { name: 'asc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: rows.map((row) => toCompany(row)), total, page, pageSize };
  }

  /** Every approved company's slug + last update, for the web sitemap. */
  async listSlugs(): Promise<CompanySlugEntry[]> {
    const rows = await this.prisma.company.findMany({
      where: PUBLIC_COMPANY,
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  /**
   * Full company profile, gated by contribution. A viewer who hasn't contributed
   * within the rolling window (and isn't an admin) sees only the first
   * PREVIEW_LIMIT rows of each detail section; `access` reports the full counts.
   */
  async getCompanyDetail(
    slug: string,
    viewer?: { id: string; role: Role },
  ): Promise<CompanyDetailResponse> {
    const row = await this.prisma.company.findFirst({
      where: { slug, ...PUBLIC_COMPANY },
      include: approvedChildren,
    });
    // Returns `never` — either a 301 to the survivor, or a 404.
    if (!row) return this.redirectOrNotFound(slug);
    const company = toCompany(row);

    const totals = {
      rounds: company.rounds?.length ?? 0,
      people: company.people?.length ?? 0,
      investors: company.investors?.length ?? 0,
      acquisitions: company.acquisitions?.length ?? 0,
      exits: company.exits?.length ?? 0,
      diversity: company.diversity?.length ?? 0,
    };

    const isAdmin = viewer?.role === 'ADMIN';
    const last = viewer && !isAdmin ? await this.users.lastContributionAt(viewer.id) : null;
    const unlocked = isAdmin || (last !== null && Date.now() - last.getTime() < WINDOW_MS);
    const unlockedUntil = last ? new Date(last.getTime() + WINDOW_MS).toISOString() : null;

    if (!unlocked) {
      if (company.rounds) company.rounds = company.rounds.slice(0, PREVIEW_LIMIT);
      if (company.people) company.people = company.people.slice(0, PREVIEW_LIMIT);
      if (company.investors) company.investors = company.investors.slice(0, PREVIEW_LIMIT);
      if (company.acquisitions) company.acquisitions = company.acquisitions.slice(0, PREVIEW_LIMIT);
      if (company.exits) company.exits = company.exits.slice(0, PREVIEW_LIMIT);
      if (company.diversity) company.diversity = company.diversity.slice(0, PREVIEW_LIMIT);
    }

    // Loaded *after* truncation, so a locked viewer never receives a citation
    // for a row they can't see.
    const citations = await this.loadCitations(row.id, company);
    company.identifiers = await this.loadIdentifiers(row.id);

    return {
      company,
      access: { unlocked, previewLimit: PREVIEW_LIMIT, unlockedUntil, totals },
      citations,
    };
  }

  /**
   * A slug that no live company answers to: either a tombstone, or nothing.
   *
   * Always throws. A merged-away row keeps its slug, so following `mergedIntoId`
   * turns the old address into a permanent redirect instead of a 404 — which is
   * the point of tombstoning rather than deleting.
   *
   * The response is **301 with the survivor's slug in the body and deliberately
   * no `Location` header**. With one, the web app's server-side `fetch` would
   * follow the redirect itself and quietly render the survivor's profile under
   * the old URL — the opposite of what a permanent redirect is for. The browser
   * has to see the move, so the web layer re-issues it.
   */
  private async redirectOrNotFound(slug: string): Promise<never> {
    const survivor = await this.resolveMerged(slug);
    if (survivor) {
      throw new HttpException(
        { message: `Company "${slug}" was merged`, redirectTo: survivor, statusCode: 301 },
        HttpStatus.MOVED_PERMANENTLY,
      );
    }
    throw new NotFoundException(`Company "${slug}" not found`);
  }

  /** Follow a chain of merges to the live row at the end of it, or null.
   *  Capped: a survivor can itself be merged later, and a cycle must not hang
   *  the request. */
  private async resolveMerged(slug: string): Promise<string | null> {
    let row = await this.prisma.company.findUnique({
      where: { slug },
      select: { slug: true, mergedIntoId: true, moderationStatus: true },
    });
    if (!row?.mergedIntoId) return null;

    let next: string | null = row.mergedIntoId;
    for (let hop = 0; hop < MAX_MERGE_HOPS && next; hop++) {
      row = await this.prisma.company.findUnique({
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

  /** The company's external identifiers, for the crosswalk block on the
   *  profile. One indexed query on (entityType, entityId); detail reads only,
   *  so no page-sized fan-out on the directory. */
  private async loadIdentifiers(companyId: string): Promise<EntityIdentifierRef[]> {
    const rows = await this.prisma.entityIdentifier.findMany({
      where: { entityType: 'company', entityId: companyId },
    });
    return toEntityIdentifiers(rows);
  }

  /** Every citation attaching to the company row or any child row in the
   *  response, in one query over a bounded id list (indexed by entityId). */
  private async loadCitations(companyId: string, company: Company): Promise<Citation[]> {
    const ids = [
      companyId,
      ...(company.rounds ?? []).map((r) => r.id),
      ...(company.people ?? []).map((p) => p.id),
      ...(company.investors ?? []).map((i) => i.id),
      ...(company.acquisitions ?? []).map((a) => a.id),
      ...(company.exits ?? []).map((e) => e.id),
      ...(company.diversity ?? []).map((d) => d.id),
    ];

    const rows = await this.prisma.citation.findMany({
      where: { entityId: { in: ids } },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCitation);
  }

  /**
   * Attach a contributor's source URL to the row they just submitted.
   *
   * Created at submission, against a still-PENDING row — which is what avoids
   * adding a `sourceUrl` column to seven tables. The read path only ever loads
   * citations for rows it is already returning (all APPROVED), so a citation
   * left behind on a rejected row is inert.
   *
   * `field: ''` because a contributed row is attested as a whole; per-field
   * citations come from edit proposals, which change named columns.
   */
  private async attachCitation(
    entityType: CitableType,
    entityId: string,
    sourceUrl: string | null | undefined,
    userId: string,
  ): Promise<void> {
    if (!sourceUrl) return;

    const source = await this.prisma.source.upsert({
      where: { url: sourceUrl },
      // A contributor's link is unclassified: we have not fetched it, so
      // `retrievedAt` is the submission time and the type is 'Other'.
      create: { url: sourceUrl, sourceType: 'Other', retrievedAt: new Date() },
      update: {},
      select: { id: true },
    });

    await this.prisma.citation.upsert({
      where: {
        sourceId_entityType_entityId_field: {
          sourceId: source.id,
          entityType,
          entityId,
          field: '',
        },
      },
      create: { sourceId: source.id, entityType, entityId, field: '', submittedById: userId },
      update: {},
    });
  }

  /**
   * The company's public change timeline: every recorded change to the company
   * row and its children, newest first.
   *
   * Deliberately public and ungated — an open-data project's audit trail is
   * worth more open than it is as a contribution incentive. It reports display
   * names only; the submitter emails the admin queue shows never appear here.
   */
  async getCompanyHistory(
    slug: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<CompanyHistoryResponse> {
    const company = await this.prisma.company.findFirst({
      where: { slug, ...PUBLIC_COMPANY },
      select: { id: true },
    });
    if (!company) return this.redirectOrNotFound(slug);

    const where = { companyId: company.id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.revision.count({ where }),
      this.prisma.revision.findMany({
        where,
        include: { actorUser: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const labels = await this.resolveEntityLabels(rows);
    const items: Revision[] = rows.map((row) => ({
      id: row.id,
      entityType: row.entityType as CitableType,
      entityId: row.entityId,
      entityLabel: labels.get(row.entityId) ?? row.entityType,
      field: row.field,
      before: row.before,
      after: row.after,
      action: row.action as RevisionAction,
      actor: row.actor as RevisionActor,
      // Never the email — this endpoint is public.
      actorName: row.actor === 'INGEST' ? row.actorSource : (row.actorUser?.name ?? null),
      createdAt: row.createdAt.toISOString(),
    }));

    return { total, page, pageSize, items };
  }

  /** Human-readable subject per revision, so the timeline says "Series B round"
   *  rather than a cuid. One batched query per entity type on the page. */
  private async resolveEntityLabels(
    rows: { entityType: string; entityId: string }[],
  ): Promise<Map<string, string>> {
    const idsByType = new Map<string, string[]>();
    for (const row of rows) {
      const ids = idsByType.get(row.entityType) ?? [];
      ids.push(row.entityId);
      idsByType.set(row.entityType, ids);
    }

    const labels = new Map<string, string>();
    await Promise.all(
      [...idsByType].map(async ([type, ids]) => {
        for (const [id, label] of await this.labelsForType(type, ids)) labels.set(id, label);
      }),
    );
    return labels;
  }

  private async labelsForType(type: string, ids: string[]): Promise<[string, string][]> {
    const where = { id: { in: ids } };
    switch (type) {
      case 'company': {
        const rows = await this.prisma.company.findMany({ where, select: { id: true, name: true } });
        return rows.map((r) => [r.id, r.name]);
      }
      case 'round': {
        const rows = await this.prisma.fundingRound.findMany({
          where,
          select: { id: true, name: true },
        });
        return rows.map((r) => [r.id, `${r.name} round`]);
      }
      case 'person': {
        const rows = await this.prisma.person.findMany({ where, select: { id: true, name: true } });
        return rows.map((r) => [r.id, r.name]);
      }
      case 'investor': {
        const rows = await this.prisma.investorHolding.findMany({
          where,
          select: { id: true, name: true },
        });
        return rows.map((r) => [r.id, r.name]);
      }
      case 'acquisition': {
        const rows = await this.prisma.acquisitionDeal.findMany({
          where,
          select: { id: true, target: true },
        });
        return rows.map((r) => [r.id, `Acquired ${r.target}`]);
      }
      case 'exit': {
        const rows = await this.prisma.exitEvent.findMany({
          where,
          select: { id: true, type: true },
        });
        return rows.map((r) => [r.id, `${r.type} exit`]);
      }
      case 'diversity': {
        const rows = await this.prisma.diversitySignal.findMany({
          where,
          select: { id: true, label: true },
        });
        return rows.map((r) => [r.id, r.label]);
      }
      default:
        return [];
    }
  }

  async createCompany(dto: CreateCompanyDto, userId: string) {
    const slug = await this.uniqueSlug(dto.name);
    const created = await this.prisma.company.create({
      data: {
        slug,
        name: dto.name,
        domain: dto.domain,
        oneLiner: dto.oneLiner,
        description: dto.description,
        hq: dto.hq,
        founded: dto.founded,
        headcount: dto.headcount,
        industry: dto.industry,
        status: dto.status,
        stage: dto.stage,
        totalRaisedUsd: BigInt(dto.totalRaisedUsd),
        lastValuationUsd: money(dto.lastValuationUsd),
        revenueUsd: money(dto.financials?.revenueUsd),
        revenueGrowthPct: dto.financials?.revenueGrowthPct ?? null,
        grossMarginPct: dto.financials?.grossMarginPct ?? null,
        burnMonths: dto.financials?.burnMonths ?? null,
        websiteUrl: dto.websiteUrl ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        twitterUrl: dto.twitterUrl ?? null,
        legalName: dto.legalName ?? null,
        operatingStatus: dto.operatingStatus ?? null,
        companyType: dto.companyType ?? null,
        primarySector: dto.primarySector ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('company', created.id, dto.sourceUrl, userId);
    return { id: created.id, slug: created.slug, moderationStatus: created.moderationStatus };
  }

  async addRound(slug: string, dto: CreateFundingRoundDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.fundingRound.create({
      data: {
        companyId: company.id,
        name: dto.name,
        date: new Date(dto.date),
        amountUsd: BigInt(dto.amountUsd),
        postMoneyUsd: money(dto.postMoneyUsd),
        lead: dto.lead ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
        investors: { create: dto.investors.map((i) => ({ name: i.name, lead: i.lead })) },
      },
    });
    await this.attachCitation('round', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addPerson(slug: string, dto: CreatePersonDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.person.create({
      data: {
        companyId: company.id,
        name: dto.name,
        role: dto.role,
        since: dto.since,
        prior: dto.prior ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        title: dto.title ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('person', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addInvestor(slug: string, dto: CreateInvestorDto, userId: string) {
    const company = await this.requireCompany(slug);
    const investorId = await this.resolveInvestor(dto, userId);
    const created = await this.prisma.investorHolding.create({
      data: {
        companyId: company.id,
        investorId,
        name: dto.name,
        type: dto.type,
        firstRound: dto.firstRound,
        rounds: dto.rounds,
        websiteUrl: dto.websiteUrl ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('investor', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  /**
   * Find the contributed investor by name, or mint a PENDING firm for it, so
   * every holding links to a first-class Investor. Matching is case-insensitive
   * on the exact name — deliberately narrower than the ingest jobs' normalizer,
   * since a contributor's typo should not silently attach to another firm.
   */
  private async resolveInvestor(dto: CreateInvestorDto, userId: string): Promise<string> {
    const existing = await this.prisma.investor.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;

    const slug = await this.uniqueInvestorSlug(dto.name);
    const created = await this.prisma.investor.create({
      data: {
        slug,
        name: dto.name,
        type: dto.type,
        websiteUrl: dto.websiteUrl ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
      select: { id: true },
    });
    return created.id;
  }

  async addAcquisition(slug: string, dto: CreateAcquisitionDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.acquisitionDeal.create({
      data: {
        companyId: company.id,
        target: dto.target,
        date: new Date(dto.date),
        amountUsd: money(dto.amountUsd),
        rationale: dto.rationale,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('acquisition', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addExit(slug: string, dto: CreateExitDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.exitEvent.create({
      data: {
        companyId: company.id,
        type: dto.type,
        date: new Date(dto.date),
        valueUsd: money(dto.valueUsd),
        detail: dto.detail,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('exit', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addDiversity(slug: string, dto: CreateDiversityDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.diversitySignal.create({
      data: {
        companyId: company.id,
        label: dto.label,
        value: dto.value,
        note: dto.note,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    await this.attachCitation('diversity', created.id, dto.sourceUrl, userId);
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  /** Store a field-level edit proposal (PENDING). Keys equal to the company's
      current values are stripped server-side; an empty diff is rejected. */
  async proposeChange(slug: string, dto: CreateChangeProposalDto, userId: string) {
    const company = await this.requireCompany(slug);
    const current = toCompanyEditFields(company);

    const cleaned: CompanyEditFields = {};
    for (const key of Object.keys(dto.changes) as (keyof CompanyEditFields)[]) {
      const value = dto.changes[key];
      if (value === undefined) continue;
      if (sameValue(value, current[key])) continue;
      (cleaned as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(cleaned).length === 0) {
      throw new BadRequestException('No changes proposed');
    }

    const created = await this.prisma.changeProposal.create({
      data: {
        companyId: company.id,
        changes: cleaned as Prisma.InputJsonValue,
        note: dto.note ?? null,
        // Held on the proposal, not minted yet: applyProposal turns it into one
        // citation per changed field once the edit is actually published.
        sourceUrl: dto.sourceUrl ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  private async requireCompany(slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) throw new NotFoundException(`Company "${slug}" not found`);
    return company;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugBase(name, 'company');
    let slug = base;
    let n = 1;
    while (await this.prisma.company.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }

  private async uniqueInvestorSlug(name: string): Promise<string> {
    const base = slugBase(name, 'investor');
    let slug = base;
    let n = 1;
    while (await this.prisma.investor.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }
}

function slugBase(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}
