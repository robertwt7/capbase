import { describe, it, expect } from '@jest/globals';

import { parseCsv } from '../../util/csv';
import { titleCaseFirm } from '../../util/text';
import {
  classifyAdvWebsite,
  investorTypeForAdv,
  mapAdvRows,
  type AdvRow,
} from './adv.parser';

/** Header row copied from the real SEC roster file, including the two cells
 *  whose text contains an embedded newline. */
const HEADER = [
  '"Organization CRD#"',
  '"CIK#"',
  '"Primary Business Name"',
  '"Legal Name"',
  '"Main Office City"',
  '"Main Office State"',
  '"Main Office Country"',
  '"SEC Current Status"',
  '"Total number of offices\n other than your Principal Office and place of business"',
  '"Website Address"',
  '"Any VC Funds"',
  '"Total number of VC funds"',
  '"Any PE Funds"',
  '"Total number of PE funds"',
  '"Any Hedge Funds"',
  '"Total number of Hedge funds"',
  '"Total Gross Assets of Private Funds"',
].join(',');

function csvRow(cells: (string | number)[]): string {
  return cells.map((c) => `"${String(c)}"`).join(',');
}

const NEXT_COAST = csvRow([
  '283699', '1234567', 'NEXT COAST VENTURES, LLC', 'NEXT COAST VENTURES GP, LLC',
  'AUSTIN', 'TX', 'United States', 'ERA - Active', '0',
  'HTTP://WWW.NEXTCOASTVENTURES.COM', 'Y', '7', 'N', '0', 'N', '0', '430,428,863.00',
]);

