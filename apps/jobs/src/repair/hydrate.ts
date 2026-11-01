/**
 * Everything the repair knows about one group of companies, read the same way
 * in the read-only audit and inside an apply/rollback transaction — so the
 * plan's `observedHash` and the transaction's re-read are comparable byte for
 * byte. Sorted, explicit selections; money as text; prose only as a digest.
 */
import { canonicalJson, sha256 } from '../ingest/company-matcher';
import type { Q } from './db';

export interface CompanyEv {
  id: string;
  slug: string;
  name: string;
  domain: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  legalName: string | null;
  operatingStatus: string | null;
  companyType: string | null;
  primarySector: string | null;
  countryCode: string | null;
  hq: string;
  founded: number;
  headcount: number;
  industry: string[];
  status: string;
  stage: string;
  totalRaisedUsd: string;
  partnerFields: string[];
  partnerOnly: boolean;
  externalSource: string | null;
  externalId: string | null;
  mergedIntoId: string | null;
  moderationStatus: string;
  proseDigest: string;
}

export interface RoundEv {
  id: string;
  companyId: string;
  externalSource: string | null;
  externalId: string | null;
  amountUsd: string;
  kind: string;
  moderationStatus: string;
  roundInvestors: number;
}

export interface HoldingEv {
  id: string;
  companyId: string;
  externalSource: string | null;
  externalId: string | null;
  investorId: string | null;
  moderationStatus: string;
}

export interface IdentifierEv {
  id: string;
  entityId: string;
  scheme: string;
  value: string;
  source: string;
}

