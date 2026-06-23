import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FormDRef {
  cik: string;
  accession: string;
  companyName: string;
  dateFiled: string;
}

const SEC_BASE = 'https://www.sec.gov/Archives';
const MIN_INTERVAL_MS = 160; // ~6 req/s — comfortably under SEC's 10 req/s limit.

/**
 * Thin client over the free SEC EDGAR archives. Discovers Form D filings from
 * the daily index and fetches each filing's structured primary_doc.xml. All
 * requests carry the SEC-required User-Agent and are serialized + throttled.
 */
@Injectable()
export class EdgarClient {
  private readonly logger = new Logger(EdgarClient.name);
  private readonly userAgent: string;
  private lastRequestAt = 0;

  constructor(config: ConfigService) {
    this.userAgent =
      config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
  }

  /** Form D refs for a given day, walking back up to `lookbackDays` if empty. */
  async listRecentFormD(target: Date, lookbackDays = 5): Promise<FormDRef[]> {
    for (let i = 0; i < lookbackDays; i++) {
      const day = new Date(target);
      day.setUTCDate(day.getUTCDate() - i);
      const refs = await this.listFormDForDay(day);
      if (refs.length > 0) {
        this.logger.log(`Found ${refs.length} Form D filings for ${ymd(day)}`);
        return refs;
      }
    }
    return [];
  }

  private async listFormDForDay(day: Date): Promise<FormDRef[]> {
    const quarter = Math.floor(day.getUTCMonth() / 3) + 1;
    const url = `${SEC_BASE}/edgar/daily-index/${day.getUTCFullYear()}/QTR${quarter}/form.${ymdCompact(day)}.idx`;
    const body = await this.fetchText(url);
    if (!body) return [];
    return parseFormIndex(body);
  }

  /** Fetch a filing's structured Form D document, or null if unavailable. */
  async fetchPrimaryDoc(ref: FormDRef): Promise<string | null> {
    const folder = ref.accession.replace(/-/g, '');
    const url = `${SEC_BASE}/edgar/data/${ref.cik}/${folder}/primary_doc.xml`;
    return this.fetchText(url);
  }

  private async fetchText(url: string): Promise<string | null> {
    await this.throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/xml,text/plain,*/*' },
      });
      if (!res.ok) {
        if (res.status !== 404) this.logger.warn(`GET ${url} -> ${res.status}`);
        return null;
      }
      return await res.text();
    } catch (err) {
      this.logger.warn(`GET ${url} failed: ${String(err)}`);
      return null;
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }
}

/** Parse a daily `form.<date>.idx` file, returning only Form D / D/A rows. */
export function parseFormIndex(body: string): FormDRef[] {
  const refs: FormDRef[] = [];
  const lines = body.split('\n');
  let started = false;

  for (const line of lines) {
    if (!started) {
      // The data section begins after a row of dashes.
      if (/^-{5,}/.test(line)) started = true;
      continue;
    }
    // Columns are separated by runs of 2+ spaces:
    // Form Type | Company Name | CIK | Date Filed | File Name
    const cols = line.split(/\s{2,}/).map((c) => c.trim());
    if (cols.length < 5) continue;
    const formType = cols[0]!;
    const companyName = cols[1]!;
    const cik = cols[2]!;
    const dateFiled = cols[3]!;
    const fileName = cols[4]!;
    if (formType !== 'D' && formType !== 'D/A') continue;

    const base = fileName.split('/').pop() ?? '';
    const accession = base.replace(/\.txt$/, '');
    if (!cik || !accession) continue;
    refs.push({ cik, accession, companyName, dateFiled });
  }
  return refs;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ymdCompact(d: Date): string {
  return ymd(d).replace(/-/g, '');
}
