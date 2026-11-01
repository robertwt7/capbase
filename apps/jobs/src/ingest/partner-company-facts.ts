/**
 * Re-apply the partner's company facts (industry labels, location, country) to
 * companies the partner matched but did not create.
 *
 * Until `enrich()` learned to fill an empty `industry` and an `Undisclosed`
 * `hq`, a partner record landing on another source's row (an Innovate UK
 * grantee, a Form C issuer, …) left both blank even when the partner stated
 * them. This pass repairs those rows through the same `enrich()` — so each fill
 * writes a revision and a `partnerFields` mark, exactly as a fresh partner run
 * would — and never writes prose, name, stage, status or totals.
 *
 * Reads `partner_stage.company` (no network). Idempotent: a filled row no longer
 * qualifies, so a second run selects nothing that can change.
 */
import type { PrismaService } from '../prisma/prisma.service';
import { PARTNER, companyFacts, type CompanyRow } from '../sources/partner/partner.parser';
import type { IngestService } from './ingest.service';

const PAGE = 500;

export interface CompanyFactsCounts {
  /** Rows the pass looked at (blank industry or location, partner states one). */
  candidates: number;
  /** Rows at least one column was filled on. */
  written: number;
  /** Rows enrichment left alone (nothing it may fill). */
  unchanged: number;
}

type Target = CompanyRow & { id: string; name_held: string };

export class PartnerCompanyFactsBackfill {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    private readonly log: (msg: string) => void,
  ) {}

  async run(): Promise<CompanyFactsCounts> {
    const counts: CompanyFactsCounts = { candidates: 0, written: 0, unchanged: 0 };
    let after = '';
    for (;;) {
      const page = await this.targets(after);
      if (page.length === 0) break;
      after = page[page.length - 1]!.id;
      for (const t of page) {
        counts.candidates++;
        const facts = companyFacts(t);
        const written = await this.ingest.enrichCompanyFacts(t.id, {
          source: PARTNER,
          companyExternalId: t.company_id,
          company: {
            name: t.name_held,
            // No founding year, no rounds and a stage enrich can never adopt
            // (it only replaces `Bootstrapped`, and only with another stage):
            // nothing here besides the facts can be written.
            foundedYear: 0,
            stage: 'Bootstrapped',
            totalRaisedUsd: 0,
            ...facts,
          },
        });
        if (written) counts.written++;
        else counts.unchanged++;
      }
      this.log(`… ${counts.candidates} looked at, ${counts.written} written`);
    }
    return counts;
  }

  /**
   * One page of approved, unmerged companies another source created that carry
   * a partner identifier, are blank on industry or location, and whose staged
   * partner row states the missing value. One staged row per company (the
   * lowest partner id) — a merge can leave two, and enrichment would fill from
   * the first anyway.
   */
  private targets(after: string): Promise<Target[]> {
    return this.prisma.$queryRaw<Target[]>`
      SELECT DISTINCT ON (c.id)
             c.id, c.name AS name_held, s.company_id, s.name, s.country, s.city, s.website,
             s.industry, s.verticals, NULL::text AS about, s.status
        FROM "Company" c
        JOIN "EntityIdentifier" e
          ON e."entityType" = 'company' AND e."entityId" = c.id AND e.scheme = 'PARTNER'
        JOIN partner_stage.company s ON s.company_id = e.value
       WHERE c.id > ${after}
         AND c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL
         AND c."externalSource" IS DISTINCT FROM 'PARTNER'
         AND (
           (cardinality(c.industry) = 0
             AND (btrim(coalesce(s.industry, '')) <> '' OR btrim(coalesce(s.verticals, '')) <> ''))
           OR (btrim(c.hq) IN ('', 'Undisclosed')
             AND (btrim(coalesce(s.city, '')) <> '' OR btrim(coalesce(s.country, '')) <> ''))
         )
       ORDER BY c.id, s.company_id
       LIMIT ${PAGE}`;
  }
}
