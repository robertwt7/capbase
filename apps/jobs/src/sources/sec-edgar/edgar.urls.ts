// Public SEC URLs derivable from the identifiers we already persist. Shared by
// the EDGAR client (which fetches them) and the citation backfill (which cites
// them), so the two can never drift.

export const SEC_ARCHIVES = 'https://www.sec.gov/Archives';

/** A filing's structured Form D document, from the filer's CIK and the
 *  accession number. EDGAR's archive folders drop the accession's dashes. */
export function primaryDocUrl(cik: string, accession: string): string {
  return `${SEC_ARCHIVES}/edgar/data/${cik}/${accession.replace(/-/g, '')}/primary_doc.xml`;
}

/** The filer's Form D filing history on EDGAR — the right citation for a fact
 *  about the company itself rather than about one offering. */
export function filerFormDUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=D`;
}

/** A firm's Investment Adviser Public Disclosure summary, keyed by CRD number.
 *  IAPD is a client-rendered app, so fetching this URL returns the app shell —
 *  it resolves in a browser, which is where a citation link is followed. */
export function advFirmUrl(crd: string): string {
  return `https://adviserinfo.sec.gov/firm/summary/${crd}`;
}
