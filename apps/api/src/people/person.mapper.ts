import type { PersonRole, PersonSummary, RoleKind } from '@repo/api';
import type { Person as DbPerson, PersonRole as DbPersonRole } from '@repo/db';

/** A role with whichever organisation it hangs off included. Exactly one of the
 *  two is ever set — a role belongs to a company or to a firm, never both. */
export type RoleWithOrg = DbPersonRole & {
  company?: { slug: string; name: string; domain: string } | null;
  investor?: { slug: string; name: string } | null;
};

/** The row shape both the list and the detail read produce. */
export type PersonWithRoles = DbPerson & {
  roles: RoleWithOrg[];
  _count: { roles: number };
};

export function toPersonRole(row: RoleWithOrg): PersonRole {
  return {
    id: row.id,
    role: row.role,
    kind: (row.kind as RoleKind | null) ?? null,
    title: row.title,
    since: row.since,
    endYear: row.endYear,
    prior: row.prior,
    linkedinUrl: row.linkedinUrl,
    company: row.company
      ? { slug: row.company.slug, name: row.company.name, domain: row.company.domain || null }
      : null,
    investor: row.investor ? { slug: row.investor.slug, name: row.investor.name } : null,
  };
}

/**
 * A person plus the facts a directory row needs.
 *
 * `roleCount` comes from the filtered relation count, not from `roles.length` —
 * the list read only loads a sample, the same way an investor card does.
 * `companyCount` is computed from that sample and is therefore a lower bound on
 * a list read; the detail read loads every role, so there it is exact.
 */
export function toPersonSummary(row: PersonWithRoles): PersonSummary {
  const roles = row.roles.map(toPersonRole);
  const companies = new Set(roles.map((r) => r.company?.slug).filter(Boolean));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    roleCount: row._count.roles,
    companyCount: companies.size,
    roles,
  };
}
