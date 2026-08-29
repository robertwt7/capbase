import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unzipSync } from 'fflate';

/** The SEC's "Crowdfunding offerings data sets" landing page, which links every
 *  quarterly archive of the Form C (Regulation Crowdfunding) tables. */
export const FORM_C_INDEX_URL =
  'https://www.sec.gov/data-research/sec-markets-data/crowdfunding-offerings-data-sets';

const SEC_ORIGIN = 'https://www.sec.gov';
const MIN_INTERVAL_MS = 160; // ~6 req/s — comfortably under SEC's 10 req/s limit.
const REQUEST_TIMEOUT_MS = 120_000; // these are multi-MB archives, not small docs

/** Oldest quarter published: Reg CF offerings began in May 2016. */
const DEFAULT_MIN_QUARTER = '2016q2';

export interface FormCQuarter {
  /** `2026q2` — the quarter token shared by the archive and its folder. */
  label: string;
  url: string;
}

/**
 * Quarterly archives linked from the index page, newest first.
 *
 * Unlike the ADV filenames these ARE pattern-stable (`{YYYY}q{N}_cf.zip`), but
 * the page is still scraped: a quarter the SEC has not published must be
 * absent, not a 404.
 */
export function parseFormCQuarters(html: string): FormCQuarter[] {
  const hrefs = [...html.matchAll(/href="([^"]+\.zip)"/gi)].map((m) => m[1]!);

  const seen = new Map<string, FormCQuarter>();
  for (const href of hrefs) {
    const file = href.split('/').pop() ?? '';
    const match = /^(\d{4}q[1-4])_cf\.zip$/i.exec(file);
    if (!match) continue;
    const label = match[1]!.toLowerCase();
    if (seen.has(label)) continue;
    seen.set(label, {
      label,
      url: href.startsWith('http') ? href : `${SEC_ORIGIN}${href}`,
    });
  }

  // The labels sort lexicographically because the year leads: `2016q2` < `2026q2`.
  return [...seen.values()].sort((a, b) => b.label.localeCompare(a.label));
}

/**
 * Client for the SEC's quarterly Form C (Regulation Crowdfunding) bulk data.
 *
 * Like Form ADV and unlike EDGAR, this is a *snapshot* feed: each archive holds
 * every filing accepted that quarter, so there is no rolling window to walk and
 * `days` is meaningless.
 */
@Injectable()
export class FormCClient {
  private readonly logger = new Logger(FormCClient.name);
  private readonly userAgent: string;
  /** Oldest quarter to walk, e.g. `2024q1`. Defaults to everything. */
  private readonly minQuarter: string;
  private lastRequestAt = 0;

  constructor(config: ConfigService) {
    this.userAgent =
      config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
    this.minQuarter =
      config.get<string>('FORM_C_MIN_QUARTER')?.trim().toLowerCase() || DEFAULT_MIN_QUARTER;
  }

  /** Every quarterly archive at or after FORM_C_MIN_QUARTER, newest first. */
  async listQuarters(): Promise<FormCQuarter[]> {
    const html = await this.fetchText(FORM_C_INDEX_URL);
    if (!html) {
      this.logger.error('Could not load the Form C index page — no quarters resolved');
      return [];
    }

    const all = parseFormCQuarters(html);
    const quarters = all.filter((q) => q.label >= this.minQuarter);
    if (quarters.length === 0) {
      this.logger.error(
        `Form C index page listed no archive at or after ${this.minQuarter} (found ${all.length} in total)`,
      );
      return [];
    }

    // Logged so a run is auditable and exactly repeatable via FORM_C_MIN_QUARTER.
    this.logger.log(
      `${quarters.length} Form C quarters from ${quarters[quarters.length - 1]!.label} to ${quarters[0]!.label}`,
    );
    return quarters;
  }

  /**
   * Every `.tsv` member of one quarterly ZIP, keyed by bare filename
   * (`FORM_C_SUBMISSION.tsv`). The archive nests its members under a
   * `{YYYY}Q{N}_cf/` folder, and `FORM_C_COISSUER_INFORMATION.tsv` exists in
   * only 22 of the 41 archives — a missing member is normal, not an error.
   * UTF-8, unlike the latin-1 ADV files.
   */
  async fetchQuarter(url: string): Promise<Record<string, string> | null> {
    const buf = await this.fetchBuffer(url);
    if (!buf) return null;
    try {
      const entries = unzipSync(new Uint8Array(buf));
      const decoder = new TextDecoder('utf-8');
      const tables: Record<string, string> = {};
      for (const [path, bytes] of Object.entries(entries)) {
        const name = path.split('/').pop() ?? '';
        if (!name.toUpperCase().endsWith('.TSV')) continue;
        tables[name.toUpperCase()] = decoder.decode(bytes);
      }
      if (Object.keys(tables).length === 0) {
        this.logger.warn(`No .tsv members inside ${url}`);
        return null;
      }
      return tables;
    } catch (err) {
      this.logger.warn(`Failed to unzip ${url}: ${String(err)}`);
      return null;
    }
  }

  private async fetchText(url: string): Promise<string | null> {
    const buf = await this.fetchBuffer(url);
    return buf ? new TextDecoder('utf-8').decode(buf) : null;
  }

  private async fetchBuffer(url: string): Promise<ArrayBuffer | null> {
    await this.throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: '*/*' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`GET ${url} -> ${res.status}`);
        return null;
      }
      return await res.arrayBuffer();
    } catch (err) {
      this.logger.warn(`GET ${url} failed: ${String(err)}`);
      return null;
    }
  }

  /** Same start-throttling contract as EdgarClient — the 10 req/s cap is
   *  per-IP across every sec.gov host, so every client must respect it. */
  private slots: Promise<void> = Promise.resolve();

  private throttle(): Promise<void> {
    const slot = this.slots.then(async () => {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    });
    this.slots = slot;
    return slot;
  }
}
