import type { Sector } from '@repo/api';

/**
 * SIC 2007 code → canonical Sector, the same stance as `sec-edgar/sector-map.ts`:
 * a sector only where the code itself says it, never a guess from a name.
 *
 * Rules are [low, high] ranges over the five-digit code, FIRST MATCH WINS, so
 * the specific carve-outs sit above the broad bands they cut out of (pharma
 * 21xxx above manufacturing 10–33xxx, software 58290 above publishing 58xxx).
 * A null rule is a deliberate "this code does not say": holding companies and
 * fund vehicles (64201–64306) are financial in form but say nothing about what
 * the group does, and 99999 is "dormant company".
 *
 * Fintech, Artificial intelligence, Climate and Enterprise SaaS are never
 * produced — no SIC code states them.
 */
const RULES: readonly [number, number, Sector | null][] = [
  // Explicit nulls first: financial in form, silent about the business.
  [64201, 64209, null], // activities of holding companies
  [64301, 64306, null], // trusts, funds and similar financial entities

  [62000, 62099, 'Technology'], // computer programming, consultancy
  [63100, 63199, 'Technology'], // data processing, hosting, web portals
  [58290, 58290, 'Technology'], // other software publishing
  [26000, 26999, 'Technology'], // computer, electronic and optical products

  [58000, 58999, 'Media & telecom'], // publishing (rest)
  [59000, 59999, 'Media & telecom'], // film, video, TV, music
  [60000, 60999, 'Media & telecom'], // broadcasting
  [61000, 61999, 'Media & telecom'], // telecommunications
  [63900, 63999, 'Media & telecom'], // news agencies, other information
  [73000, 73999, 'Media & telecom'], // advertising, market research

  [64110, 64192, 'Financial services'], // banking
  [64910, 64999, 'Financial services'], // leasing, credit, other finance
  [65000, 65999, 'Financial services'], // insurance, pensions
  [66000, 66999, 'Financial services'], // auxiliary financial services

  [21000, 21999, 'Healthcare'], // pharmaceuticals
  [32500, 32500, 'Healthcare'], // medical and dental instruments
  [72110, 72110, 'Healthcare'], // R&D on biotechnology
  [86000, 86999, 'Healthcare'], // human health
  [87000, 87999, 'Healthcare'], // residential care

  [5000, 9999, 'Energy'], // mining of coal, oil & gas extraction
  [19000, 19999, 'Energy'], // coke and refined petroleum
  [35000, 35999, 'Energy'], // electricity, gas, steam

  [41100, 41100, 'Real estate'], // development of building projects
  [68000, 68999, 'Real estate'], // real estate activities

  [10000, 33999, 'Industrials'], // manufacturing (rest)
  [41000, 43999, 'Industrials'], // construction (rest)
  [71000, 71999, 'Industrials'], // architecture, engineering, testing
  [72190, 72190, 'Industrials'], // other natural-science R&D

  [45000, 47999, 'Consumer & retail'], // motor trade, wholesale, retail
  [55000, 55999, 'Consumer & retail'], // accommodation
  [56000, 56999, 'Consumer & retail'], // food and beverage service

  [49000, 53999, 'Transport'], // land, water, air transport, warehousing, post

  [85000, 85999, 'Education'],
];

/** The five-digit code at the front of a `SICCode.SicText_N` value
 *  ("62020 - Information technology consultancy activities"), or null. */
export function sicCode(text: string | null | undefined): number | null {
  const m = /^\s*(\d{4,5})\b/.exec(text ?? '');
  return m ? Number(m[1]) : null;
}

/** Sector for a SIC text or code, or null when the code does not state one. */
export function sectorFromSic(sic: string | number | null | undefined): Sector | null {
  const code = typeof sic === 'number' ? sic : sicCode(sic);
  if (code === null) return null;
  for (const [low, high, sector] of RULES) {
    if (code >= low && code <= high) return sector;
  }
  return null;
}
