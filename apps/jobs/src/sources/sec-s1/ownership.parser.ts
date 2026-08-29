export interface OwnershipRow {
  name: string;
  /** Percentage of the class, when the cell parses. */
  percent: number | null;
  shares: number | null;
  /** 0–1 from structural signals only — never from how plausible the name looks. */
  confidence: number;
}

/**
 * The principal-stockholders table from an S-1.
 *
 * Three traps, all met in real 2025 filings:
 *
 * 1. Anchoring on "any table containing a % column" finds the TABLE OF
 *    CONTENTS: page numbers parse as percentages. So the parser locates the
 *    section heading first.
 * 2. The same words appear in prose — "Our principal stockholders and
 *    management own a significant percentage of our stock" is a risk factor,
 *    not the section. So a heading only counts when it is (almost) the whole of
 *    its own text node, which is what a heading structurally is.
 * 3. EDGAR filings are emitted by half a dozen different agents, and plenty of
 *    them still write `<TABLE>`, `<TR>`, `<TD>` in upper case. Every markup
 *    match here is case-insensitive.
 *
 * The tables also mix firms with individual directors and officers, and carry
 * "All executive officers and directors as a group (8 persons)" summary rows,
 * both of which are dropped.
 */

/** Section headings that introduce the beneficial-ownership table. */
const SECTION_SOURCE =
  '(principal\\s+(and\\s+selling\\s+)?(stock|share)holders?' +
  '|security\\s+ownership\\s+of\\s+certain\\s+beneficial\\s+owners' +
  '|beneficial\\s+ownership\\s+of\\s+(our\\s+)?(capital\\s+stock|securities|common\\s+stock))';

/** A header row that names the entity a row is about. */
const OWNER_HEADER_RE =
  /(name\s*(and\s*address)?\s*of\s*(beneficial\s*)?(owner|stockholder|shareholder|holder)|beneficial\s*owner|name\s*of\s*(the\s*)?(reporting|selling))/i;

/** A header row that names an ownership measure. */
const AMOUNT_HEADER_RE =
  /(percent|%|number\s+of\s+shares|shares\s+(beneficially|of)|amount\s+(and\s+nature\s+)?of\s+beneficial)/i;

/** The table of contents lives in the front matter; a real section heading does
 *  not. Everything before this fraction of the document is ignored. */
const FRONT_MATTER_FRACTION = 0.15;

/** How many candidate headings to try before giving up. A long filing repeats
 *  the phrase in cross-references, so the first standalone one is not always
 *  the section. */
const MAX_ANCHORS = 8;

/** How many tables to inspect under one heading. */
const MAX_TABLES_PER_ANCHOR = 6;

/** A heading node is short. Prose containing the same words is not. */
const MAX_HEADING_CHARS = 90;

/** Summary rows that aggregate people rather than name a holder. Every S-1
 *  ownership table ends with one — "All executive officers and directors as a
 *  group (8 persons)" — and it is a total, not a holder. */
const GROUP_ROW_RE =
  /(as\s+a\s+group|^all\s+(of\s+)?(our\s+)?(current\s+)?(named\s+)?(executive\s+)?(officers|directors|employees)|^total\b)/i;

/** Affiliation prefixes an S-1 wraps a firm's name in. */
const AFFILIATION_PREFIX_RE =
  /^(entities|entity|investment\s+funds?|funds?|affiliates?|certain\s+entities|shares?\s+held\s+by)\s+(affiliated\s+with|associated\s+with|of|managed\s+by|advised\s+by)\s+/i;

/** Legal-entity tokens: the structural signal that a holder is a firm rather
 *  than a director in the same table. */
const ENTITY_TOKEN_RE =
  /\b(LLC|L\.L\.C\.|LP|L\.P\.|LLP|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|N\.V\.|B\.V\.|S\.A\.|GmbH|PLC|Trust|Fund|Funds|Partners|Partnership|Capital|Ventures?|Holdings?|Associates|Advisors?|Advisers?|Management|Group|Company)\b/i;

