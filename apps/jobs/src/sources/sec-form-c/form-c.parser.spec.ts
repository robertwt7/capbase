import { describe, it, expect } from '@jest/globals';

import { parseFormCQuarters } from './form-c.client';
import {
  T_DISCLOSURE,
  T_ISSUER,
  T_SIGNATURE,
  T_SUBMISSION,
  cleanSignature,
  groupOfferings,
  isoFilingDate,
  num,
  parseTsv,
  unpadCik,
  type FormCTables,
} from './form-c.parser';

/** Header + rows copied from a real FORM_C_SUBMISSION.tsv. */
const SUBMISSION_TSV = [
  'ACCESSION_NUMBER\tSUBMISSION_TYPE\tFILING_DATE\tCIK\tFILE_NUMBER\tPERIOD',
  '0001779469-26-000002\tC-AR\t20260630\t0001779469\t020-25453\t20241231',
  '0001669191-26-000208\tC/A\t20260630\t0001898169\t020-37188\t',
  '',
].join('\n');

describe('parseTsv', () => {
  it('reads the header and trims every cell', () => {
    const rows = parseTsv(SUBMISSION_TSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      ACCESSION_NUMBER: '0001779469-26-000002',
      SUBMISSION_TYPE: 'C-AR',
      FILING_DATE: '20260630',
      CIK: '0001779469',
      FILE_NUMBER: '020-25453',
      PERIOD: '20241231',
    });
  });

  it('keeps a double quote as a literal character', () => {
    // Verified across all 268 .tsv members: `"` is data, never a delimiter, so a
    // quote-aware reader would corrupt these names.
    const rows = parseTsv('A\tB\n"He said "hi""\tx\n');
    expect(rows[0]!.A).toBe('"He said "hi""');
    expect(rows[0]!.B).toBe('x');
  });

  it('skips blank lines and tolerates CRLF', () => {
    expect(parseTsv('A\tB\r\n1\t2\r\n\r\n')).toEqual([{ A: '1', B: '2' }]);
  });

  it('returns nothing for an empty table', () => {
    expect(parseTsv('')).toEqual([]);
  });
});

/** Build the four tables from compact tuples, so a case reads as data. */
function tables(input: {
  submissions: [string, string, string, string, string][];
  issuer?: Record<string, Record<string, string>>;
  disclosure?: Record<string, Record<string, string>>;
  signatures?: [string, string, string][];
}): FormCTables {
  return {
    [T_SUBMISSION]: input.submissions.map(
      ([ACCESSION_NUMBER, SUBMISSION_TYPE, FILING_DATE, CIK, FILE_NUMBER]) => ({
        ACCESSION_NUMBER,
        SUBMISSION_TYPE,
        FILING_DATE,
        CIK,
        FILE_NUMBER,
      }),
    ),
    [T_ISSUER]: Object.entries(input.issuer ?? {}).map(([acc, row]) => ({
      ACCESSION_NUMBER: acc,
      ...row,
    })),
    [T_DISCLOSURE]: Object.entries(input.disclosure ?? {}).map(([acc, row]) => ({
      ACCESSION_NUMBER: acc,
      ...row,
    })),
    [T_SIGNATURE]: (input.signatures ?? []).map(
      ([ACCESSION_NUMBER, PERSONSIGNATURE, PERSONTITLE]) => ({
        ACCESSION_NUMBER,
        PERSONSIGNATURE,
        PERSONTITLE,
      }),
    ),
  };
}

