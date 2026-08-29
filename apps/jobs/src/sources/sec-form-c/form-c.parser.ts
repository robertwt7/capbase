export const SEC_FORM_C = 'SEC_FORM_C';

export type Row = Record<string, string>;

/** The tables one quarterly archive publishes, keyed by bare filename. */
export type FormCTables = Record<string, Row[]>;

export const T_SUBMISSION = 'FORM_C_SUBMISSION.TSV';
export const T_ISSUER = 'FORM_C_ISSUER_INFORMATION.TSV';
export const T_DISCLOSURE = 'FORM_C_DISCLOSURE.TSV';
export const T_SIGNATURE = 'FORM_C_SIGNATURE.TSV';

/**
 * Tab-separated reader for the DERA Form C tables.
 *
 * Deliberately NOT the RFC 4180 reader `adv.parser.ts` needs: verified across
 * all 41 quarterly archives (268 .tsv members) that every data line carries
 * exactly the header's tab count — no embedded newlines, no embedded tabs, and
 * `"` is a literal character rather than a delimiter. A line split is correct
 * here, and a quote-aware parser would corrupt names containing a quote.
 */
export function parseTsv(text: string): Row[] {
  // Strip a UTF-8 BOM if one slipped through.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = src.split('\n');
  const header = lines.shift();
  if (!header) return [];
  const keys = header.replace(/\r$/, '').split('\t').map((k) => k.trim());

  const rows: Row[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.replace(/\r$/, '').split('\t');
    const row: Row = {};
    for (const [i, key] of keys.entries()) row[key] = (cells[i] ?? '').trim();
    rows.push(row);
  }
  return rows;
}

/** One Regulation Crowdfunding offering, assembled from every filing that
 *  shares its EDGAR file number. */
export interface FormCOffering {
  /** '020-22903' — the offering identity. Present on 100% of submission rows,
   *  and the only key that groups a C with its C/A amendments and C-U progress
   *  updates. */
  fileNumber: string;
  /** Stored UNPADDED, matching the CIK form SEC_EDGAR already uses, so a later
   *  identifier crosswalk is a plain join. */
  cik: string;
  /** Latest C / C/A filing for this offering. */
  offering: FormCFiling;
  /** Latest C-U, when the offering has one. 589 offerings have several — up to
   *  13 — so the round keys on the file number and takes the last update. */
  progress?: FormCFiling;
  /** Signing officers, newest filing first, deduplicated by name. */
  signers: { name: string; title: string }[];
}

export interface FormCFiling {
  accession: string;
  /** ISO date (YYYY-MM-DD). */
  filedAt: string;
  info: Row;
  disclosure: Row;
}

/** The filing types that carry the offering's own details. Withdrawals (`-W`)
 *  and annual reports (`C-AR`) describe something else. */
const OFFERING_TYPES = new Set(['C', 'C/A']);
const PROGRESS_TYPE = 'C-U';

/**
 * Group every filing in the (merged) tables into one entry per offering.
 *
 * Callers merge all quarters before calling this: an offering's C is filed in
 * one quarter and its C-U often lands two years later, so grouping per archive
 * would split them.
 */
export function groupOfferings(tables: FormCTables): FormCOffering[] {
  const info = byAccession(tables[T_ISSUER] ?? []);
  const disclosure = byAccession(tables[T_DISCLOSURE] ?? []);

  const signaturesByAccession = new Map<string, Row[]>();
  for (const row of tables[T_SIGNATURE] ?? []) {
    const acc = row.ACCESSION_NUMBER ?? '';
    if (!acc) continue;
    const list = signaturesByAccession.get(acc);
    if (list) list.push(row);
    else signaturesByAccession.set(acc, [row]);
  }

  const groups = new Map<string, Row[]>();
  for (const row of tables[T_SUBMISSION] ?? []) {
    const fileNumber = (row.FILE_NUMBER ?? '').trim();
    if (!fileNumber) continue;
    const list = groups.get(fileNumber);
    if (list) list.push(row);
    else groups.set(fileNumber, [row]);
  }

  const out: FormCOffering[] = [];
  for (const [fileNumber, submissions] of groups) {
    // Newest first, so "the latest filing of type X" is just the first match.
    const sorted = [...submissions].sort(
      (a, b) => (b.FILING_DATE ?? '').localeCompare(a.FILING_DATE ?? ''),
    );

    const offeringRow = sorted.find((s) => OFFERING_TYPES.has(s.SUBMISSION_TYPE ?? ''));
    if (!offeringRow) continue; // an annual report with no offering behind it

    const progressRow = sorted.find((s) => s.SUBMISSION_TYPE === PROGRESS_TYPE);

    const signers: { name: string; title: string }[] = [];
    const seenSigner = new Set<string>();
    for (const submission of sorted) {
      for (const sig of signaturesByAccession.get(submission.ACCESSION_NUMBER ?? '') ?? []) {
        const name = cleanSignature(sig.PERSONSIGNATURE ?? '');
        const key = name.toLowerCase();
        if (!name || seenSigner.has(key)) continue;
        seenSigner.add(key);
        signers.push({ name, title: (sig.PERSONTITLE ?? '').trim() });
      }
    }

    out.push({
      fileNumber,
      cik: unpadCik(offeringRow.CIK ?? ''),
      offering: toFiling(offeringRow, info, disclosure),
      ...(progressRow ? { progress: toFiling(progressRow, info, disclosure) } : {}),
      signers,
    });
  }

  return out;
}

function toFiling(
  submission: Row,
  info: Map<string, Row>,
  disclosure: Map<string, Row>,
): FormCFiling {
  const accession = submission.ACCESSION_NUMBER ?? '';
  return {
    accession,
    filedAt: isoFilingDate(submission.FILING_DATE ?? ''),
    info: info.get(accession) ?? {},
    disclosure: disclosure.get(accession) ?? {},
  };
}

function byAccession(rows: Row[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const row of rows) {
    const acc = row.ACCESSION_NUMBER ?? '';
    if (acc && !out.has(acc)) out.set(acc, row);
  }
  return out;
}

/** `20260630` → `2026-06-30`. Returns '' for anything else, so a caller can
 *  fall back rather than mint an Invalid Date. */
export function isoFilingDate(value: string): string {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return '';
}

/** EDGAR pads CIKs to 10 digits in the bulk tables; SEC_EDGAR stores them bare. */
export function unpadCik(cik: string): string {
  return cik.trim().replace(/^0+/, '') || cik.trim();
}

/** ~6% of signature rows carry a `/s/ ` conformed-signature prefix. */
export function cleanSignature(value: string): string {
  return value
    .trim()
    .replace(/^\/s\/\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Numeric cell → number. The Form C money columns are written as floats
 *  ("100000.0"); a blank cell means "not filed", not zero. */
export function num(value: string | undefined): number | null {
  const cleaned = (value ?? '').replace(/[,\s$]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
