import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SEC_ARCHIVES } from '../sec-edgar/edgar.urls';

/**
 * EDGAR full-text search. Its hit `_id` is `accession:filename`, which
 * addresses the document directly — no folder-index round trip. Coverage starts
 * in 2001; S1_START_DATE (default 2015-01-01) bounds the walk further.
 */
const EFTS_URL = 'https://efts.sec.gov/LATEST/search-index';

/** EFTS returns at most 100 hits per request and refuses to page past 10,000,
 *  which is why the walk goes month by month (~270 S-1 documents a month). */
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const MIN_INTERVAL_MS = 160; // ~6 req/s — the SEC's cap is per-IP, all hosts.
const SEARCH_TIMEOUT_MS = 30_000;
/** S-1s average ~800 KB and reach 8 MB. */
const DOCUMENT_TIMEOUT_MS = 120_000;

export interface S1Ref {
  /** Zero-padded CIK of the filer, as EFTS reports it. */
  cik: string;
  accession: string;
  /** Document filename within the filing's archive folder. */
  file: string;
  /** 'S-1' or 'S-1/A'. */
  form: string;
  /** ISO filing date. */
  filedAt: string;
  /** Filer name as EDGAR displays it, minus the trailing "(CIK …)". */
  filer: string;
}

interface EftsHit {
  _id: string;
  _source: {
    ciks?: string[];
    display_names?: string[];
    form?: string;
    file_type?: string;
    file_date?: string;
  };
}

@Injectable()
export class S1Client {
  private readonly logger = new Logger(S1Client.name);
  private readonly userAgent: string;
  private lastRequestAt = 0;

  constructor(config: ConfigService) {
    this.userAgent =
      config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
  }

  /**
   * S-1 and S-1/A documents filed between two ISO dates, newest first.
   *
   * Walked month by month because a single query caps at 10,000 hits, and the
   * primary document is picked out by `file_type`: a hit list also carries the
   * filing's exhibits, which are not prospectuses.
   */
  async listS1Docs(from: string, to: string): Promise<S1Ref[]> {
    const out: S1Ref[] = [];
    const seen = new Set<string>();

    for (const [start, end] of monthWindows(from, to)) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          `${EFTS_URL}?forms=S-1&startdt=${start}&enddt=${end}&from=${page * PAGE_SIZE}`;
        const body = await this.fetchJson(url);
        const hits = (body?.hits?.hits ?? []) as EftsHit[];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const ref = toRef(hit);
          if (!ref || seen.has(ref.accession)) continue;
          seen.add(ref.accession);
          out.push(ref);
        }
        if (hits.length < PAGE_SIZE) break;
      }
    }

    this.logger.log(`${out.length} S-1 documents between ${from} and ${to}`);
    // Newest first, so a bounded run reads the most recent filings.
    return out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  }

  /** The filing document itself. One is held at a time — some are 8 MB. */
  async fetchDocument(ref: S1Ref): Promise<string | null> {
    return this.fetchText(documentUrl(ref));
  }

  private async fetchJson(url: string): Promise<{ hits?: { hits?: unknown[] } } | null> {
    const text = await this.fetchText(url, SEARCH_TIMEOUT_MS, 'application/json');
    if (!text) return null;
    try {
      return JSON.parse(text) as { hits?: { hits?: unknown[] } };
    } catch (err) {
      this.logger.warn(`Bad JSON from ${url}: ${String(err)}`);
      return null;
    }
  }

  private async fetchText(
    url: string,
    timeout = DOCUMENT_TIMEOUT_MS,
    accept = 'text/html,*/*',
  ): Promise<string | null> {
    await this.throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: accept },
        signal: AbortSignal.timeout(timeout),
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

  /** Same start-throttling contract as EdgarClient. */
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

/** The document's archive URL. EDGAR's folder path drops the accession's
 *  dashes and strips the CIK's zero padding. */
export function documentUrl(ref: S1Ref): string {
  const cik = ref.cik.replace(/^0+/, '') || ref.cik;
  return `${SEC_ARCHIVES}/edgar/data/${cik}/${ref.accession.replace(/-/g, '')}/${ref.file}`;
}

/** An EFTS hit, or null when it is an exhibit rather than the prospectus. */
export function toRef(hit: EftsHit): S1Ref | null {
  const [accession, file] = (hit._id ?? '').split(':');
  if (!accession || !file) return null;

  const src = hit._source ?? {};
  const form = (src.form ?? '').trim();
  // A filing's exhibits share its form and date; only the primary document has
  // a file_type matching the form, and only it contains the ownership table.
  if (!src.file_type || src.file_type !== form) return null;
  if (!form.startsWith('S-1')) return null;

  const cik = src.ciks?.[0];
  if (!cik) return null;

  return {
    cik,
    accession,
    file,
    form,
    filedAt: (src.file_date ?? '').trim(),
    filer: (src.display_names?.[0] ?? '').replace(/\s*\(CIK\s+\d+\)\s*$/i, '').trim(),
  };
}

/** Inclusive month-sized [start, end] windows covering [from, to]. */
export function monthWindows(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const finish = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) return out;

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  for (;;) {
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    if (first > finish) break;
    out.push([
      iso(first < start ? start : first),
      iso(last > finish ? finish : last),
    ]);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  // Newest month first, so a bounded run reads the most recent filings.
  return out.reverse();
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
