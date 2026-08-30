import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createCsvParser, type CsvRow } from '../../util/csv';
import { fetchTail, parseCentralDirectory, streamZipMember, type ZipEntry } from '../../util/zip-range';

/** The SEC FOIA page that links the Form ADV Part 1 data archives. Unlike the
 *  monthly roster, these are re-cut occasionally and the filenames encode the
 *  range they cover — so the page is scraped, never a URL constructed. */
export const ADV_ARCHIVE_INDEX_URL =
  'https://www.sec.gov/foia-services/frequently-requested-documents/form-adv-data';

const SEC_ORIGIN = 'https://www.sec.gov';
const MIN_INTERVAL_MS = 160; // ~6 req/s — the SEC's 10 req/s cap is per IP.
const INDEX_TIMEOUT_MS = 120_000;
/** Enough tail to hold the central directory of an archive with a few dozen
 *  members (46 bytes + name each), plus the end-of-central-directory record. */
const TAIL_BYTES = 262_144;
/** These CSVs are latin-1, exactly like the monthly roster files. */
const ENCODING = 'windows-1252';

export interface AdvArchive {
  /** Range label shared by both zips, e.g. `20111105-20241231`. */
  label: string;
  part1: string;
  part2: string;
}

/**
 * Client for the Form ADV Part 1 data archives — the per-fund Schedule D
 * detail, which the monthly roster download does not contain.
 *
 * Reads members by HTTP range request rather than downloading the archives:
 * they are 700 MB and 429 MB, the four members we need total ~180 MB
 * compressed, and one of them is 396 MB uncompressed.
 */
@Injectable()
export class AdvArchiveClient {
  private readonly logger = new Logger(AdvArchiveClient.name);
  private readonly userAgent: string;
  /** Pins a specific archive cut for reproducible runs, e.g. `20111105-20241231`. */
  private readonly pinnedArchive?: string;
  private lastRequestAt = 0;
  private slots: Promise<void> = Promise.resolve();

  constructor(config: ConfigService) {
    this.userAgent = config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
    this.pinnedArchive = config.get<string>('ADV_ARCHIVE')?.trim() || undefined;
  }

  /** Resolve the archive pair to read: the pinned cut, else the newest. */
  async resolveArchive(): Promise<AdvArchive | null> {
    const html = await this.fetchIndex();
    if (!html) {
      this.logger.error('Could not load the Form ADV data page — no archive resolved');
      return null;
    }

    const archives = parseAdvArchives(html);
    if (archives.length === 0) {
      this.logger.error('Form ADV data page listed no complete Part 1 archive pair');
      return null;
    }

    const chosen = this.pinnedArchive
      ? archives.find((a) => a.label === this.pinnedArchive)
      : archives[0];
    if (!chosen) {
      this.logger.error(
        `ADV_ARCHIVE="${this.pinnedArchive}" not found. Available: ${archives.map((a) => a.label).join(', ')}`,
      );
      return null;
    }

    // Logged so a run is auditable and exactly repeatable via ADV_ARCHIVE.
    this.logger.log(
      `ADV Part 1 archive ${chosen.label}${this.pinnedArchive ? ' (pinned)' : ' (latest)'}: ${chosen.part1} + ${chosen.part2}`,
    );
    return chosen;
  }

  /** List an archive's members, from its central directory alone. */
  async listMembers(url: string): Promise<ZipEntry[]> {
    const tail = await fetchTail(url, TAIL_BYTES, this.rangeOptions());
    if (!tail) {
      this.logger.warn(`Could not range-fetch the central directory of ${url}`);
      return [];
    }
    const entries = parseCentralDirectory(tail);
    this.logger.log(`${entries.length} members in ${url.split('/').pop()}`);
    return entries;
  }

  /**
   * Stream one member's CSV rows.
   *
   * Rows are handed to `onRow` as they are parsed — a 533 MB member is never
   * held, and neither are its rows. Returns false if the member could not be
   * read, so a caller never mistakes an empty pass for an empty file.
   */
  async streamCsv(url: string, entry: ZipEntry, onRow: (row: CsvRow) => void): Promise<boolean> {
    const parser = createCsvParser(onRow);
    const ok = await streamZipMember(url, entry, this.rangeOptions(), (text) => parser.write(text));
    if (!ok) {
      this.logger.warn(`Failed to read ${entry.name} from ${url}`);
      return false;
    }
    parser.end();
    return true;
  }

  private rangeOptions() {
    return {
      userAgent: this.userAgent,
      encoding: ENCODING,
      throttle: () => this.throttle(),
    };
  }

  private async fetchIndex(): Promise<string | null> {
    await this.throttle();
    try {
      const res = await fetch(ADV_ARCHIVE_INDEX_URL, {
        headers: { 'User-Agent': this.userAgent, Accept: '*/*' },
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`GET ${ADV_ARCHIVE_INDEX_URL} -> ${res.status}`);
        return null;
      }
      return await res.text();
    } catch (err) {
      this.logger.warn(`GET ${ADV_ARCHIVE_INDEX_URL} failed: ${String(err)}`);
      return null;
    }
  }

  /** Same start-throttling contract as EdgarClient and AdvClient — the SEC's
   *  rate limit is per-IP across every sec.gov host. */
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
 * Pair the Form ADV Part 1 data archives linked from the FOIA page.
 *
 * Filenames encode the range they cover
 * (`adv-filing-data-20111105-20241231-part1.zip`) and the SEC re-cuts them
 * occasionally, so the page is scraped and the newest range wins. The
 * 2000-10-19 → 2011-11-04 archive is deliberately excluded: Schedule D
 * 7.B.(1) did not exist before the 2011 Form ADV revision, which is exactly
 * why the current archive starts on 2011-11-05.
 */
export function parseAdvArchives(html: string): AdvArchive[] {
  const hrefs = [...html.matchAll(/href="([^"]+\.zip)"/gi)].map((m) => m[1]!);

  const pairs = new Map<string, { part1?: string; part2?: string }>();
  for (const href of hrefs) {
    const file = href.split('/').pop() ?? '';
    const match = /^adv-filing-data-(\d{8})-(\d{8})-part([12])\.zip$/i.exec(file);
    if (!match) continue;

    const [, from, to, part] = match;
    // Schedule D 7.B.(1) is a creature of the 2011 Form ADV revision; an
    // archive that ends before it existed has no funds in it at all.
    if (Number(to) < 20111105) continue;

    const label = `${from}-${to}`;
    const entry = pairs.get(label) ?? {};
    const url = href.startsWith('http') ? href : `${SEC_ORIGIN}${href}`;
    if (part === '1') entry.part1 ??= url;
    else entry.part2 ??= url;
    pairs.set(label, entry);
  }

  // Both halves are required: the base files live in part1 and the IA
  // Schedule D in part2, so half a pair yields no usable join.
  return [...pairs.entries()]
    .filter(([, v]) => v.part1 && v.part2)
    .map(([label, v]) => ({ label, part1: v.part1!, part2: v.part2! }))
    .sort((a, b) => b.label.localeCompare(a.label));
}
