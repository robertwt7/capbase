import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unzipSync } from 'fflate';

/** The SEC's "Information About Registered Investment Advisers and Exempt
 *  Reporting Advisers" landing page, which links every monthly snapshot. */
export const ADV_INDEX_URL =
  'https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers';

const SEC_ORIGIN = 'https://www.sec.gov';
const MIN_INTERVAL_MS = 160; // ~6 req/s — comfortably under SEC's 10 req/s limit.
const REQUEST_TIMEOUT_MS = 120_000; // these are multi-MB archives, not small docs

export interface AdvSnapshot {
  /** Snapshot label, e.g. `ia07012026` — the token both files share. */
  label: string;
  /** Registered investment advisers (RIA) archive URL. */
  registered: string;
  /** Exempt reporting advisers (ERA) archive URL — where most VC firms sit. */
  exempt: string;
}

/**
 * Client for the SEC's monthly Investment Adviser bulk data.
 *
 * Unlike EDGAR, this is a *snapshot* feed: each month republishes the full
 * roster, so there is no time window to walk — `days` is meaningless here.
 */
@Injectable()
export class AdvClient {
  private readonly logger = new Logger(AdvClient.name);
  private readonly userAgent: string;
  /** Pins a specific monthly snapshot for reproducible runs (e.g. `ia07012026`). */
  private readonly pinnedSnapshot?: string;
  private lastRequestAt = 0;

  constructor(config: ConfigService) {
    this.userAgent =
      config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
    this.pinnedSnapshot = config.get<string>('ADV_SNAPSHOT')?.trim() || undefined;
  }

  /** Resolve the snapshot to ingest: the pinned one, else the most recent. */
  async resolveSnapshot(): Promise<AdvSnapshot | null> {
    const html = await this.fetchText(ADV_INDEX_URL);
    if (!html) {
      this.logger.error('Could not load the ADV index page — no snapshot resolved');
      return null;
    }

    const snapshots = parseAdvSnapshots(html);
    if (snapshots.length === 0) {
      this.logger.error('ADV index page listed no usable archive pairs');
      return null;
    }

    const chosen = this.pinnedSnapshot
      ? snapshots.find((s) => s.label === this.pinnedSnapshot)
      : snapshots[0];

    if (!chosen) {
      this.logger.error(
        `ADV_SNAPSHOT="${this.pinnedSnapshot}" not found. Available: ${snapshots
          .slice(0, 6)
          .map((s) => s.label)
          .join(', ')}`,
      );
      return null;
    }

    // Logged so a run is auditable and exactly repeatable via ADV_SNAPSHOT.
    this.logger.log(
      `ADV snapshot ${chosen.label}${this.pinnedSnapshot ? ' (pinned)' : ' (latest)'}: ${chosen.registered} + ${chosen.exempt}`,
    );
    return chosen;
  }

  /** Download a ZIP and return the text of its single CSV entry.
   *  The files are latin-1, not UTF-8 — decoding as UTF-8 mangles firm names. */
  async fetchCsv(url: string): Promise<string | null> {
    const buf = await this.fetchBuffer(url);
    if (!buf) return null;
    try {
      const entries = unzipSync(new Uint8Array(buf));
      const name = Object.keys(entries).find((n) => n.toUpperCase().endsWith('.CSV'));
      if (!name) {
        this.logger.warn(`No CSV entry inside ${url} (found: ${Object.keys(entries).join(', ')})`);
        return null;
      }
      return new TextDecoder('windows-1252').decode(entries[name]!);
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
   *  per-IP across every sec.gov host, so both clients must respect it. */
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

/**
 * Pair up the monthly archives linked from the ADV index page, newest first.
 *
 * The published filenames are NOT pattern-stable — real examples from one page:
 * `ia07012026.zip`, `ia060126_0.zip`, `ia020226-exemptzip.zip`. So the page is
 * always scraped for hrefs; a URL is never constructed from a date. The shared
 * `iaMMDDYYYY` / `iaMMDDYY` prefix is what pairs a registered file with its
 * exempt counterpart.
 */
export function parseAdvSnapshots(html: string): AdvSnapshot[] {
  const hrefs = [...html.matchAll(/href="([^"]+\.zip)"/gi)].map((m) => m[1]!);

  const pairs = new Map<string, { registered?: string; exempt?: string; order: number }>();
  for (const [order, href] of hrefs.entries()) {
    const file = href.split('/').pop() ?? '';
    // `ia` + 6 or 8 digits, then anything (`-exempt`, `_0`, `-exemptzip`, …).
    const match = /^(ia\d{6,8})(.*)\.zip$/i.exec(file);
    if (!match) continue;
    const label = match[1]!.toLowerCase();
    const isExempt = /exempt/i.test(match[2]!);

    const entry = pairs.get(label) ?? { order };
    const url = href.startsWith('http') ? href : `${SEC_ORIGIN}${href}`;
    if (isExempt) entry.exempt ??= url;
    else entry.registered ??= url;
    pairs.set(label, entry);
  }

  // The page lists newest first, so document order is the recency order.
  return [...pairs.entries()]
    .filter(([, v]) => v.registered && v.exempt)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([label, v]) => ({ label, registered: v.registered!, exempt: v.exempt! }));
}
