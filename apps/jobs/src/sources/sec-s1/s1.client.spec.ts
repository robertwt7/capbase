import { describe, it, expect } from '@jest/globals';

import { documentUrl, monthWindows, toRef, type S1Ref } from './s1.client';

/** A hit copied from a real EDGAR full-text search response. */
const PRIMARY = {
  _id: '0001193125-25-013425:d915070ds1a.htm',
  _source: {
    ciks: ['0002021880'],
    display_names: ['HMH Holding Inc  (CIK 0002021880)'],
    form: 'S-1/A',
    file_type: 'S-1/A',
    file_date: '2025-01-27',
  },
};

/** An exhibit from the same search: same form and date, different file_type. */
const EXHIBIT = {
  _id: '0001829126-25-000013:neonctechnologies_ex10-11.htm',
  _source: {
    ciks: ['0001979414'],
    display_names: ['NEONC TECHNOLOGIES HOLDINGS, INC.  (CIK 0001979414)'],
    form: 'S-1',
    file_type: 'EX-10.11',
    file_date: '2025-01-03',
  },
};

describe('toRef', () => {
  it('reads the primary document and its filer', () => {
    expect(toRef(PRIMARY)).toEqual<S1Ref>({
      cik: '0002021880',
      accession: '0001193125-25-013425',
      file: 'd915070ds1a.htm',
      form: 'S-1/A',
      filedAt: '2025-01-27',
      filer: 'HMH Holding Inc',
    });
  });

  it('drops an exhibit: only the prospectus carries the ownership table', () => {
    expect(toRef(EXHIBIT)).toBeNull();
  });

  it('drops a hit with no usable id or filer', () => {
    expect(toRef({ _id: '', _source: {} })).toBeNull();
    expect(toRef({ _id: 'acc:file.htm', _source: { form: 'S-1', file_type: 'S-1' } })).toBeNull();
  });
});

describe('documentUrl', () => {
  it("addresses the document in the filing's archive folder", () => {
    // EDGAR strips the CIK's padding and the accession's dashes in that path.
    expect(documentUrl(toRef(PRIMARY)!)).toBe(
      'https://www.sec.gov/Archives/edgar/data/2021880/000119312525013425/d915070ds1a.htm',
    );
  });
});

describe('monthWindows', () => {
  it('splits a range into inclusive months, newest first', () => {
    // A single EFTS query caps at 10,000 hits, so the walk is monthly.
    expect(monthWindows('2025-01-01', '2025-03-31')).toEqual([
      ['2025-03-01', '2025-03-31'],
      ['2025-02-01', '2025-02-28'],
      ['2025-01-01', '2025-01-31'],
    ]);
  });

  it('clips the first and last windows to the requested range', () => {
    expect(monthWindows('2025-01-15', '2025-02-10')).toEqual([
      ['2025-02-01', '2025-02-10'],
      ['2025-01-15', '2025-01-31'],
    ]);
  });

  it('handles a range inside one month, and a bad range', () => {
    expect(monthWindows('2025-05-02', '2025-05-09')).toEqual([['2025-05-02', '2025-05-09']]);
    expect(monthWindows('nonsense', '2025-01-01')).toEqual([]);
  });
});
