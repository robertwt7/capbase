import { describe, it, expect } from '@jest/globals';

import {
  EXCLUDED_INVESTOR_CLASSES,
  EXCLUDED_INVESTOR_QIDS,
  INVESTOR_FIRM_CLASSES,
  investorTypeForClasses,
} from './investor-class-map';

describe('investorTypeForClasses', () => {
  it.each([
    [['Q3487908'], 'Venture'],
    [['Q5418962'], 'Private equity'],
    [['Q4086495'], 'Accelerator'],
    [['Q1132207'], 'Accelerator'],
    [['Q105611'], 'Hedge fund'],
    [['Q1061648'], 'Sovereign wealth'],
    [['Q5'], 'Angel'],
  ])('%s → %s', (classes, expected) => {
    expect(investorTypeForClasses(classes)).toBe(expected);
  });

  it('takes the most specific class when an entity carries several', () => {
    // A firm tagged both venture capital firm and business incubator is a VC.
    expect(investorTypeForClasses(['Q1132207', 'Q3487908'])).toBe('Venture');
    // Order in the input must not matter — precedence decides.
    expect(investorTypeForClasses(['Q3487908', 'Q1132207'])).toBe('Venture');
    expect(investorTypeForClasses(['Q5', 'Q5418962'])).toBe('Private equity');
  });

  it('returns null for unrecognised or absent classes', () => {
    expect(investorTypeForClasses(['Q4830453'])).toBeNull(); // generic "business"
    expect(investorTypeForClasses([])).toBeNull();
  });
});

describe('exclusions', () => {
  it('excludes the European Investment Bank by QID', () => {
    // EIB is instance-of international financial institution / EU institution —
    // NOT development bank — so only an explicit QID exclusion catches it.
    expect(EXCLUDED_INVESTOR_QIDS).toContain('Q192247');
  });

  it('excludes development-lender and government classes', () => {
    expect(EXCLUDED_INVESTOR_CLASSES).toEqual(
      expect.arrayContaining(['Q1345691', 'Q4936585', 'Q327333', 'Q484652', 'Q5266746']),
    );
  });

  it('never enumerates a class it also excludes', () => {
    for (const qid of INVESTOR_FIRM_CLASSES) {
      expect(EXCLUDED_INVESTOR_CLASSES).not.toContain(qid);
    }
  });

  it('enumerates every firm class except the person class', () => {
    expect(INVESTOR_FIRM_CLASSES).toEqual([
      'Q3487908',
      'Q5418962',
      'Q4086495',
      'Q1132207',
      'Q105611',
      'Q1061648',
    ]);
    expect(INVESTOR_FIRM_CLASSES).not.toContain('Q5');
  });
});
