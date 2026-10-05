import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  PERSON_INDEX_MIN_ROLES,
  type Citation,
  type EntityIdentifierRef,
  type Paginated,
  type PersonDetailResponse,
  type PersonListQuery,
  type PersonSlugEntry,
  type PersonSummary,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { MAX_MERGE_HOPS, PUBLIC_COMPANY_RELATION, PUBLIC_PERSON } from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { toEntityIdentifiers } from '../provenance/identifier.mapper';
import { toPersonSummary, type PersonWithRoles } from './person.mapper';

/** How many roles to include on each person's directory card. */
const ROLE_SAMPLE = 6;

/**
 * Roles that count towards a public profile: approved, and — when the role
 * hangs off a company — on a company the public can see. A firm-officer role
 * has no company, so the OR is what keeps it visible.
 *
 * `listSlugs` restates this in raw SQL (Prisma objects can't be reused there) —
 * change one, change both.
 */
const PUBLIC_ROLES = {
  moderationStatus: 'APPROVED',
  OR: [{ company: PUBLIC_COMPANY_RELATION }, { companyId: null }],
} satisfies Prisma.PersonRoleWhereInput;

const ROLE_INCLUDE = {
  company: { select: { slug: true, name: true, domain: true } },
  investor: { select: { slug: true, name: true } },
};

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of people, read straight from the Person table.
   *
   * There is no role filter. The corpus holds thousands of distinct free-text
   * role strings — Form C signature blocks are prose — and offering them as a
   * vocabulary would be a lie about the data. Search, the multi-company flag
   * and the sort are what the data actually supports.
   */
  async findAll(query: PersonListQuery = {}): Promise<Paginated<PersonSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.PersonWhereInput = {
      ...PUBLIC_PERSON,
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.multiCompany && { id: { in: await this.multiCompanyIds() } }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.person.count({ where }),
      this.prisma.person.findMany({
        where,
        orderBy:
          query.sort === 'name'
            ? [{ name: 'asc' }]
            : [{ roles: { _count: 'desc' } }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          roles: {
            where: PUBLIC_ROLES,
            take: ROLE_SAMPLE,
            orderBy: { since: 'desc' },
            include: ROLE_INCLUDE,
          },
          _count: { select: { roles: { where: PUBLIC_ROLES } } },
        },
      }),
    ]);

    const companyCounts = await this.countCompanies(rows.map((r) => r.id));
    const items = rows.map((r) => ({
      ...toPersonSummary(r as unknown as PersonWithRoles),
      companyCount: companyCounts.get(r.id) ?? 0,
    }));

    return { items, total, page, pageSize };
  }

  /**
   * Ids of everyone holding roles at MORE THAN ONE public company.
   *
   * Raw SQL because no Prisma relation filter can express "count(distinct
   * companyId) > 1". A `roles: { some: … }` filter can only ask "has a company
   * role", which nearly everyone satisfies — it reported 75,926 people where
   * the true answer is 4,393, and post-filtering the page fixed the rows while
   * leaving `total` a lie and paging through mostly-empty pages.
   *
   * The id set is the whole qualifying population, not one page. That is the
   * cost of an exact count here; it is a few thousand cuids today and grows
   * with serial founders rather than with the corpus, so it stays small
   * relative to the 76k people it filters.
   */
  private async multiCompanyIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ personId: string }[]>`
      SELECT r."personId"
        FROM "PersonRole" r
        JOIN "Company" c
          ON c.id = r."companyId"
         AND c."moderationStatus" = 'APPROVED'
         AND c."mergedIntoId" IS NULL
       WHERE r."moderationStatus" = 'APPROVED'
         AND r."personId" IS NOT NULL
       GROUP BY r."personId"
      HAVING count(DISTINCT r."companyId") > 1
    `;
    return rows.map((r) => r.personId);
  }

  /**
   * Distinct public companies per person, for the page being returned.
   *
   * One extra query rather than counting the role SAMPLE: a person at 75
   * companies would otherwise show 6, because that is how many roles the card
   * loads. A lower bound rendered as a count is a wrong number, not a small one.
   * Bounded by the page, so it stays one query however large the corpus grows.
   */
  private async countCompanies(personIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (personIds.length === 0) return counts;

    const pairs = await this.prisma.personRole.findMany({
      where: { personId: { in: personIds }, companyId: { not: null }, ...PUBLIC_ROLES },
      select: { personId: true, companyId: true },
      distinct: ['personId', 'companyId'],
    });
    for (const p of pairs) {
      if (p.personId) counts.set(p.personId, (counts.get(p.personId) ?? 0) + 1);
    }
    return counts;
  }

  /** Full profile: every public role, not a sample, plus the crosswalk and the
   *  citations attesting those roles. */
  async findOne(slug: string): Promise<PersonDetailResponse> {
    const row = await this.prisma.person.findFirst({
      where: { slug, ...PUBLIC_PERSON },
      include: {
        roles: { where: PUBLIC_ROLES, orderBy: { since: 'desc' }, include: ROLE_INCLUDE },
        _count: { select: { roles: { where: PUBLIC_ROLES } } },
      },
    });
    // Returns `never` — either a 301 to the survivor, or a 404.
    if (!row) return this.redirectOrNotFound(slug);

    const summary = toPersonSummary(row as unknown as PersonWithRoles);
    const identifiers = await this.loadIdentifiers(row.id);
    return {
      ...summary,
      identifiers,
      citations: await this.loadRoleCitations(summary.roles.map((r) => r.id)),
      // The same rule `listSlugs` applies in SQL, so a page is noindex exactly
      // when it is missing from the sitemap.
      indexable:
        row._count.roles >= PERSON_INDEX_MIN_ROLES ||
        identifiers.some((i) => i.scheme === 'WIKIDATA'),
    };
  }

  /**
   * A slug no live person answers to: either a tombstone, or nothing. Always
   * throws.
   *
   * A SUPPRESSED person is a 404, never a 301. A redirect would confirm they
   * exist, which is the opposite of what a removal request asks for — so the
   * chain resolver below never looks at a suppressed row.
   *
   * 301 carries the survivor's slug in the body and deliberately **no**
   * `Location` header — see the identical note on CompaniesService. With one,
   * the web app's server-side fetch would follow it and render the survivor
   * under the old URL instead of moving the browser.
   */
  private async redirectOrNotFound(slug: string): Promise<never> {
    const survivor = await this.resolveMerged(slug);
    if (survivor) {
      throw new HttpException(
        { message: `Person "${slug}" was merged`, redirectTo: survivor, statusCode: 301 },
        HttpStatus.MOVED_PERMANENTLY,
      );
    }
    throw new NotFoundException(`Person "${slug}" not found`);
  }

  /** Follow a chain of merges to the live row at the end of it, or null. Capped
   *  so a cycle cannot hang the request. */
  private async resolveMerged(slug: string): Promise<string | null> {
    let row = await this.prisma.person.findUnique({
      where: { slug },
      select: { slug: true, mergedIntoId: true, moderationStatus: true, suppressedAt: true },
    });
    if (!row?.mergedIntoId) return null;

    let next: string | null = row.mergedIntoId;
    for (let hop = 0; hop < MAX_MERGE_HOPS && next; hop++) {
      row = await this.prisma.person.findUnique({
        where: { id: next },
        select: { slug: true, mergedIntoId: true, moderationStatus: true, suppressedAt: true },
      });
      if (!row) return null;
      if (!row.mergedIntoId) {
        // A chain ending at a suppressed person resolves to nothing: the 404
        // is the answer, not a redirect that confirms they exist.
        return row.moderationStatus === 'APPROVED' && !row.suppressedAt ? row.slug : null;
      }
      next = row.mergedIntoId;
    }
    return null;
  }

  /** The person's external identifiers (a Wikidata QID today) for the crosswalk
   *  block. Detail read only — the directory list stays one query. */
  private async loadIdentifiers(personId: string): Promise<EntityIdentifierRef[]> {
    const rows = await this.prisma.entityIdentifier.findMany({
      where: { entityType: 'person', entityId: personId },
    });
    return toEntityIdentifiers(rows);
  }

  /**
   * Citations attaching to the ROLE rows in the response.
   *
   * `entityType: 'person'` means the role, not the human — the same overloading
   * `'investor'` carries, where a citation means `InvestorHolding` while an
   * identifier means `Investor`.
   */
  private async loadRoleCitations(roleIds: string[]): Promise<Citation[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.prisma.citation.findMany({
      where: { entityType: 'person', entityId: { in: roleIds } },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCitation);
  }

  /**
   * Every INDEXABLE person slug, for the web sitemap: at least
   * PERSON_INDEX_MIN_ROLES public roles, or a Wikidata identifier. ~93% of the
   * corpus is one Form D line under a name; those pages stay public but
   * `noindex`, and join the sitemap on their own once a second role arrives.
   *
   * Raw SQL because no Prisma filter can say "count of a filtered relation >= n".
   * The person conditions restate PUBLIC_PERSON and the role conditions
   * PUBLIC_ROLES — keep all three in step. `findOne` computes `indexable` with
   * the same rule.
   */
  async listSlugs(): Promise<PersonSlugEntry[]> {
    const rows = await this.prisma.$queryRaw<{ slug: string; updatedAt: Date }[]>`
      SELECT p.slug, p."updatedAt"
        FROM "Person" p
       WHERE p."moderationStatus" = 'APPROVED'
         AND p."mergedIntoId" IS NULL
         AND p."suppressedAt" IS NULL
         AND (
           (SELECT count(*)
              FROM "PersonRole" r
              LEFT JOIN "Company" c ON c.id = r."companyId"
             WHERE r."personId" = p.id
               AND r."moderationStatus" = 'APPROVED'
               AND (r."companyId" IS NULL
                    OR (c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL))
           ) >= ${PERSON_INDEX_MIN_ROLES}
           OR EXISTS (
             SELECT 1
               FROM "EntityIdentifier" e
              WHERE e."entityType" = 'person'
                AND e."entityId" = p.id
                AND e.scheme = 'WIKIDATA'
           )
         )
       ORDER BY p."updatedAt" DESC
    `;
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  /**
   * Remove a person from the public surface on request (privacy policy §6), or
   * put them back.
   *
   * A column of its own rather than `moderationStatus: 'REJECTED'`, because
   * ingest auto-APPROVES every row it touches and would flip a rejected person
   * straight back on the next cron run. The ingest match index reads this
   * column and refuses to match or recreate a suppressed human.
   */
  async setSuppressed(id: string, suppressed: boolean): Promise<{ id: string; suppressedAt: string | null }> {
    const row = await this.prisma.person.update({
      where: { id },
      data: { suppressedAt: suppressed ? new Date() : null },
      select: { id: true, suppressedAt: true },
    });
    return { id: row.id, suppressedAt: row.suppressedAt?.toISOString() ?? null };
  }
}