export function isEntityName(name: string): boolean {
  return ENTITY_TOKEN_RE.test(name);
}

/** Weights, all structural. They sum to 1.0 for a row in a properly anchored
 *  table that parsed a percentage and names a legal entity. */
const W_SECTION = 0.4;
const W_OWNER_HEADER = 0.2;
const W_PERCENT = 0.2;
const W_ENTITY = 0.2;

export function parseOwnership(html: string): OwnershipRow[] {
  for (const anchor of sectionAnchors(html)) {
    for (const table of tablesAfter(html, anchor)) {
      const rows = parseTable(table);
      if (rows.length < 2) continue;

      const head = rows.slice(0, 3).map((r) => r.join(' '));
      if (!head.some((r) => AMOUNT_HEADER_RE.test(r))) continue;

      const out = toOwnershipRows(rows, head.some((r) => OWNER_HEADER_RE.test(r)));
      if (out.length > 0) return out;
    }
  }
  return [];
}

/**
 * Offsets of every standalone occurrence of a section heading past the front
 * matter, in document order.
 *
 * "Standalone" is the structural test that separates the heading from the prose
 * that quotes it: a heading is (almost) the entire text of its own node, while
 * the risk factor "Our principal stockholders and management own a significant
 * percentage of our stock…" is a sentence.
 */
function sectionAnchors(html: string): number[] {
  const floor = Math.floor(html.length * FRONT_MATTER_FRACTION);
  const out: number[] = [];
  for (const match of html.matchAll(new RegExp(SECTION_SOURCE, 'gi'))) {
    const at = match.index ?? -1;
    if (at < floor) continue;

    // The enclosing text node: back to the last '>' and on to the next '<'.
    const start = html.lastIndexOf('>', at) + 1;
    const endTag = html.indexOf('<', at);
    const node = cleanText(html.slice(start, endTag < 0 ? html.length : endTag));
    if (node.length > MAX_HEADING_CHARS) continue;

    // A table-of-contents row is the heading plus a page number; a section
    // heading is the heading alone. Both are headings for our purposes — what
    // matters is that neither is a sentence.
    const bare = node.replace(/[\s.·—–-]*\d+\s*$/, '').replace(/[^A-Za-z\s]/g, ' ').trim();
    if (!new RegExp(`^${SECTION_SOURCE}`, 'i').test(bare)) continue;

    out.push(endTag < 0 ? at : endTag);
    if (out.length >= MAX_ANCHORS) break;
  }
  return out;
}

const TABLE_OPEN_RE = /<table\b/gi;
const TABLE_CLOSE_RE = /<\/table\s*>/gi;

/** Up to `MAX_TABLES_PER_ANCHOR` `<table>` blocks starting at `from`. */
function* tablesAfter(html: string, from: number): Generator<string> {
  let cursor = from;
  for (let i = 0; i < MAX_TABLES_PER_ANCHOR; i++) {
    TABLE_OPEN_RE.lastIndex = cursor;
    const open = TABLE_OPEN_RE.exec(html);
    if (!open) return;
    TABLE_CLOSE_RE.lastIndex = open.index;
    const close = TABLE_CLOSE_RE.exec(html);
    if (!close) return;
    yield html.slice(open.index, close.index);
    cursor = close.index + close[0].length;
  }
}

/** Cell text of every row in one table, tags stripped and entities decoded. */
function parseTable(table: string): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)) {
      cells.push(cleanText(cellMatch[1]!));
    }
    // Layout tables of empty spacer cells carry no information.
    if (cells.some((c) => c !== '')) rows.push(mergeSymbolCells(cells));
  }
  return rows;
}

/**
 * EDGAR's table generators put the `%` and `$` symbols in their own columns:
 * a row reads `| Name | | 1,234,567 | | 7.3 | % |`. Fold each symbol back into
 * its number so a cell is a value again.
 */