export interface RevisionEv {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  field: string;
  action: string;
  actor: string;
  actorSource: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface Evidence {
  companies: CompanyEv[];
  rounds: RoundEv[];
  holdings: HoldingEv[];
  identifiers: IdentifierEv[];
  revisions: RevisionEv[];
  /** People roles, acquisitions, exits, diversity signals: who wrote them. */
  otherChildren: { table: string; id: string; companyId: string; externalSource: string | null; moderationStatus: string }[];
  proposals: { id: string; companyId: string; status: string }[];
  saved: { companyId: string; n: number }[];
  reports: { entityId: string; n: number }[];
  companyCitations: { entityId: string; n: number }[];
  scans: { id: string; companyId: string; targetDomain: string }[];
  apps: { id: string; companyId: string; targetUrl: string }[];
  merges: { id: string; survivorId: string; losingId: string; unmerged: boolean }[];
  bindings: { source: string; sourceCompanyId: string; companyId: string | null; status: string; method: string; evidenceHash: string }[];
  /** Slugs the plan intends to create, and whether each is already taken. */
  slugsTaken: { slug: string; taken: boolean }[];
  /** Ids the plan intends to create, and whether each already exists. */
  idsTaken: { id: string; taken: boolean }[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function hydrate(
  q: Q,
  companyIds: string[],
  opts: { sourceIds?: string[]; slugs?: string[]; createIds?: string[]; bindingsTable?: boolean } = {},
): Promise<Evidence> {
  const ids = [...new Set(companyIds)].sort();
  const sids = [...new Set(opts.sourceIds ?? [])].sort();
  const rows = <T>(sql: string, params: unknown[]) => q.query<T>(sql, params).then((r) => r.rows);

  const companies = await rows<CompanyEv>(
    `SELECT id, slug, name, domain, "websiteUrl", "linkedinUrl", "legalName", "operatingStatus", "companyType",
            "primarySector", "countryCode", hq, founded, headcount, industry, status, stage,
            "totalRaisedUsd"::text AS "totalRaisedUsd", "partnerFields", "partnerOnly", "externalSource", "externalId",
            "mergedIntoId", "moderationStatus"::text AS "moderationStatus",
            md5(coalesce("oneLiner", '') || E'\\x1f' || coalesce(description, '')) AS "proseDigest"
       FROM "Company" WHERE id = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const rounds = await rows<RoundEv>(
    `SELECT r.id, r."companyId", r."externalSource", r."externalId", r."amountUsd"::text AS "amountUsd", r.kind,
            r."moderationStatus"::text AS "moderationStatus",
            (SELECT count(*)::int FROM "RoundInvestor" ri WHERE ri."roundId" = r.id) AS "roundInvestors"
       FROM "FundingRound" r WHERE r."companyId" = ANY($1::text[]) ORDER BY r.id`,
    [ids],
  );
  const holdings = await rows<HoldingEv>(
    `SELECT id, "companyId", "externalSource", "externalId", "investorId", "moderationStatus"::text AS "moderationStatus"
       FROM "InvestorHolding" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const identifiers = await rows<IdentifierEv>(
    `SELECT id, "entityId", scheme, value, source FROM "EntityIdentifier"
      WHERE "entityType" = 'company' AND ("entityId" = ANY($1::text[]) OR (scheme = 'PARTNER' AND value = ANY($2::text[])))
      ORDER BY id`,
    [ids, sids],
  );
  const revisions = (
    await rows<Omit<RevisionEv, 'createdAt'> & { createdAt: Date }>(
      `SELECT id, "companyId", "entityType", "entityId", field, action, actor, "actorSource", before, after, "createdAt"
         FROM "Revision" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
      [ids],
    )
  ).map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  const otherChildren: Evidence['otherChildren'] = [];
  for (const table of ['PersonRole', 'AcquisitionDeal', 'ExitEvent', 'DiversitySignal'] as const) {
    const hasSource = table !== 'DiversitySignal';
    for (const r of await rows<{ id: string; companyId: string; externalSource: string | null; moderationStatus: string }>(
      `SELECT id, "companyId", ${hasSource ? '"externalSource"' : 'NULL::text AS "externalSource"'},
              "moderationStatus"::text AS "moderationStatus"
         FROM "${table}" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
      [ids],
    )) {
      otherChildren.push({ table, ...r });
    }
  }
  const proposals = await rows<{ id: string; companyId: string; status: string }>(
    `SELECT id, "companyId", "moderationStatus"::text AS status FROM "ChangeProposal" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const saved = await rows<{ companyId: string; n: number }>(
    `SELECT "companyId", count(*)::int AS n FROM "SavedCompany" WHERE "companyId" = ANY($1::text[]) GROUP BY 1 ORDER BY 1`,
    [ids],
  );
  const reports = await rows<{ entityId: string; n: number }>(
    `SELECT "entityId", count(*)::int AS n FROM "Report" WHERE "entityType" = 'company' AND "entityId" = ANY($1::text[]) GROUP BY 1 ORDER BY 1`,
    [ids],
  );
  const companyCitations = await rows<{ entityId: string; n: number }>(
    `SELECT "entityId", count(*)::int AS n FROM "Citation" WHERE "entityType" = 'company' AND "entityId" = ANY($1::text[]) GROUP BY 1 ORDER BY 1`,
    [ids],
  );
  const scans = await rows<{ id: string; companyId: string; targetDomain: string }>(
    `SELECT id, "companyId", "targetDomain" FROM "CompanyWebsiteScan" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const apps = await rows<{ id: string; companyId: string; targetUrl: string }>(
    `SELECT id, "companyId", "targetUrl" FROM "CompanyApp" WHERE "companyId" = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const merges = await rows<{ id: string; survivorId: string; losingId: string; unmerged: boolean }>(
    `SELECT id, "survivorId", "losingId", "unmergedAt" IS NOT NULL AS unmerged FROM "MergeRecord"
      WHERE "entityType" = 'company' AND ("survivorId" = ANY($1::text[]) OR "losingId" = ANY($1::text[])) ORDER BY id`,
    [ids],
  );
  const bindings =
    opts.bindingsTable === false
      ? []
      : await rows<Evidence['bindings'][number]>(
          `SELECT source, "sourceCompanyId", "companyId", status, method, "evidenceHash" FROM "CompanyIngestBinding"
            WHERE "companyId" = ANY($1::text[]) OR (source = 'PARTNER' AND "sourceCompanyId" = ANY($2::text[]))
            ORDER BY source, "sourceCompanyId"`,
          [ids, sids],
        );
  const slugs = [...new Set(opts.slugs ?? [])].sort();
  const taken = new Set(
    (await rows<{ slug: string }>(`SELECT slug FROM "Company" WHERE slug = ANY($1::text[])`, [slugs])).map((r) => r.slug),
  );
  const createIds = [...new Set(opts.createIds ?? [])].sort();
  const existing = new Set(
    (await rows<{ id: string }>(`SELECT id FROM "Company" WHERE id = ANY($1::text[])`, [createIds])).map((r) => r.id),
  );

  return {
    companies: companies.sort(byId),
    rounds,
    holdings,
    identifiers,
    revisions,
    otherChildren,
    proposals,
    saved,
    reports,
    companyCitations,
    scans,
    apps,
    merges,
    bindings,
    slugsTaken: slugs.map((slug) => ({ slug, taken: taken.has(slug) })),
    idsTaken: createIds.map((id) => ({ id, taken: existing.has(id) })),
  };
}

export function evidenceHash(e: Evidence): string {
  return sha256(canonicalJson(e));
}
