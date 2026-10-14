import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { readXlsx, type XlsxRow } from '../../util/xlsx';
import { REQUIRED_HEADERS } from './innovate-uk.parser';
import { INNOVATE_UK_DATASET_URL } from './innovate-uk.urls';

/** The UKRI publication page that links the two funded-projects workbooks. */
export const INNOVATE_UK_PAGE = INNOVATE_UK_DATASET_URL;

const REQUEST_TIMEOUT_MS = 300_000; // ~24 MB + ~9 MB workbooks

/** Every `.xlsx` link on the page, absolute, in page order, once each. */
export function parseWorkbookLinks(html: string, base: string = INNOVATE_UK_PAGE): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.xlsx)["']/gi)) {
    const url = new URL(m[1]!.replace(/&amp;/g, '&'), base).toString();
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * Innovate UK's "funded projects since 2004" data: two workbooks (2004 →
 * FY2015/16, and FY2016/17 → present), refreshed in place behind one stable
 * UKRI page. The file names change on every refresh, so the page is scraped for
 * them rather than pinning a URL.
 */
@Injectable()
export class InnovateUkClient {
  private readonly logger = new Logger(InnovateUkClient.name);
  private readonly userAgent: string;

  constructor(config: ConfigService) {
    this.userAgent = config.get<string>('SEC_USER_AGENT') ?? 'capbase-ingest (contact@example.com)';
  }

  /**
   * Hand every participation row of every workbook to `onRow`.
   *
   * Throws when the page lists no workbook or a workbook lacks a required
   * column: both mean the publication moved or changed shape, and a run that
   * ingested nothing would look like a quiet success.
   */
  async streamRows(onRow: (row: XlsxRow) => void): Promise<{ files: string[]; rows: number }> {
    const html = await this.fetchText(INNOVATE_UK_PAGE);
    const links = parseWorkbookLinks(html);
    if (links.length === 0) {
      throw new Error(`No .xlsx links on ${INNOVATE_UK_PAGE} — the publication page moved`);
    }

    let rows = 0;
    for (const url of links) {
      const zip = await this.fetchBytes(url);
      let fileRows = 0;
      const headers = readXlsx(zip, (row) => {
        fileRows++;
        onRow(row);
      });
      const missing = REQUIRED_HEADERS.filter((h) => !headers?.includes(h));
      if (!headers || missing.length) {
        throw new Error(`${url} is missing required columns: ${missing.join(', ') || 'no worksheet'}`);
      }
      this.logger.log(`${url.split('/').pop()}: ${fileRows} participation rows`);
      rows += fileRows;
    }
    return { files: links, rows };
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.text();
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
