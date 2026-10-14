import { describe, it, expect } from '@jest/globals';

import { sectorFromSic, sicCode } from './sic-sector';

describe('sectorFromSic', () => {
  it.each([
    ['62020 - Information technology consultancy activities', 'Technology'],
    ['63110 - Data processing, hosting and related activities', 'Technology'],
    ['58290 - Other software publishing', 'Technology'],
    ['26110 - Manufacture of electronic components', 'Technology'],
    ['58110 - Book publishing', 'Media & telecom'],
    ['61100 - Wired telecommunications activities', 'Media & telecom'],
    ['73110 - Advertising agencies', 'Media & telecom'],
    ['64191 - Banks', 'Financial services'],
    ['66300 - Fund management activities', 'Financial services'],
    ['21200 - Manufacture of pharmaceutical preparations', 'Healthcare'],
    ['32500 - Manufacture of medical and dental instruments and supplies', 'Healthcare'],
    ['72110 - Research and experimental development on biotechnology', 'Healthcare'],
    ['86210 - General medical practice activities', 'Healthcare'],
    ['06100 - Extraction of crude petroleum', 'Energy'],
    ['35110 - Production of electricity', 'Energy'],
    ['41100 - Development of building projects', 'Real estate'],
    ['68209 - Other letting and operating of own or leased real estate', 'Real estate'],
    ['25110 - Manufacture of metal structures and parts of structures', 'Industrials'],
    ['43210 - Electrical installation', 'Industrials'],
    ['71129 - Other engineering activities', 'Industrials'],
    ['72190 - Other research and experimental development on natural sciences and engineering', 'Industrials'],
    ['47110 - Retail sale in non-specialised stores', 'Consumer & retail'],
    ['56101 - Licensed restaurants', 'Consumer & retail'],
    ['49410 - Freight transport by road', 'Transport'],
    ['52290 - Other transportation support activities', 'Transport'],
    ['85320 - Technical and vocational secondary education', 'Education'],
  ])('%s → %s', (text, sector) => {
    expect(sectorFromSic(text)).toBe(sector);
  });

  it.each([
    '64209 - Activities of other holding companies n.e.c.',
    '64205 - Activities of financial services holding companies',
    '64303 - Activities of venture and development capital companies',
    '99999 - Dormant Company',
    '74990 - Non-trading company',
    '82990 - Other business support service activities n.e.c.',
    '70100 - Activities of head offices',
    'None Supplied',
    '',
  ])('%s → null', (text) => {
    expect(sectorFromSic(text)).toBeNull();
  });
});

describe('sicCode', () => {
  it('reads the leading code, including four-digit (leading-zero-dropped) ones', () => {
    expect(sicCode('62020 - Information technology')).toBe(62020);
    expect(sicCode('6100 - Extraction of crude petroleum')).toBe(6100);
    expect(sicCode('None Supplied')).toBeNull();
  });
});
