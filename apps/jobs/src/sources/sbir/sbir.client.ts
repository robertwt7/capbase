import { Injectable, Logger } from '@nestjs/common';

import { createCsvParser, type CsvRow } from '../../util/csv';

/**
 * SBIR.gov's bulk award file.
 *
 * The documented JSON API (api.www.sbir.gov/public/api/awards) returns
 * `403 ForbiddenException` from its API gateway on every documented example,
 * and a snapshot suits us better anyway: one request instead of ~2,200 paged
 * ones, and a `Last-Modified` that makes a run auditable.
 *
 * The `no_abstract` variant is deliberate — the full file adds an Abstract
 * column and a lot of weight for a field with no schema slot.
 */
export const SBIR_AWARDS_CSV =
  'https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv';

const REQUEST_TIMEOUT_MS = 600_000; // ~91 MB over a single connection

export type SbirRow = CsvRow;

export interface SbirSnapshot {
  /** The file's Last-Modified date, e.g. '2026-08-01' — logged so a run is
   *  auditable and its numbers reproducible. */
  label: string;
  url: string;
  /** Records emitted. */
  rows: number;
}

@Injectable()
export class SbirClient {
  private readonly logger = new Logger(SbirClient.name);

  /**
   * Stream the award file, invoking `onRow` per record.
   *
   * Never buffered: the file is ~91 MB, 55 records span more than one physical
   * line (so a line split is wrong), and the worker's memory limit is 1536m.
   * The caller aggregates as rows arrive, so peak memory stays in the low
   * hundreds of MB rather than holding 219,503 row objects at once.
   */
  async streamAwards(onRow: (row: SbirRow) => void): Promise<SbirSnapshot | null> {
    let rows = 0;
    try {
      const res = await fetch(SBIR_AWARDS_CSV, {
        headers: { Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) {
        this.logger.error(`GET ${SBIR_AWARDS_CSV} -> ${res.status}`);
        return null;
      }

      const label = lastModifiedDate(res.headers.get('last-modified'));
      const parser = createCsvParser((row) => {
        rows += 1;
        onRow(row);
      });

      const decoder = new TextDecoder('utf-8');
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        // `stream: true` holds back a split multi-byte character rather than
        // emitting a replacement one at the chunk boundary.
        parser.write(decoder.decode(chunk, { stream: true }));
      }
      parser.write(decoder.decode());
      parser.end();

      this.logger.log(`SBIR award snapshot ${label}: ${rows} awards`);
      return { label, url: SBIR_AWARDS_CSV, rows };
    } catch (err) {
      this.logger.error(`Streaming ${SBIR_AWARDS_CSV} failed after ${rows} rows: ${String(err)}`);
      return null;
    }
  }
}

/** `Sat, 01 Aug 2026 05:47:05 GMT` → `2026-08-01`; 'unknown' when absent. */
function lastModifiedDate(header: string | null): string {
  if (!header) return 'unknown';
  const parsed = Date.parse(header);
  return Number.isNaN(parsed) ? 'unknown' : new Date(parsed).toISOString().slice(0, 10);
}
