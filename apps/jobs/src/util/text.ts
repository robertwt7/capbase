// Text normalisation shared across sources. Bulk government files publish names
// and places in ALL CAPS (Form ADV firm names, Form C issuer cities), so more
// than one source needs the same title-casing rules.

const KEEP_UPPER = new Set([
  'LLC', 'L.L.C.', 'LLP', 'LP', 'L.P.', 'LLLP', 'INC', 'LTD', 'PLC', 'GP', 'PC', 'PA',
  'GMBH', 'AG', 'NV', 'BV', 'SA', 'SARL', 'AB', 'AS', 'OY', 'PTE', 'PTY', 'SPA', 'SRL',
  'USA', 'US', 'UK', 'EU', 'LLC.', 'CO.', 'VC', 'PE', 'AI', 'IT', 'ESG', 'REIT', 'SPV',
]);

const ROMAN = /^[IVXLCDM]+\.?$/;

/** ADV names are stored ALL CAPS. Title-case them while preserving legal-form
 *  acronyms and the roman numerals that distinguish fund vintages. */
export function titleCaseFirm(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^A-Za-z.]/g, '');
      if (KEEP_UPPER.has(word.toUpperCase()) || KEEP_UPPER.has(bare.toUpperCase())) {
        return word.toUpperCase();
      }
      if (ROMAN.test(word.toUpperCase()) && word.length > 1) return word.toUpperCase();
      // Short vowel-less tokens are initialisms, not words: HPS, TPG, KKR, GSV.
      if (bare.length >= 2 && bare.length <= 4 && !/[aeiouy]/i.test(bare)) {
        return word.toUpperCase();
      }
      // Capitalise each alphabetic run, so "A.CAPITAL" → "A.Capital" and
      // "WORK-BENCH" → "Work-Bench".
      return word.toLowerCase().replace(/[a-z][a-z']*/g, (run) => run[0]!.toUpperCase() + run.slice(1));
    })
    .join(' ');
}

/**
 * Whether a "person" name is really an organisation.
 *
 * Both SEC people feeds mix the two: Form D's `relatedPersonsList` carries fund
 * administrators, and a Form C signature block is sometimes signed by the
 * issuing LLC rather than an officer. A row that reads like a company is not a
 * person and must not become one.
 */
const ENTITY_RE =
  /\b(llc|l\.l\.c\.?|lp|l\.p\.?|inc|ltd|corp|fund|capital|management|advis[oe]rs?|partners)\b/i;

export function looksLikeEntityName(name: string): boolean {
  return ENTITY_RE.test(name);
}
