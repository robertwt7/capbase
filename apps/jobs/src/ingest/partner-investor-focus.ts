/**
 * Write the partner's reported investment focus (stages, strategies,
 * industries, verticals, geography, and the initial-equity / typical-commitment
 * ranges) onto the investor firms it belongs to — WITHOUT re-running the firms
 * stage, so no firm column, person, role or private contact is touched.
 *
 * Reads a v2 `partner_stage.firm_focus` (no network). Resolution per staged
 * firm: its own row (`externalSource = 'PARTNER'`), else the firm carrying its
 * PARTNER identifier; the writer (`IngestService.writeInvestorFocus`) then
 * insists on a strong association — own row or equal identifying domain — and
 * follows admin merges to the survivor. A name-only association writes nothing.
 *
 * Idempotent: a second run over the same stage writes 0 rows.
 */
import type { PrismaService } from '../prisma/prisma.service';
import type { FirmFocusPageRow, PartnerClient } from '../sources/partner/partner.client';
import {
  FOCUS_ISSUES,
  PARTNER,
  emptyFocusIssues,
  firmType,
  toFirmFocusList,
  websiteUrl,
  type FirmRow,
  type FocusIssueCounts,
} from '../sources/partner/partner.parser';
import { identifyingDomain } from '../util/domain';
import { addFocusCounts, emptyFocusCounts, type FocusWriteCounts, type IngestService } from './ingest.service';

const PAGE = 500;

export interface InvestorFocusCounts extends Omit<FocusWriteCounts, 'skipped'> {
  /** Staged firms looked at (one firm may carry two roles). */
  candidates: number;
  /** Firms not written: no row holds the partner id, the firm is not an
   *  investor type, or no approved survivor exists. */
  unresolved: number;
  issues: FocusIssueCounts;
  /** Usable staged roles, by role. */
  roles: { manager: number; lp: number };
}

/** Why the backfill cannot run on the loaded stage, or null when it can. */
export async function focusPreflight(client: PartnerClient): Promise<string | null> {
  if (!(await client.stageLoaded())) return 'partner stage not loaded — load a v2 stage (make partner-stage-status)';
  const contract = await client.stageContract();
  if (contract.version < 2) {
    return `partner stage is v${contract.version}: investor focus is not staged — load a v2 stage (make partner-stage-status)`;
  }
  if (!contract.snapshotDate) return 'partner_stage.meta has no snapshot_date — rebuild the v2 stage';
  try {
    await client.requireFocusColumns();
  } catch (err) {
    return (err as Error).message;
  }
  return null;
}

export class PartnerInvestorFocusBackfill {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PartnerClient,
    private readonly ingest: IngestService,
    private readonly log: (msg: string) => void,
  ) {}

  /** Run after `focusPreflight` returned null. */
  async run(): Promise<InvestorFocusCounts> {
    const { snapshotDate } = await this.client.stageContract();
    if (!snapshotDate) throw new Error('partner_stage.meta has no snapshot_date');
    const issues = emptyFocusIssues();
    const writes = emptyFocusCounts();
    const counts: InvestorFocusCounts = {
      candidates: 0,
      written: 0,
      unchanged: 0,
      stale: 0,
      weak: 0,
      unresolved: 0,
      issues,
      roles: { manager: 0, lp: 0 },
    };

    let after: [string, string] = ['', ''];
    // A firm's two roles may straddle a page boundary; carry the tail over so
    // the writer always sees all of a firm's roles at once.
    let carry: FirmFocusPageRow[] = [];
    for (;;) {
      const rows = await this.client.firmFocusPage(after, PAGE);
      const done = rows.length < PAGE;
      if (rows.length > 0) {
        const last = rows[rows.length - 1]!;
        after = [last.firm_id, last.role];
      }
      let batch = [...carry, ...rows];
      carry = [];
      if (!done && batch.length > 0) {
        const tailId = batch[batch.length - 1]!.firm_id;
        carry = batch.filter((r) => r.firm_id === tailId);
        batch = batch.filter((r) => r.firm_id !== tailId);
      }
      if (batch.length > 0) await this.page(batch, snapshotDate, counts, writes);
      if (done) break;
    }
    counts.written = writes.written;
    counts.unchanged = writes.unchanged;
    counts.stale = writes.stale;
    counts.weak = writes.weak;
    return counts;
  }

  private async page(
    rows: FirmFocusPageRow[],
    snapshotDate: string,
    counts: InvestorFocusCounts,
    writes: FocusWriteCounts,
  ): Promise<void> {
    const byFirm = new Map<string, FirmFocusPageRow[]>();
    for (const r of rows) {
      const list = byFirm.get(r.firm_id);
      if (list) list.push(r);
      else byFirm.set(r.firm_id, [r]);
    }
    const ids = [...byFirm.keys()];

    // Own rows first, then the firm carrying the partner identifier.
    const own = new Map<string, string>();
    for (const r of await this.prisma.investor.findMany({
      where: { externalSource: PARTNER, externalId: { in: ids } },
      select: { id: true, externalId: true },
    })) {
      if (r.externalId) own.set(r.externalId, r.id);
    }
    const viaIdentifier = new Map<string, string>();
    for (const r of await this.prisma.entityIdentifier.findMany({
      where: { entityType: 'investor', scheme: PARTNER, value: { in: ids } },
      select: { value: true, entityId: true },
    })) {
      viaIdentifier.set(r.value, r.entityId);
    }

    for (const [firmId, focusRows] of byFirm) {
      counts.candidates++;
      const head = focusRows[0]!;
      const firm: FirmRow = {
        firm_id: firmId,
        name: head.name,
        role: head.firm_role,
        manager_firm_type: head.manager_firm_type,
        lp_firm_type: head.lp_firm_type,
        country: null,
        city: null,
        website: head.website,
        year_established: null,
        about: null,
        aum_usd: null,
        vc_fund_share: head.vc_fund_share,
        deal_count: head.deal_count,
      };
      const focus = toFirmFocusList(focusRows, snapshotDate, counts.issues);
      for (const f of focus) counts.roles[f.role]++;
      if (focus.length === 0) continue;

      const investorId = own.get(firmId) ?? viaIdentifier.get(firmId);
      if (!investorId || !firmType(firm)) {
        counts.unresolved++;
        continue;
      }
      const result = await this.ingest.writeInvestorFocus(
        investorId,
        { externalId: firmId, domain: identifyingDomain(websiteUrl(firm.website)) },
        focus,
        PARTNER,
      );
      if (result.skipped > 0) counts.unresolved++;
      addFocusCounts(writes, result);
    }
    this.log(
      `… ${counts.candidates} firms looked at: ${writes.written} roles written, ${writes.unchanged} unchanged, ` +
        `${writes.stale} stale, ${writes.weak} weak, ${counts.unresolved} firms unresolved`,
    );
  }
}

export function focusSummary(c: InvestorFocusCounts): string {
  return (
    `${c.candidates} candidates: ${c.written} written, ${c.unchanged} unchanged, ${c.stale} stale, ` +
    `${c.weak} weak (name-only association), ${c.unresolved} unresolved; ` +
    `roles: manager ${c.roles.manager}, lp ${c.roles.lp}; ` +
    `issues: ${FOCUS_ISSUES.map((k) => `${k} ${c.issues[k]}`).join(', ')}`
  );
}
