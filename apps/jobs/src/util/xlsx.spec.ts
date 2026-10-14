import { describe, it, expect } from '@jest/globals';
import { strToU8, zipSync } from 'fflate';

import { decodeXmlText, parseSharedStrings, readXlsx, type XlsxRow } from './xlsx';

const SHARED = `<?xml version="1.0"?><sst count="4" uniqueCount="4">
<si><t>Participant Name</t></si>
<si><t>CRN</t></si>
<si><r><t>ACME </t></r><r><t xml:space="preserve">&amp; SONS LTD</t></r></si>
<si/>
</sst>`;

const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Award Offered (£)</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="str"><v>05002194</v></c><c r="C2"><v>425000.5</v></c></row>
<row r="3" spans="1:3"/>
<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4"><v>12</v></c></row>
</sheetData></worksheet>`;

function workbook(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('readXlsx', () => {
  it('reads shared, inline and numeric cells keyed by the header row', () => {
    const rows: XlsxRow[] = [];
    const headers = readXlsx(
      workbook({ 'xl/sharedStrings.xml': SHARED, 'xl/worksheets/sheet1.xml': SHEET }),
      (r) => rows.push(r),
    );

    expect(headers).toEqual(['Participant Name', 'CRN', 'Award Offered (£)']);
    expect(rows).toEqual([
      { 'Participant Name': 'ACME & SONS LTD', CRN: '05002194', 'Award Offered (£)': '425000.5' },
      // A missing cell is an empty string, not an absent key.
      { 'Participant Name': '', CRN: '', 'Award Offered (£)': '12' },
    ]);
  });

  it('reads a sheet that arrives over many inflate chunks', () => {
    // Big enough that fflate hands it over in several pieces, so rows straddle
    // chunk boundaries.
    const body = Array.from(
      { length: 5000 },
      (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>firm ${i}</t></is></c></row>`,
    ).join('');
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>${body}</sheetData></worksheet>`;
    const rows: XlsxRow[] = [];
    readXlsx(workbook({ 'xl/worksheets/sheet1.xml': sheet }), (r) => rows.push(r));
    expect(rows).toHaveLength(5000);
    expect(rows[4999]).toEqual({ Name: 'firm 4999' });
  });

  it('returns null for an archive with no worksheet', () => {
    expect(readXlsx(workbook({ 'other.txt': 'x' }), () => {})).toBeNull();
  });
});

describe('xml text', () => {
  it('decodes entities and Excel control escapes', () => {
    expect(decodeXmlText('A &amp; B &lt;c&gt; &#163;5 &#x20AC;6 line_x000D_')).toBe('A & B <c> £5 €6 line\r');
  });

  it('keeps an empty shared string in its slot', () => {
    expect(parseSharedStrings(SHARED)).toEqual(['Participant Name', 'CRN', 'ACME & SONS LTD', '']);
  });
});
