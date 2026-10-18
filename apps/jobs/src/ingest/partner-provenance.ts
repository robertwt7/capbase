/**
 * Reconstruct partner provenance (`partnerOnly`, `partnerFields`,
 * `RoundInvestor.externalSource`) for data loaded before ingest recorded it.
 *
 * Ingest maintains these marks itself from now on; this pass exists for the
 * rows written earlier. It reads the `partner_stage` schema — the only record
 * of what the partner actually stated — and fails closed wherever the past is
 * ambiguous: a public value that happens to equal the partner's is marked too.
 *
 * Every step is idempotent and monotone (marks are only ever added), so a
 * second run changes nothing.
 */
import type { PrismaService } from '../prisma/prisma.service';
import type { PartnerClient } from '../sources/partner/partner.client';
import { firmType, toFund, toInvestorFirm, type KeptFirm } from '../sources/partner/partner.parser';
import { normalizeFundName } from './ingest.service';

/** The company columns a partner record can state (see `toRecord`). */
export const PARTNER_COMPANY_FIELDS = [
  'hq',
  'industry',
  'stage',
  'totalRaisedUsd',
  'websiteUrl',
  'domain',
  'primarySector',
  'oneLiner',
  'description',
  'countryCode',
  'operatingStatus',
] as const;

/** The firm columns a partner firm can state (see `toInvestorFirm`). `type` is
 *  only ever written on create — an enrichment never touches it. */
export const PARTNER_INVESTOR_FIELDS = [
  'hq',
  'countryCode',
  'websiteUrl',
  'domain',
  'description',
  'foundedYear',
  'assetsUsd',
] as const;

/** The fund columns a partner fund can state (see `toFund`). */
export const PARTNER_FUND_FIELDS = [
  'strategy',
  'status',
  'vintageYear',
  'targetUsd',
  'closedUsd',
  'hardCapUsd',
  'launchDate',
  'latestCloseDate',
  'finalCloseDate',
  'managementFeePct',
  'carriedInterestPct',
  'hurdleRatePct',
  'targetIrrNetMinPct',
  'targetIrrNetMaxPct',
  'targetIrrGrossMinPct',
  'targetIrrGrossMaxPct',
  'regionFocus',
  'hq',
] as const;

/** Identifier schemes that say nothing about who else knows an entity: the
 *  partner's own id, and the domain every source derives. */
const NON_EVIDENCE_SCHEMES = ['PARTNER', 'DOMAIN'];

const PAGE = 2_000;

/**
 * Whether a stored column value is the value the partner stated. BigInt money
 * against the parser's numbers, Date columns against its `YYYY-MM-DD` strings.
 * A null statement never matches: the partner said nothing about the column.
 */
export function sameStated(stored: unknown, stated: unknown): boolean {
  if (stated === null || stated === undefined || stored === null || stored === undefined) return false;
  if (typeof stored === 'bigint') {
    return typeof stated === 'number' ? stored === BigInt(Math.round(stated)) : stored === stated;
  }
  if (stored instanceof Date) {
    return typeof stated === 'string' && stored.toISOString().slice(0, 10) === stated.slice(0, 10);
  }
  return stored === stated;
}

/** The columns of `fields` whose stored value equals the partner's statement. */
export function equalFields(
  row: Record<string, unknown>,
  stated: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  return fields.filter((f) => sameStated(row[f], stated[f]));
}

/** `current` ∪ `add`, or null when that adds nothing (the row is left alone). */
export function mergedMarks(current: readonly string[] | null, add: readonly string[]): string[] | null {
  const have = current ?? [];
  const extra = [...new Set(add)].filter((f) => !have.includes(f));
  return extra.length > 0 ? [...have, ...extra] : null;
}

export interface ProvenanceCounts {
  companiesPartnerOnly: number;
  investorsPartnerOnly: number;
  fundsPartnerOnly: number;
  companyFields: number;
  investorFields: number;
  fundFields: number;
  roundFields: number;
  roundInvestors: number;
}