describe('groupOfferings', () => {
  it('groups every filing of one offering by FILE_NUMBER', () => {
    const offerings = groupOfferings(
      tables({
        submissions: [
          ['acc-c', 'C', '20240101', '0000012345', '020-11111'],
          ['acc-a', 'C/A', '20240215', '0000012345', '020-11111'],
          ['acc-u', 'C-U', '20240630', '0000012345', '020-11111'],
        ],
        issuer: {
          'acc-c': { NAMEOFISSUER: 'Acme Brewing, LLC' },
          'acc-a': { NAMEOFISSUER: 'Acme Brewing, LLC' },
          'acc-u': { PROGRESSUPDATE: 'Total Amount Raised: $50,000' },
        },
      }),
    );

    expect(offerings).toHaveLength(1);
    const [offering] = offerings;
    expect(offering!.fileNumber).toBe('020-11111');
    // The latest C/A wins, not the original C.
    expect(offering!.offering.accession).toBe('acc-a');
    expect(offering!.offering.filedAt).toBe('2024-02-15');
    expect(offering!.progress?.accession).toBe('acc-u');
  });

  it('collapses three C-U filings into one offering, taking the latest', () => {
    // 589 offerings have more than one progress update (up to 13). Keying the
    // round on a C-U accession would split one raise into thirteen rounds.
    const offerings = groupOfferings(
      tables({
        submissions: [
          ['acc-c', 'C', '20220101', '0000099', '020-22222'],
          ['u1', 'C-U', '20220601', '0000099', '020-22222'],
          ['u2', 'C-U', '20220901', '0000099', '020-22222'],
          ['u3', 'C-U', '20221201', '0000099', '020-22222'],
        ],
      }),
    );

    expect(offerings).toHaveLength(1);
    expect(offerings[0]!.progress?.accession).toBe('u3');
    expect(offerings[0]!.progress?.filedAt).toBe('2022-12-01');
  });

  it('drops a file number with no C or C/A behind it', () => {
    const offerings = groupOfferings(
      tables({
        submissions: [['acc-ar', 'C-AR', '20240101', '0000099', '020-33333']],
      }),
    );
    expect(offerings).toEqual([]);
  });

  it('ignores withdrawal filings when picking the offering and its update', () => {
    const offerings = groupOfferings(
      tables({
        submissions: [
          ['acc-c', 'C', '20240101', '0000099', '020-44444'],
          ['acc-w', 'C/A-W', '20240301', '0000099', '020-44444'],
          ['acc-uw', 'C-U-W', '20240401', '0000099', '020-44444'],
        ],
      }),
    );
    expect(offerings[0]!.offering.accession).toBe('acc-c');
    expect(offerings[0]!.progress).toBeUndefined();
  });

  it('collects signers newest-first, deduplicated, with the /s/ prefix stripped', () => {
    const offerings = groupOfferings(
      tables({
        submissions: [
          ['acc-c', 'C', '20240101', '0000099', '020-55555'],
          ['acc-a', 'C/A', '20240601', '0000099', '020-55555'],
        ],
        signatures: [
          ['acc-c', '/s/ Brian Wynne', 'CEO'],
          ['acc-c', 'Matthew Kurke', 'CFO'],
          ['acc-a', '/s/ Brian Wynne', 'Chief Executive Officer'],
        ],
      }),
    );

    expect(offerings[0]!.signers).toEqual([
      { name: 'Brian Wynne', title: 'Chief Executive Officer' },
      { name: 'Matthew Kurke', title: 'CFO' },
    ]);
  });

  it('survives an archive missing a member entirely', () => {
    // FORM_C_COISSUER_INFORMATION.tsv ships in only 22 of 41 archives, and an
    // absent member must be a no-op rather than a crash.
    const offerings = groupOfferings({
      [T_SUBMISSION]: [
        {
          ACCESSION_NUMBER: 'acc-c',
          SUBMISSION_TYPE: 'C',
          FILING_DATE: '20240101',
          CIK: '0000099',
          FILE_NUMBER: '020-66666',
        },
      ],
    });
    expect(offerings).toHaveLength(1);
    expect(offerings[0]!.offering.info).toEqual({});
    expect(offerings[0]!.signers).toEqual([]);
  });
});

describe('field helpers', () => {
  it('converts EDGAR filing dates to ISO', () => {
    expect(isoFilingDate('20260630')).toBe('2026-06-30');
    expect(isoFilingDate('2026-06-30')).toBe('2026-06-30');
    expect(isoFilingDate('')).toBe('');
    expect(isoFilingDate('nonsense')).toBe('');
  });

  it('strips the CIK padding EDGAR adds in bulk tables', () => {
    expect(unpadCik('0001779469')).toBe('1779469');
    expect(unpadCik('1779469')).toBe('1779469');
  });

  it('strips a conformed-signature prefix', () => {
    expect(cleanSignature('/s/ Brian Wynne')).toBe('Brian Wynne');
    expect(cleanSignature('  Jacob   Maddux ')).toBe('Jacob Maddux');
  });

  it('reads the float-formatted money cells, and blank as not-filed', () => {
    expect(num('100000.0')).toBe(100_000);
    expect(num('1,070,000')).toBe(1_070_000);
    expect(num('')).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});

describe('parseFormCQuarters', () => {
  const HTML = `
    <a href="/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip">2026 Q2</a>
    <a href="/files/dera/data/crowdfunding-offerings-data-sets/2016q2_cf.zip">2016 Q2</a>
    <a href="/files/dera/data/crowdfunding-offerings-data-sets/2025q4_cf.zip">2025 Q4</a>
    <a href="/files/dera/data/other/ia07012026.zip">not a crowdfunding archive</a>
  `;

  it('returns crowdfunding archives only, newest first, absolute', () => {
    expect(parseFormCQuarters(HTML)).toEqual([
      {
        label: '2026q2',
        url: 'https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/2026q2_cf.zip',
      },
      {
        label: '2025q4',
        url: 'https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/2025q4_cf.zip',
      },
      {
        label: '2016q2',
        url: 'https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/2016q2_cf.zip',
      },
    ]);
  });

  it('finds nothing on a page that lists no archives', () => {
    expect(parseFormCQuarters('<p>Coming soon</p>')).toEqual([]);
  });
});
