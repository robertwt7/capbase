import { describe, it, expect } from '@jest/globals';

import { advFirmUrl, filerFormDUrl, primaryDocUrl } from './edgar.urls';
import { wikidataEntityUrl } from '../wikidata/wikidata.urls';

// These URLs are what a citation link points at, so they are built from the
// identifiers we store rather than fetched. Getting one wrong sends a reader to
// the wrong filing, which is worse than showing no citation at all.
describe('citation source URLs', () => {
  it('addresses a Form D filing by CIK and dash-free accession', () => {
    expect(primaryDocUrl('1318605', '0001318605-24-000123')).toBe(
      'https://www.sec.gov/Archives/edgar/data/1318605/000131860524000123/primary_doc.xml',
    );
  });

  it('accepts an accession that already has no dashes', () => {
    expect(primaryDocUrl('1318605', '000131860524000123')).toBe(
      'https://www.sec.gov/Archives/edgar/data/1318605/000131860524000123/primary_doc.xml',
    );
  });

  it("addresses a filer's Form D history by CIK", () => {
    expect(filerFormDUrl('1318605')).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1318605&type=D',
    );
  });

  it('addresses an adviser by CRD number', () => {
    expect(advFirmUrl('148484')).toBe('https://adviserinfo.sec.gov/firm/summary/148484');
  });

  it('addresses a Wikidata entity by QID', () => {
    expect(wikidataEntityUrl('Q42')).toBe('https://www.wikidata.org/wiki/Q42');
  });
});
