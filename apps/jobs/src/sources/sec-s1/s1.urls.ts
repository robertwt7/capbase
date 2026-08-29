import { SEC_ARCHIVES } from '../sec-edgar/edgar.urls';

/**
 * The S-1 document an ownership edge was read from, addressed by the filer's
 * CIK and the accession — the same archive path the EDGAR client fetched.
 *
 * A holding's `externalId` is `${cik}:holder:${slug}` and carries no accession,
 * so the backfill reads the filing reference off the company row's own
 * provenance rather than guessing one.
 */
export function s1FilingUrl(cik: string, accession: string, file: string): string {
  const bare = cik.replace(/^0+/, '') || cik;
  return `${SEC_ARCHIVES}/edgar/data/${bare}/${accession.replace(/-/g, '')}/${file}`;
}

/** The filer's S-1 filing history — the citation when no specific document is
 *  recorded for the row. */
export function filerS1Url(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=S-1`;
}
