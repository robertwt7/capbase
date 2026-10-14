import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createCsvParser, type CsvRow } from '../../util/csv';
import { fetchTail, parseCentralDirectory, streamZipMember } from '../../util/zip-range';

const BASE = 'https://download.companieshouse.gov.uk';

/** The tail holding the central directory. The archive has one member, so a
 *  few KB would do; this leaves room for a split product or a long comment. */
const TAIL_BYTES = 65_536;

/** ~494 MB compressed over one connection, inflated to ~2.8 GB of CSV. */
const STREAM_TIMEOUT_MS = 3_600_000;

/** `BasicCompanyDataAsOneFile-YYYY-MM-01.zip` for a snapshot date. */
export function snapshotUrl(snapshot: string): string {
  return `${BASE}/BasicCompanyDataAsOneFile-${snapshot}.zip`;
}

/** First-of-month snapshot dates to try, newest first: the current month, then
 *  the one before (Companies House publishes within five working days of month
 *  end, so early in a month the current file may not exist yet). */
export function candidateSnapshots(now: Date = new Date()): string[] {
  const first = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return [first(now.getUTCFullYear(), now.getUTCMonth()), first(now.getUTCFullYear(), now.getUTCMonth() - 1)];
}

export interface ChSnapshot {
  snapshot: string;
  url: string;
  rows: number;
}

/**
 * Companies House Free Company Data Product: every live company on the UK
 * register, one monthly snapshot as a single ~494 MB zip.
 *
 * Read by HTTP range request, like the Form ADV archives: the central directory
 * from the tail, then the one CSV member inflated as it streams — the ~2.8 GB of
 * CSV, and its 5.3M rows, are never held. Only rows the caller keeps survive.
 */
@Injectable()
export class CompaniesHouseClient {
  private readonly logger = new Logger(CompaniesHouseClient.name);
  private readonly userAgent: string;
  /** Pins one snapshot (`YYYY-MM-01`) for a reproducible run, like ADV_SNAPSHOT. */
  private readonly pinned?: string;

  constructor(config: ConfigService) {
    this.userAgent = config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
    this.pinned = config.get<string>('CH_SNAPSHOT')?.trim() || undefined;
  }

  /** Stream every row of the newest available (or the pinned) snapshot.
   *  Throws when no snapshot can be read: a run that streamed nothing must not
   *  pass for one that found nothing to keep. */
  async streamRows(onRow: (row: CsvRow) => void): Promise<ChSnapshot> {
    const snapshots = this.pinned ? [this.pinned] : candidateSnapshots();
    for (const snapshot of snapshots) {
      const url = snapshotUrl(snapshot);
      const opts = { userAgent: this.userAgent, timeoutMs: STREAM_TIMEOUT_MS };
      const tail = await fetchTail(url, TAIL_BYTES, opts);
      if (!tail) {
        this.logger.warn(`No snapshot at ${url} (or range requests refused)`);
        continue;
      }
      const entry = parseCentralDirectory(tail).find((e) => e.name.toLowerCase().endsWith('.csv'));
      if (!entry) throw new Error(`${url} has no CSV member`);

      let rows = 0;
      const parser = createCsvParser((row) => {
        rows++;
        onRow(row);
        if (rows % 500_000 === 0) this.logger.log(`Companies House ${snapshot}: ${rows} rows scanned`);
      });
      const ok = await streamZipMember(url, entry, opts, (text) => parser.write(text));
      if (!ok) throw new Error(`Failed to stream ${entry.name} from ${url} after ${rows} rows`);
      parser.end();
      return { snapshot, url, rows };
    }
    throw new Error(`No Companies House snapshot available (tried ${snapshots.join(', ')})`);
  }
}
