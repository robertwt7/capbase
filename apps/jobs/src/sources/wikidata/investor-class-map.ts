import type { InvestorType } from '@repo/api';

/**
 * Deterministic Wikidata `instance of` (P31) → InvestorType map, the investor-side
 * analogue of `sec-edgar/sector-map.ts`. Typing an investor from its class is the
 * whole point: the previous name-regex defaulted 6,725 of 6,730 holdings to
 * 'Venture'.
 *
 * Live entity counts as of 2026-08-02 (verified against query.wikidata.org):
 * VC firm 312 · incubator 88 · PE firm 82 · sovereign wealth fund 63 ·
 * accelerator 57 · hedge fund 38.
 */
export const INVESTOR_CLASSES: Readonly<Record<string, InvestorType>> = {
  Q3487908: 'Venture', // venture capital firm
  Q5418962: 'Private equity', // private equity firm
  Q4086495: 'Accelerator', // startup accelerator
  Q1132207: 'Accelerator', // business incubator
  Q105611: 'Hedge fund', // hedge fund
  Q1061648: 'Sovereign wealth', // sovereign wealth fund
  Q5: 'Angel', // human — an individual investor
};

/** Most specific class wins when an entity carries several (e.g. a firm tagged
 *  both venture capital firm and business incubator reads as Venture). */
const PRECEDENCE: readonly string[] = [
  'Q3487908',
  'Q5418962',
  'Q4086495',
  'Q1132207',
  'Q105611',
  'Q1061648',
  'Q5',
];

/** The investor's type from its P31 classes, or null when none are recognised. */
export function investorTypeForClasses(qids: readonly string[]): InvestorType | null {
  for (const qid of PRECEDENCE) {
    if (qids.includes(qid)) return INVESTOR_CLASSES[qid]!;
  }
  return null;
}

/** Classes used to enumerate investor firms directly, independent of P1951. */
export const INVESTOR_FIRM_CLASSES: readonly string[] = [
  'Q3487908',
  'Q5418962',
  'Q4086495',
  'Q1132207',
  'Q105611',
  'Q1061648',
];

/**
 * Entities that are lenders or state bodies, not equity investors.
 *
 * The European Investment Bank MUST be excluded by QID: it is `instance of`
 * international financial institution (Q1345691) and EU institution (Q4936585),
 * NOT development bank — so the class filter below does not catch it. Its P1951
 * statements are loan recipients and account for 5,583 of the 6,730 holdings
 * that existed before this filter (79% of all P1951 edges on Wikidata).
 */
export const EXCLUDED_INVESTOR_QIDS: readonly string[] = ['Q192247'];

/** Class-level exclusions for the residual government/development-lender tail. */
export const EXCLUDED_INVESTOR_CLASSES: readonly string[] = [
  'Q1345691', // international financial institution
  'Q4936585', // EU institution
  'Q327333', // government agency
  'Q484652', // international organization
  'Q5266746', // development bank
];
