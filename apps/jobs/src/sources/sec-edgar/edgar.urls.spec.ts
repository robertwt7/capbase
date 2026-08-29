import { describe, it, expect } from '@jest/globals';

import {
  advFirmUrl,
  filerFormCUrl,
  filerFormDUrl,
  formCOfferingUrl,
  primaryDocUrl,
} from './edgar.urls';
import { SBIR_AWARD_DATA_URL, awardReference } from '../sbir/sbir.urls';
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

  it("addresses a Reg CF issuer's Form C history by CIK", () => {
    expect(filerFormCUrl('1779469')).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1779469&type=C',
    );
  });

  it('addresses one Reg CF offering by its EDGAR file number', () => {
    // The file number, not any one accession: an offering can have up to 13
    // C-U progress updates and they are all the same offering.
    expect(formCOfferingUrl('020-22903')).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=020-22903&type=C',
    );
  });

  it('addresses an adviser by CRD number', () => {
    expect(advFirmUrl('148484')).toBe('https://adviserinfo.sec.gov/firm/summary/148484');
  });

  it('addresses a Wikidata entity by QID', () => {
    expect(wikidataEntityUrl('Q42')).toBe('https://www.wikidata.org/wiki/Q42');
  });

  it('cites the SBIR dataset itself, with the contract number as reference', () => {
    // There is no derivable per-award page, and a guessed URL would be worse
    // than none — the bulk file IS the document the fact came from.
    expect(SBIR_AWARD_DATA_URL).toBe(
      'https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv',
    );
    expect(awardReference('uei:SATYSBWG3FL7:FA2541-26-C-B007')).toBe('FA2541-26-C-B007');
    expect(awardReference('nosuffix')).toBeNull();
  });
});