describe('parseCsv', () => {
  it('keeps columns aligned when a header cell contains a newline', () => {
    const rows = parseCsv(`${HEADER}\n${NEXT_COAST}\n`);
    expect(rows).toHaveLength(1);
    // The column AFTER the multi-line header must still line up.
    expect(rows[0]!['Website Address']).toBe('HTTP://WWW.NEXTCOASTVENTURES.COM');
    expect(rows[0]!['Total Gross Assets of Private Funds']).toBe('430,428,863.00');
  });

  it('does not split money values on their thousands separators', () => {
    const rows = parseCsv(`${HEADER}\n${NEXT_COAST}\n`);
    expect(rows[0]!['Organization CRD#']).toBe('283699');
    expect(rows[0]!['Total number of VC funds']).toBe('7');
  });

  it('handles escaped quotes, CRLF line endings and trailing blank lines', () => {
    const text = 'a,b\r\n"say ""hi""","x"\r\n\r\n';
    expect(parseCsv(text)).toEqual([{ a: 'say "hi"', b: 'x' }]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('investorTypeForAdv', () => {
  const row = (over: Partial<AdvRow> = {}): AdvRow => ({
    'Total number of VC funds': '0',
    'Total number of PE funds': '0',
    'Total number of Hedge funds': '0',
    ...over,
  });

  it('picks whichever fund class the firm runs most of', () => {
    expect(investorTypeForAdv(row({ 'Total number of VC funds': '7' }))).toBe('Venture');
    expect(investorTypeForAdv(row({ 'Total number of PE funds': '3' }))).toBe('Private equity');
    expect(investorTypeForAdv(row({ 'Total number of Hedge funds': '2' }))).toBe('Hedge fund');
    expect(
      investorTypeForAdv(row({ 'Total number of VC funds': '2', 'Total number of PE funds': '9' })),
    ).toBe('Private equity');
  });

  it('falls back to the Any-X flags when counts are blank', () => {
    expect(investorTypeForAdv(row({ 'Any VC Funds': 'Y' }))).toBe('Venture');
  });

  it('returns null for a firm with no private funds (a wealth manager)', () => {
    expect(investorTypeForAdv(row())).toBeNull();
  });
});

describe('classifyAdvWebsite', () => {
  it('routes LinkedIn URLs away from the website field', () => {
    // 3,295 registered advisers put a linkedin.com URL here. Treating those as
    // the website would give thousands of firms the same domain, and the ingest
    // matcher keys on domain — they would all collapse into one investor.
    expect(classifyAdvWebsite('https://www.linkedin.com/company/team8')).toEqual({
      websiteUrl: null,
      linkedinUrl: 'https://www.linkedin.com/company/team8',
      domain: null,
    });
  });

  it('drops other social links entirely', () => {
    for (const url of [
      'https://x.com/468Capital',
      'https://twitter.com/foo',
      'https://www.facebook.com/foo',
      'https://www.instagram.com/foo',
      'https://youtube.com/@foo',
    ]) {
      expect(classifyAdvWebsite(url)).toEqual({ websiteUrl: null, linkedinUrl: null, domain: null });
    }
  });

  it('keeps a platform link visible but publishes no domain for it', () => {
    // 21 firms — Founders Fund, Menlo Ventures, Beringea … — list the same
    // medium.com blog. A shared domain would merge them into one investor.
    const medium = classifyAdvWebsite('https://medium.com/@foundersfund');
    expect(medium.websiteUrl).toBe('https://medium.com/@foundersfund');
    expect(medium.domain).toBeNull();

    expect(classifyAdvWebsite('https://www.crunchbase.com/organization/quake').domain).toBeNull();
  });

  it('keeps a real website, its domain, and lowercases the scheme', () => {
    expect(classifyAdvWebsite('HTTP://WWW.NEXTCOASTVENTURES.COM')).toEqual({
      websiteUrl: 'http://WWW.NEXTCOASTVENTURES.COM',
      linkedinUrl: null,
      domain: 'nextcoastventures.com',
    });
    expect(classifyAdvWebsite('up.partners')).toEqual({
      websiteUrl: 'https://up.partners',
      linkedinUrl: null,
      domain: 'up.partners',
    });
  });

  it('rejects junk that is not a hostname', () => {
    for (const junk of ['', '   ', 'linkedin', '@providencewealth', 'saxony']) {
      expect(classifyAdvWebsite(junk)).toEqual({ websiteUrl: null, linkedinUrl: null, domain: null });
    }
  });
});

describe('titleCaseFirm', () => {
  it.each([
    ['NEXT COAST VENTURES, LLC', 'Next Coast Ventures, LLC'],
    ['ANDREESSEN HOROWITZ', 'Andreessen Horowitz'],
    ['A.CAPITAL VENTURES', 'A.Capital Ventures'],
    ['WORK-BENCH MANAGEMENT, LLC', 'Work-Bench Management, LLC'],
    ['468 MANAGEMENT GMBH', '468 Management GMBH'],
    ['SEQUOIA CAPITAL US VENTURE FUND XVI', 'Sequoia Capital US Venture Fund XVI'],
    // Short vowel-less tokens are initialisms, not words.
    ['HPS INVESTMENT PARTNERS, LLC', 'HPS Investment Partners, LLC'],
    ['TPG CAPITAL ADVISORS, LLC', 'TPG Capital Advisors, LLC'],
    ['THOMA BRAVO', 'Thoma Bravo'],
  ])('%s → %s', (input, expected) => {
    expect(titleCaseFirm(input)).toBe(expected);
  });
});

describe('mapAdvRows', () => {
  const rows = (extra = '') => parseCsv(`${HEADER}\n${NEXT_COAST}\n${extra}`);

  it('maps a firm to a normalized investor', () => {
    const [firm] = mapAdvRows(rows(), ['Venture', 'Private equity']);
    expect(firm).toMatchObject({
      externalId: '283699',
      name: 'Next Coast Ventures, LLC',
      legalName: 'Next Coast Ventures GP, LLC',
      type: 'Venture',
      hq: 'Austin, TX, United States',
      websiteUrl: 'http://WWW.NEXTCOASTVENTURES.COM',
      domain: 'nextcoastventures.com',
      crdNumber: '283699',
      cikNumber: '1234567',
      fundCount: 7,
      assetsUsd: 430_428_863,
      foundedYear: null,
    });
    expect(firm!.description).toContain('venture capital firm');
    expect(firm!.description).toContain('Austin, TX, United States');
  });

  it('filters to the requested types', () => {
    expect(mapAdvRows(rows(), ['Private equity'])).toEqual([]);
    expect(mapAdvRows(rows(), ['Venture'])).toHaveLength(1);
  });

  it('drops firms with no private funds and withdrawn registrations', () => {
    const noFunds = csvRow([
      '999', '', 'SOME WEALTH ADVISORS', '', 'DENVER', 'CO', 'United States',
      'Approved', '0', '', 'N', '0', 'N', '0', 'N', '0', '.00',
    ]);
    const withdrawn = csvRow([
      '888', '', 'OLD FUND MANAGEMENT', '', 'NEW YORK', 'NY', 'United States',
      'Withdrawn', '0', '', 'Y', '4', 'N', '0', 'N', '0', '1,000.00',
    ]);
    const mapped = mapAdvRows(rows(`${noFunds}\n${withdrawn}\n`), ['Venture', 'Private equity']);
    expect(mapped.map((f) => f.externalId)).toEqual(['283699']);
  });

  it('treats the SEC placeholder ".00" as no reported assets', () => {
    const blankAssets = csvRow([
      '777', '', 'EARLY STAGE PARTNERS', '', 'BOSTON', 'MA', 'United States',
      'ERA - Active', '0', '', 'Y', '2', 'N', '0', 'N', '0', '                      .00',
    ]);
    const firm = mapAdvRows(rows(`${blankAssets}\n`), ['Venture']).find((f) => f.externalId === '777');
    expect(firm!.assetsUsd).toBeNull();
    expect(firm!.fundCount).toBe(2);
  });

  it('keeps only the first row for a repeated CRD', () => {
    const mapped = mapAdvRows(rows(`${NEXT_COAST}\n`), ['Venture']);
    expect(mapped).toHaveLength(1);
  });

  it('omits legalName when it matches the business name', () => {
    const same = csvRow([
      '555', '', 'TEAM8', 'TEAM8', 'TEL-AVIV', '', 'Israel',
      'ERA - Active', '0', 'https://www.linkedin.com/company/team8', 'Y', '16', 'N', '0', 'N', '0', '1,309,860,073.00',
    ]);
    const firm = mapAdvRows(rows(`${same}\n`), ['Venture']).find((f) => f.externalId === '555')!;
    expect(firm.legalName).toBeNull();
    expect(firm.hq).toBe('Tel-Aviv, Israel');
    // The LinkedIn URL must not have become the website.
    expect(firm.websiteUrl).toBeNull();
    expect(firm.linkedinUrl).toBe('https://www.linkedin.com/company/team8');
  });
});