function mergeSymbolCells(cells: string[]): string[] {
  const out: string[] = [];
  for (const cell of cells) {
    const last = out.length - 1;
    if ((cell === '%' || cell === ')%') && last >= 0 && /\d/.test(out[last]!)) {
      out[last] = `${out[last]}%`;
      continue;
    }
    if (cell === '$' || cell === '') {
      out.push(cell);
      continue;
    }
    out.push(cell);
  }
  return out;
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#8217;|&rsquo;|&#146;|&#39;/gi, "'")
    .replace(/&#8212;|&mdash;|&#8211;|&ndash;|&#151;|&#150;/gi, '—')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function toOwnershipRows(rows: string[][], namesOwner: boolean): OwnershipRow[] {
  const out: OwnershipRow[] = [];
  const seen = new Set<string>();

  for (const cells of rows) {
    const raw = cells[0] ?? '';
    // Group headings ("5% Stockholders:") label a block; they hold nothing.
    if (raw.trim().endsWith(':')) continue;

    const name = cleanHolderName(raw);
    if (!name || name.length < 3) continue;
    if (GROUP_ROW_RE.test(name)) continue;
    if (OWNER_HEADER_RE.test(name) || AMOUNT_HEADER_RE.test(name)) continue;

    const rest = cells.slice(1);
    const percent = firstPercent(rest);
    const shares = firstShares(rest);
    // A row with neither measure is a spacer or a footnote, not a holder.
    if (percent === null && shares === null) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      percent,
      shares,
      confidence:
        W_SECTION +
        (namesOwner ? W_OWNER_HEADER : 0) +
        (percent !== null ? W_PERCENT : 0) +
        (ENTITY_TOKEN_RE.test(name) ? W_ENTITY : 0),
    });
  }
  return out;
}

/** Strip footnote markers and the affiliation wrapper an S-1 puts around a
 *  firm's name: "Entities affiliated with New Enterprise Associates(5)" is a
 *  holding by New Enterprise Associates. */
export function cleanHolderName(raw: string): string {
  let name = raw
    .replace(/\s+/g, ' ')
    .trim()
    // Footnote markers: "Baker Hughes Holdings LLC(5)", "FMR LLC (1)(2)", "…*".
    .replace(/\s*(\(\s*\d+\s*\)\s*)+$/g, '')
    .replace(/\s*[*†‡]+$/g, '')
    .replace(/\s*\(\s*\d+\s*\)(?=\s|$)/g, ' ')
    .trim();

  name = name.replace(AFFILIATION_PREFIX_RE, '').trim();
  // Footnote references rendered as bare trailing numbers rather than in
  // parentheses: "RedHawk Acquisition One, LLC 3, 5, 6". Capped at two digits
  // so a vintage year ("Sequoia Capital 2010") survives.
  name = name.replace(/[\s,]+\d{1,2}(\s*,\s*\d{1,2})*$/, '').trim();
  // A trailing gloss the filer added: "… LLC (our sponsor)".
  name = name.replace(/\s*\((?:[^()]*[a-z][^()]*)\)\s*$/, (m) => (/[A-Z]{2,}/.test(m) ? m : ' ')).trim();
  // A trailing address line the filer put in the same cell.
  name = name
    .replace(
      /\s*,?\s*\d{1,6}\s+[A-Z][\w.]*\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Drive|Dr\.|Boulevard|Blvd\.|Lane|Way|Suite|Floor).*$/i,
      '',
    )
    .trim();
  return name.replace(/\s*[,.;]$/, '').trim();
}

/** '—' is zero and '*' is "less than 1%"; both are real answers, not misses. */
function firstPercent(cells: string[]): number | null {
  for (const cell of cells) {
    const value = cell.trim();
    if (!value) continue;
    if (value === '—' || value === '-' || value === '–') return 0;
    if (value === '*') return 0.5;
    const match = /^\(?\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\)?$/.exec(value);
    if (match) return Number(match[1]);
  }
  return null;
}

function firstShares(cells: string[]): number | null {
  for (const cell of cells) {
    const value = cell.trim();
    if (!value || value.includes('%')) continue;
    const match = /^\(?\s*([\d,]{4,})\s*\)?$/.exec(value);
    if (match) {
      const n = Number(match[1]!.replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}
