import { describe, it, expect } from '@jest/globals';

import { parseFormIndex } from './edgar.client';

/** Excerpt in the exact layout of a daily `form.<date>.idx` file. */
const INDEX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    July 13, 2026
Comments:              webmaster@sec.gov

Form Type   Company Name                                                    CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------
10-K        SOME PUBLIC COMPANY INC                                         1234567     20260713    edgar/data/1234567/0001234567-26-000123.txt
D           Acme Robotics, Inc.                                             2011811     20260713    edgar/data/2011811/0002011811-26-000002.txt
D/A         AGC Skild I a Series of AGC AI Nexus Fund LLC                   2071574     20260713    edgar/data/2071574/0001213900-26-038241.txt
DEF 14A     ANOTHER FILER LLC                                               7654321     20260713    edgar/data/7654321/0007654321-26-000009.txt
`;

describe('parseFormIndex', () => {
  it('returns only Form D and D/A rows', () => {
    const refs = parseFormIndex(INDEX);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.companyName)).toEqual([
      'Acme Robotics, Inc.',
      'AGC Skild I a Series of AGC AI Nexus Fund LLC',
    ]);
  });

  it('extracts cik, accession (without path or .txt) and dateFiled', () => {
    const [d] = parseFormIndex(INDEX);
    expect(d).toEqual({
      cik: '2011811',
      accession: '0002011811-26-000002',
      companyName: 'Acme Robotics, Inc.',
      dateFiled: '20260713',
    });
  });

  it('ignores everything before the dashed header separator', () => {
    // The preamble has runs of 2+ spaces too — it must not produce rows.
    const preambleOnly = INDEX.split('\n').slice(0, 5).join('\n');
    expect(parseFormIndex(preambleOnly)).toEqual([]);
  });
});
