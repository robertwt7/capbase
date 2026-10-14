import { describe, it, expect } from '@jest/globals';

import { parseWorkbookLinks } from './innovate-uk.client';

describe('parseWorkbookLinks', () => {
  it('returns every xlsx link, absolute and deduplicated', () => {
    const html = `
      <a href="https://www.ukri.org/wp-content/uploads/2022/03/IUK-121026-FundedProjectsBetween2004FinancialYear2015To2016.xlsx">old</a>
      <a href="/wp-content/uploads/2022/03/IUK-121026-FundedProjectsFinancialYear2016To2017ToPresent.xlsx">new</a>
      <a href="/wp-content/uploads/2022/03/IUK-121026-FundedProjectsFinancialYear2016To2017ToPresent.xlsx">again</a>
      <a href="/other.pdf">pdf</a>`;
    expect(parseWorkbookLinks(html)).toEqual([
      'https://www.ukri.org/wp-content/uploads/2022/03/IUK-121026-FundedProjectsBetween2004FinancialYear2015To2016.xlsx',
      'https://www.ukri.org/wp-content/uploads/2022/03/IUK-121026-FundedProjectsFinancialYear2016To2017ToPresent.xlsx',
    ]);
  });

  it('returns nothing for a page with no workbook', () => {
    expect(parseWorkbookLinks('<p>moved</p>')).toEqual([]);
  });
});
