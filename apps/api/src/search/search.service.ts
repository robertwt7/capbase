import { Injectable } from '@nestjs/common';
import {
  SEARCH_GROUP_LIMIT,
  SEARCH_MIN_CHARS,
  partnerVisible,
  type GatedEntity,
  type GatePolicy,
  type Role,
  type SearchHit,
  type SearchResponse,
  type ViewerAccess,
} from '@repo/api';
import { Prisma } from '@repo/db';

import { gateFields, listAccessFor, publicRowsWhere } from '../gate/gate';
import { GatePolicyService } from '../gate/gate-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_ROLES } from '../prisma/public-filters';
import { UsersService } from '../users/users.service';

/** Backslash-escape LIKE's wildcards, so `100%` or `a_b` match literally.
 *  Backslash is Postgres's default LIKE escape character, so it goes first. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type PersonRow = SearchHit & { id: string };
/** An organisation hit as read: the shown columns plus whose values they are. */
type OrgRow = { slug: string; name: string; domain: string | null; meta: string | null; partnerFields: string[] };

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly gatePolicy: GatePolicyService,
  ) {}

  /**
   * The header typeahead: the top few companies, investors and people whose
   * NAME matches, ranked exact → prefix → word-start → substring.
   *
   * Name only, never `oneLiner`: a dropdown row has to show why it matched, and
   * a description hit can't. No counts either — counting is the expensive part
   * of every directory query and a typeahead doesn't need one. Each group is a
   * `LIMIT` over the trigram index (a 2-character query can't use it and
   * seq-scans, which measured ~30ms).
   *
   * Raw SQL because Prisma can't order by a CASE, so each query restates its
   * public filter from `prisma/public-filters.ts` inline — keep them in step.
   *
   * Signed out, the partner's entities are not found at all (partner-only
   * companies and firms, its identifier-only people). The logo domain and the
   * meta line (sector, firm type) follow the field policy, as in the
   * directories — applied in TS over each hit's `partnerFields`.
   */
  async search(raw: string, viewer?: { id: string; role: Role }): Promise<SearchResponse> {
    const q = raw.trim();
    if (q.length < SEARCH_MIN_CHARS)
      return { companies: [], investors: [], people: [] };
    const policy = this.gatePolicy.current();
    const access = await listAccessFor(viewer, policy, ['company', 'investor', 'person'], (v) =>
      this.users.accessFor(v),
    );
    const signedOut = !partnerVisible(access);
    const notPartnerOnly = signedOut ? Prisma.sql`AND NOT "partnerOnly"` : Prisma.empty;

    const esc = escapeLike(q.toLowerCase());
    const exact = q.toLowerCase();
    const contains = `%${esc}%`;
    const prefix = `${esc}%`;
    const wordStart = `% ${esc}%`;

    const [companies, investors, people] = await Promise.all([
      // PUBLIC_COMPANY
      this.prisma.$queryRaw<OrgRow[]>`
        SELECT slug, name, NULLIF(domain, '') AS domain, "primarySector" AS meta, "partnerFields"
          FROM "Company"
         WHERE "moderationStatus" = 'APPROVED'
           AND "mergedIntoId" IS NULL
           ${notPartnerOnly}
           AND name ILIKE ${contains}
         ORDER BY CASE WHEN lower(name) = ${exact} THEN 0
                       WHEN lower(name) LIKE ${prefix} THEN 1
                       WHEN lower(name) LIKE ${wordStart} THEN 2
                       ELSE 3 END,
                  "totalRaisedUsd" DESC, length(name), name
         LIMIT ${SEARCH_GROUP_LIMIT}
      `,
      // PUBLIC_INVESTOR
      this.prisma.$queryRaw<OrgRow[]>`
        SELECT slug, name, NULLIF(domain, '') AS domain, type AS meta, "partnerFields"
          FROM "Investor"
         WHERE "moderationStatus" = 'APPROVED'
           AND "mergedIntoId" IS NULL
           ${notPartnerOnly}
           AND name ILIKE ${contains}
         ORDER BY CASE WHEN lower(name) = ${exact} THEN 0
                       WHEN lower(name) LIKE ${prefix} THEN 1
                       WHEN lower(name) LIKE ${wordStart} THEN 2
                       ELSE 3 END,
                  "assetsUsd" DESC NULLS LAST, length(name), name
         LIMIT ${SEARCH_GROUP_LIMIT}
      `,
      // PUBLIC_PERSON
      this.prisma.$queryRaw<PersonRow[]>`
        SELECT id, slug, name, NULL AS domain, NULL AS meta
          FROM "Person"
         WHERE "moderationStatus" = 'APPROVED'
           AND "mergedIntoId" IS NULL
           AND "suppressedAt" IS NULL
           ${signedOut ? Prisma.sql`AND NOT "identifierOnly"` : Prisma.empty}
           AND name ILIKE ${contains}
         ORDER BY CASE WHEN lower(name) = ${exact} THEN 0
                       WHEN lower(name) LIKE ${prefix} THEN 1
                       WHEN lower(name) LIKE ${wordStart} THEN 2
                       ELSE 3 END,
                  length(name), name
         LIMIT ${SEARCH_GROUP_LIMIT}
      `,
    ]);

    const orgs = await this.latestOrganisations(people.map((p) => p.id), {
      AND: [publicRowsWhere(access, policy, 'personRoles')],
    });
    return {
      companies: companies.map((row) => toHit(gateHit('company', 'primarySector', row, access, policy))),
      investors: investors.map((row) => toHit(gateHit('investor', 'type', row, access, policy))),
      people: people.map(({ id, ...hit }) =>
        toHit({ ...hit, meta: orgs.get(id) ?? null }),
      ),
    };
  }

  /** The organisation of each person's most recent public role — what tells
   *  two people of the same name apart. One query, bounded by the group limit. */
  private async latestOrganisations(
    personIds: string[],
    visible: Prisma.PersonRoleWhereInput,
  ): Promise<Map<string, string>> {
    const orgs = new Map<string, string>();
    if (personIds.length === 0) return orgs;
    const roles = await this.prisma.personRole.findMany({
      where: { personId: { in: personIds }, ...PUBLIC_ROLES, ...visible },
      orderBy: { since: 'desc' },
      select: {
        personId: true,
        company: { select: { name: true } },
        investor: { select: { name: true } },
      },
    });
    for (const r of roles) {
      const org = r.company?.name ?? r.investor?.name;
      if (r.personId && org && !orgs.has(r.personId)) orgs.set(r.personId, org);
    }
    return orgs;
  }
}

/** A hit's domain and meta through the field policy (`meta` is the entity's
 *  `metaField`); a withheld value becomes null. */
function gateHit(
  kind: GatedEntity,
  metaField: string,
  row: OrgRow,
  access: ViewerAccess,
  policy: GatePolicy,
): SearchHit {
  const gated = gateFields(
    kind,
    { domain: row.domain, [metaField]: row.meta } as Record<string, unknown> & { masked?: string[] },
    row.partnerFields,
    access,
    policy,
  );
  return {
    slug: row.slug,
    name: row.name,
    domain: gated.masked?.includes('domain') ? null : row.domain,
    meta: gated.masked?.includes(metaField) ? null : row.meta,
  };
}

function toHit(row: SearchHit): SearchHit {
  return {
    slug: row.slug,
    name: row.name,
    domain: row.domain || null,
    meta: row.meta || null,
  };
}
