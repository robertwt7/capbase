import { Unzip, UnzipInflate } from 'fflate';

/**
 * A minimal reader for the first worksheet of an .xlsx file.
 *
 * Deliberately not a DOM parse, and never one whole member at a time. The
 * Innovate UK file is ~24 MB zipped but ~96 MB of XML (a 53 MB sheet plus 43 MB
 * of shared strings); a generic XML parser turns that into millions of objects,
 * and even holding the decoded sheet as one string costs ~100 MB. Each member is
 * inflated as a stream and scanned element by element: only the shared-string
 * table and one chunk's worth of XML are ever resident, and one plain row at a
 * time reaches the callback.
 *
 * It reads what a data export contains — shared strings, inline strings,
 * numbers and booleans — and nothing a data export does not: no formulas, no
 * dates-from-styles (a date arrives as its Excel serial number, as stored).
 */

export type XlsxRow = Record<string, string>;

const SHEET = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS = 'xl/sharedStrings.xml';

/**
 * Inflate one member as a stream, handing `onElements` text that holds only
 * whole `<tag …>` elements (plus whatever precedes the first). Everything from
 * the last opening `<tag` on is held back until the next chunk completes it.
 * Returns false when the archive has no such member.
 */
function scanMember(zip: Uint8Array, name: string, tag: string, onElements: (xml: string) => void): boolean {
  const open = `<${tag}`;
  const decoder = new TextDecoder('utf-8');
  let found = false;
  let pending = '';

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== name) return;
    found = true;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      pending += decoder.decode(chunk, { stream: !final });
      const cut = final ? pending.length : pending.lastIndexOf(open);
      if (cut > 0) {
        onElements(pending.slice(0, cut));
        pending = pending.slice(cut);
      }
      if (final && pending) {
        onElements(pending);
        pending = '';
      }
    };
    file.start();
  };
  // UnzipInflate is synchronous: every ondata above has run when this returns.
  unzip.push(zip, true);
  return found;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML entities, plus Excel's own `_x000D_` escape for control characters. */
export function decodeXmlText(raw: string): string {
  return raw
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ENTITIES[e]!,
    )
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Concatenate every `<t>` run — a rich-text string is split across several. */
function textRuns(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXmlText(out);
}

export function parseSharedStrings(xml: string, out: string[] = []): string[] {
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(m[1] ? textRuns(m[1]) : '');
  return out;
}

/** "AB12" → 27 (zero-based column). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** One `<row>` body → cells by column index. A cell with no `r` takes the
 *  next column, which is what the format specifies. */
function parseRow(body: string, strings: string[]): Map<number, string> {
  const cells = new Map<number, string>();
  let next = 0;
  for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
    const col = ref ? columnIndex(ref) : next;
    next = col + 1;

    const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    let value = '';
    if (type === 's') value = v !== undefined ? (strings[Number(v)] ?? '') : '';
    else if (type === 'inlineStr') value = textRuns(inner);
    else if (v !== undefined) value = decodeXmlText(v);
    cells.set(col, value.trim());
  }
  return cells;
}

/**
 * Read the first worksheet: its first row is the header, every later row is
 * handed to `onRow` keyed by header. Returns the (trimmed) headers, or null when
 * the archive is not a workbook.
 */
export function readXlsx(zip: Uint8Array, onRow: (row: XlsxRow) => void): string[] | null {
  // Two passes over the archive: the sheet precedes the shared strings in
  // Excel's member order, and its cells are indexes into them.
  const strings: string[] = [];
  scanMember(zip, SHARED_STRINGS, 'si', (xml) => parseSharedStrings(xml, strings));

  let headers: string[] | null = null;
  const found = scanMember(zip, SHEET, 'row', (xml) => {
    // `<row …/>` is an empty row; matching it explicitly stops the body
    // pattern from running on into the next row's cells.
    for (const m of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = parseRow(m[1] ?? '', strings);
      if (!headers) {
        const width = Math.max(-1, ...cells.keys()) + 1;
        headers = Array.from({ length: width }, (_, i) => cells.get(i) ?? '');
        continue;
      }
      if (cells.size === 0) continue;
      const row: XlsxRow = {};
      headers.forEach((h, i) => {
        if (h) row[h] = cells.get(i) ?? '';
      });
      onRow(row);
    }
  });
  if (!found) return null;
  return headers ?? [];
}
