/**
 * Read the private source bundle `prepare-company-repair-snapshot` writes.
 *
 * Streams NDJSON line by line, verifying each file's SHA-256 as it goes; a
 * mismatch fails the whole run (the data read so far is discarded with it).
 * Only small indexes stay resident: deal → company for every deal, and the set
 * of source company ids. Full facts — prose included — are re-read on demand
 * for the few thousand ids a repair actually needs, never for all of them.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { CompanyRow, DealRow } from '../sources/partner/partner.parser';

export const SNAPSHOT_FORMAT = 'capbase-company-repair-snapshot';
const TABLES = ['company', 'deal', 'deal_investor', 'firm'] as const;

export interface SnapshotManifest {
  format: string;
  formatVersion: number;
  extractionVersion: string;
  filterVersion: string;
  createdFrom: Record<string, unknown>;
  tables: Record<string, { file: string; rows: number; sha256: string }>;
  bundleSha256: string;
}

export class SnapshotError extends Error {}

export class SourceSnapshot {
  /** deal_id → company_id, every deal in the bundle. */
  readonly dealCompany = new Map<string, string>();
  /** Every source company id in the bundle. */
  readonly companyIds = new Set<string>();

  private constructor(
    readonly dir: string,
    readonly manifest: SnapshotManifest,
  ) {}

  /** Open and index a bundle. Verifies format, row counts and file hashes. */
  static async open(dir: string): Promise<SourceSnapshot> {
    const path = join(dir, 'manifest.json');
    if (!existsSync(path)) throw new SnapshotError(`${dir} has no manifest.json — not a source bundle`);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as SnapshotManifest;
    if (manifest.format !== SNAPSHOT_FORMAT || manifest.formatVersion !== 1) {
      throw new SnapshotError(`${dir}: unsupported bundle format ${manifest.format} v${manifest.formatVersion}`);
    }
    for (const t of TABLES) {
      if (!manifest.tables?.[t]?.sha256) throw new SnapshotError(`${dir}: manifest lists no ${t} table`);
    }
    const expectBundle = createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.keys(manifest.tables)
              .sort()
              .map((k) => [k, manifest.tables[k]!.sha256]),
          ),
        ).replace(/,/g, ', ').replace(/:/g, ': '),
      )
      .digest('hex');
    if (expectBundle !== manifest.bundleSha256) {
      throw new SnapshotError(`${dir}: bundleSha256 does not match its table hashes (edited manifest?)`);
    }
    const snap = new SourceSnapshot(dir, manifest);
    const intern = new Map<string, string>();
    await snap.each<{ company_id: string }>('company', (row) => {
      snap.companyIds.add(row.company_id);
      intern.set(row.company_id, row.company_id);
    });
    await snap.each<{ deal_id: string; company_id: string }>('deal', (row) => {
      if (snap.dealCompany.has(row.deal_id)) throw new SnapshotError(`deal ${row.deal_id} appears twice`);
      snap.dealCompany.set(row.deal_id, intern.get(row.company_id) ?? row.company_id);
    });
    return snap;
  }

  get bundleSha256(): string {
    return this.manifest.bundleSha256;
  }

  /** Stream one table, verifying its hash and row count. */
  async each<T>(table: (typeof TABLES)[number], visit: (row: T) => void): Promise<void> {
    const meta = this.manifest.tables[table]!;
    const hash = createHash('sha256');
    let rows = 0;
    const rl = createInterface({ input: createReadStream(join(this.dir, meta.file)), crlfDelay: Infinity });
    for await (const line of rl) {
      hash.update(`${line}\n`);
      if (!line) continue;
      rows++;
      visit(JSON.parse(line) as T);
    }
    if (rows !== meta.rows) throw new SnapshotError(`${table}: ${rows} rows, manifest says ${meta.rows}`);
    if (hash.digest('hex') !== meta.sha256) throw new SnapshotError(`${table}: SHA-256 mismatch — bundle modified?`);
  }

  /** Full company rows (prose included) for these ids. */
  async companies(ids: ReadonlySet<string>): Promise<Map<string, CompanyRow>> {
    const out = new Map<string, CompanyRow>();
    if (ids.size === 0) return out;
    await this.each<CompanyRow>('company', (row) => {
      if (ids.has(row.company_id)) out.set(row.company_id, row);
    });
    return out;
  }

  /** Every deal of these source companies. */
  async deals(companyIds: ReadonlySet<string>): Promise<Map<string, DealRow[]>> {
    const out = new Map<string, DealRow[]>();
    if (companyIds.size === 0) return out;
    await this.each<DealRow>('deal', (row) => {
      if (!companyIds.has(row.company_id)) return;
      const list = out.get(row.company_id);
      if (list) list.push(row);
      else out.set(row.company_id, [row]);
    });
    return out;
  }

  /** deal → firm ids, for these deals. */
  async dealInvestors(dealIds: ReadonlySet<string>): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (dealIds.size === 0) return out;
    await this.each<{ deal_id: string; firm_id: string }>('deal_investor', (row) => {
      if (!dealIds.has(row.deal_id)) return;
      const list = out.get(row.deal_id);
      if (list) list.push(row.firm_id);
      else out.set(row.deal_id, [row.firm_id]);
    });
    return out;
  }
}