/** A SQL `ARRAY[...]` literal of a fixed column list (identifiers only — never
 *  user input). */
const sqlText = (values: readonly string[]) => `ARRAY[${values.map((v) => `'${v}'`).join(',')}]::text[]`;

export class PartnerProvenanceBackfill {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PartnerClient,
    private readonly log: (msg: string) => void,
  ) {}

  async run(): Promise<ProvenanceCounts> {
    const counts: ProvenanceCounts = {
      companiesPartnerOnly: await this.partnerOnlyCompanies(),
      investorsPartnerOnly: await this.partnerOnlyInvestors(),
      fundsPartnerOnly: await this.partnerOnlyFunds(),
      companyFields: await this.companyFields(),
      investorFields: 0,
      fundFields: 0,
      roundFields: await this.roundFields(),
      roundInvestors: await this.roundInvestors(),
    };
    const { kept, firmIds, firms } = await this.firms();
    counts.investorFields = await this.investorFields(firms, kept, firmIds);
    counts.fundFields = await this.fundFields(kept, firmIds);
    return counts;
  }

  /**
   * A partner-created company no other source has touched: no identifier in
   * another scheme, no child row from another ingest source, no enrichment
   * revision from one.
   */
  private async partnerOnlyCompanies(): Promise<number> {
    const n = await this.prisma.$executeRawUnsafe(`
      UPDATE "Company" c SET "partnerOnly" = true
       WHERE c."externalSource" = 'PARTNER' AND NOT c."partnerOnly"
         AND NOT EXISTS (SELECT 1 FROM "EntityIdentifier" e WHERE e."entityType" = 'company'
                          AND e."entityId" = c.id AND e.scheme <> ALL(${sqlText(NON_EVIDENCE_SCHEMES)}))
         AND NOT EXISTS (SELECT 1 FROM "FundingRound" x WHERE x."companyId" = c.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "PersonRole" x WHERE x."companyId" = c.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "InvestorHolding" x WHERE x."companyId" = c.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "AcquisitionDeal" x WHERE x."companyId" = c.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "ExitEvent" x WHERE x."companyId" = c.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "Revision" x WHERE x."companyId" = c.id AND x.actor = 'INGEST'
                          AND x."actorSource" IS NOT NULL AND x."actorSource" <> 'PARTNER')`);
    this.log(`Companies: ${n} marked partner-only`);
    return n;
  }

  /** A partner-created firm no other source has touched (identifiers, funds,
   *  holdings or roles from another source). */
  private async partnerOnlyInvestors(): Promise<number> {
    const n = await this.prisma.$executeRawUnsafe(`
      UPDATE "Investor" i SET "partnerOnly" = true
       WHERE i."externalSource" = 'PARTNER' AND NOT i."partnerOnly"
         AND NOT EXISTS (SELECT 1 FROM "EntityIdentifier" e WHERE e."entityType" = 'investor'
                          AND e."entityId" = i.id AND e.scheme <> ALL(${sqlText(NON_EVIDENCE_SCHEMES)}))
         AND NOT EXISTS (SELECT 1 FROM "Fund" x WHERE x."managerId" = i.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "InvestorHolding" x WHERE x."investorId" = i.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')
         AND NOT EXISTS (SELECT 1 FROM "PersonRole" x WHERE x."investorId" = i.id
                          AND x."externalSource" IS NOT NULL AND x."externalSource" <> 'PARTNER')`);
    this.log(`Investors: ${n} marked partner-only`);
    return n;
  }

  /** A partner-created fund no SEC filing has been matched to (the Form D
   *  enrichment fills the fund's CIK; Schedule D its SEC fund id). */
  private async partnerOnlyFunds(): Promise<number> {
    const n = await this.prisma.$executeRawUnsafe(`
      UPDATE "Fund" SET "partnerOnly" = true
       WHERE "externalSource" = 'PARTNER' AND NOT "partnerOnly"
         AND "cikNumber" IS NULL AND "secFundId" IS NULL`);
    this.log(`Funds: ${n} marked partner-only`);
    return n;
  }

  /**
   * Company columns: what a partner-created row states, plus every field the
   * partner wrote on any company (its revisions — enrichment, raised totals),
   * minus any field whose LATEST revision came from someone else (a public
   * source or a moderated edit replaced the partner's value).
   */
  private async companyFields(): Promise<number> {
    const stated = PARTNER_COMPANY_FIELDS.map((f) => {
      const col = `c."${f}"`;
      const has =
        f === 'industry'
          ? `cardinality(${col}) > 0`
          : f === 'totalRaisedUsd'
            ? `${col} > 0`
            : f === 'hq'
              ? `${col} NOT IN ('', 'Undisclosed')`
              : ['domain', 'oneLiner', 'description', 'stage'].includes(f)
                ? `${col} <> ''`
                : `${col} IS NOT NULL`;
      return `CASE WHEN ${has} THEN '${f}' END`;
    }).join(', ');
    const n = await this.prisma.$executeRawUnsafe(`
      WITH partner_rev AS (
        SELECT "companyId", array_agg(DISTINCT field) AS f FROM "Revision"
         WHERE "entityType" = 'company' AND "actorSource" = 'PARTNER' AND field NOT IN ('', 'name')
         GROUP BY 1
      ), latest AS (
        SELECT DISTINCT ON ("companyId", field) "companyId", field, "actorSource"
          FROM "Revision" WHERE "entityType" = 'company' AND field <> ''
         ORDER BY "companyId", field, "createdAt" DESC, id DESC
      ), replaced AS (
        SELECT "companyId", array_agg(field) AS f FROM latest
         WHERE "actorSource" IS DISTINCT FROM 'PARTNER' GROUP BY 1
      ), target AS (
        SELECT c.id, c."partnerFields" AS current, ARRAY(
          SELECT unnest(
            (CASE WHEN c."externalSource" = 'PARTNER' THEN array_remove(ARRAY[${stated}], NULL) ELSE '{}'::text[] END)
            || COALESCE(p.f, '{}'::text[]))
          EXCEPT SELECT unnest(COALESCE(r.f, '{}'::text[]))
        ) AS add
          FROM "Company" c
          LEFT JOIN partner_rev p ON p."companyId" = c.id
          LEFT JOIN replaced r ON r."companyId" = c.id
         WHERE c."externalSource" = 'PARTNER' OR p."companyId" IS NOT NULL
      )
      UPDATE "Company" c SET "partnerFields" = ARRAY(SELECT DISTINCT unnest(t.current || t.add))
        FROM target t
       WHERE c.id = t.id AND NOT (t.current @> t.add)`);
    this.log(`Companies: ${n} rows given partner field marks`);
    return n;
  }

  /** Round columns the partner corrected on another source's round. */
  private async roundFields(): Promise<number> {
    const n = await this.prisma.$executeRawUnsafe(`
      WITH marks AS (
        SELECT "entityId" AS id, array_agg(DISTINCT field) AS f FROM "Revision"
         WHERE "entityType" = 'round' AND "actorSource" = 'PARTNER' AND field <> ''
         GROUP BY 1
      )
      UPDATE "FundingRound" r SET "partnerFields" = ARRAY(SELECT DISTINCT unnest(r."partnerFields" || m.f))
        FROM marks m
       WHERE r.id = m.id AND NOT (r."partnerFields" @> m.f)`);
    this.log(`Rounds: ${n} rows given partner field marks`);
    return n;
  }

  /**
   * Round investors the partner wrote: every row on a partner round, and on a
   * company the partner has deals for, every row naming a firm one of those
   * deals names. Fail closed — a public row naming the same firm on the same
   * company is marked too, because nothing recorded which source wrote it.
   */
  private async roundInvestors(): Promise<number> {
    const onPartnerRounds = await this.prisma.$executeRawUnsafe(`
      UPDATE "RoundInvestor" ri SET "externalSource" = 'PARTNER'
        FROM "FundingRound" r
       WHERE r.id = ri."roundId" AND r."externalSource" = 'PARTNER' AND ri."externalSource" IS NULL`);
    const onMatched = await this.prisma.$executeRawUnsafe(`
      WITH pairs AS (
        SELECT DISTINCT ce."entityId" AS company_id, ie."entityId" AS investor_id
          FROM partner_stage.deal_investor di
          JOIN partner_stage.deal d ON d.deal_id = di.deal_id
          JOIN "EntityIdentifier" ce ON ce.scheme = 'PARTNER' AND ce."entityType" = 'company' AND ce.value = d.company_id
          JOIN "EntityIdentifier" ie ON ie.scheme = 'PARTNER' AND ie."entityType" = 'investor' AND ie.value = di.firm_id
      )
      UPDATE "RoundInvestor" ri SET "externalSource" = 'PARTNER'
        FROM "FundingRound" r, pairs p
       WHERE r.id = ri."roundId" AND r."companyId" = p.company_id AND ri."investorId" = p.investor_id
         AND ri."externalSource" IS NULL`);
    this.log(`Round investors: ${onPartnerRounds} on partner rounds, ${onMatched} on other sources' rounds`);
    return onPartnerRounds + onMatched;
  }

  /** The staged firm universe, the same type filter the source applies, and
   *  partner firm id → our investor id. */
  private async firms() {
    const firms = await this.client.allFirms();
    const kept = new Map<string, KeptFirm>();
    for (const f of firms) {
      const type = firmType(f);
      if (type) kept.set(f.firm_id, { name: f.name.trim(), type });
    }
    const firmIds = new Map<string, string>();
    for (const r of await this.prisma.entityIdentifier.findMany({
      where: { scheme: 'PARTNER', entityType: 'investor' },
      select: { value: true, entityId: true },
    })) {
      firmIds.set(r.value, r.entityId);
    }
    return { firms, kept, firmIds };
  }

  /**
   * Firm columns: for every firm the partner created or matched, the columns
   * whose value is the partner's statement (plus `type` on a row it created).
   */
  private async investorFields(
    firms: Awaited<ReturnType<PartnerClient['allFirms']>>,
    kept: Map<string, KeptFirm>,
    firmIds: Map<string, string>,
  ): Promise<number> {
    const year = new Date().getUTCFullYear();
    let written = 0;
    // Grouped by our row: a merge can leave two partner firm ids on one firm,
    // and each must add to the same marks rather than overwrite the other's.
    const byInvestor = new Map<string, typeof firms>();
    for (const f of firms) {
      const id = firmIds.get(f.firm_id);
      if (!id || !kept.has(f.firm_id)) continue;
      const list = byInvestor.get(id);
      if (list) list.push(f);
      else byInvestor.set(id, [f]);
    }
    const ids = [...byInvestor.keys()];
    for (let i = 0; i < ids.length; i += PAGE) {
      const rows = await this.prisma.investor.findMany({
        where: { id: { in: ids.slice(i, i + PAGE) } },
        select: { id: true, externalSource: true, partnerFields: true, ...selectOf(PARTNER_INVESTOR_FIELDS) },
      });
      const updates: { id: string; marks: string[] }[] = [];
      for (const row of rows as unknown as Record<string, unknown>[]) {
        const add = byInvestor.get(row.id as string)!.flatMap((f) =>
          equalFields(
            row,
            toInvestorFirm(f, kept.get(f.firm_id)!.type, [], year) as unknown as Record<string, unknown>,
            PARTNER_INVESTOR_FIELDS,
          ),
        );
        if (row.externalSource === 'PARTNER') add.push('type');
        const marks = mergedMarks(row.partnerFields as string[], add);
        if (marks) updates.push({ id: row.id as string, marks });
      }
      written += await this.writeMarks('Investor', updates);
    }
    this.log(`Investors: ${written} rows given partner field marks`);
    return written;
  }

  /**
   * Fund columns: for every staged fund, the row it created (its provenance
   * key) or matched (its normalized name under the same resolved manager — the
   * match `upsertFund` made), and the columns holding the partner's value.
   *
   * Skipped entirely when the funds stage has never run (no fund carries the
   * partner's provenance): the partner has then written nothing to any fund,
   * and the name match would only mark public SEC values that happen to equal
   * the staged ones. The funds stage, run later, marks its own writes.
   */
  private async fundFields(kept: Map<string, KeptFirm>, firmIds: Map<string, string>): Promise<number> {
    if ((await this.prisma.fund.count({ where: { externalSource: 'PARTNER' } })) === 0) {
      this.log('Funds: the funds stage has not run — nothing to reconstruct');
      return 0;
    }
    const byKey = new Map<string, string>();
    const byManagerName = new Map<string, string>();
    let after: string | undefined;
    for (;;) {
      const rows = await this.prisma.fund.findMany({
        where: after ? { id: { gt: after } } : {},
        orderBy: { id: 'asc' },
        take: 20_000,
        select: { id: true, name: true, managerId: true, externalSource: true, externalId: true },
      });
      if (rows.length === 0) break;
      after = rows[rows.length - 1]!.id;
      for (const r of rows) {
        if (r.externalSource === 'PARTNER' && r.externalId) byKey.set(r.externalId, r.id);
        const k = `${r.managerId} ${normalizeFundName(r.name)}`;
        if (!byManagerName.has(k)) byManagerName.set(k, r.id);
      }
    }

    let written = 0;
    let cursor = '';
    for (;;) {
      const page = await this.client.funds(cursor, PAGE);
      if (page.length === 0) break;
      cursor = page[page.length - 1]!.fund_id;
      // A list per row, for the same reason as the firms: two staged funds can
      // resolve to one of ours.
      const targets = new Map<string, Record<string, unknown>[]>();
      for (const r of page) {
        const stated = toFund(r, kept);
        if (!stated) continue;
        const managerId = firmIds.get(r.manager_id);
        const id =
          byKey.get(r.fund_id) ??
          (managerId ? byManagerName.get(`${managerId} ${normalizeFundName(stated.name)}`) : undefined);
        if (!id) continue;
        const list = targets.get(id);
        if (list) list.push(stated as unknown as Record<string, unknown>);
        else targets.set(id, [stated as unknown as Record<string, unknown>]);
      }
      if (targets.size === 0) continue;
      const rows = await this.prisma.fund.findMany({
        where: { id: { in: [...targets.keys()] } },
        select: { id: true, partnerFields: true, ...selectOf(PARTNER_FUND_FIELDS) },
      });
      const updates: { id: string; marks: string[] }[] = [];
      for (const row of rows as unknown as Record<string, unknown>[]) {
        const add = targets.get(row.id as string)!.flatMap((stated) => equalFields(row, stated, PARTNER_FUND_FIELDS));
        const marks = mergedMarks(row.partnerFields as string[], add);
        if (marks) updates.push({ id: row.id as string, marks });
      }
      written += await this.writeMarks('Fund', updates);
    }
    this.log(`Funds: ${written} rows given partner field marks`);
    return written;
  }

  /** One statement per page. Marks travel comma-joined: column names carry no
   *  commas, and unnest cannot take a ragged text[][]. */
  private async writeMarks(table: 'Investor' | 'Fund', updates: { id: string; marks: string[] }[]): Promise<number> {
    if (updates.length === 0) return 0;
    return this.prisma.$executeRawUnsafe(
      `UPDATE "${table}" t SET "partnerFields" = string_to_array(v.marks, ',')
         FROM unnest($1::text[], $2::text[]) AS v(id, marks)
        WHERE t.id = v.id`,
      updates.map((u) => u.id),
      updates.map((u) => u.marks.join(',')),
    );
  }
}

function selectOf<F extends string>(fields: readonly F[]): Record<F, true> {
  return Object.fromEntries(fields.map((f) => [f, true])) as Record<F, true>;
}
