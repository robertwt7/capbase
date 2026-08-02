import { describe, it, expect } from '@jest/globals';

import { parseAdvSnapshots } from './adv.client';

/** Excerpt of the real SEC index page. The three filename shapes below are
 *  verbatim from one page — the naming is NOT pattern-stable, which is why the
 *  page is scraped rather than a URL constructed from a date. */
const PAGE = `
<ul>
  <li><a href="/files/investment/data/other/ia/ia07012026-exempt.zip">July 2026 ERA</a></li>
  <li><a href="/files/investment/data/other/ia/ia07012026.zip">July 2026 RIA</a></li>
  <li><a href="/files/investment/data/other/ia/ia060126-exempt.zip">June 2026 ERA</a></li>
  <li><a href="/files/investment/data/other/ia/ia060126_0.zip">June 2026 RIA</a></li>
  <li><a href="/files/investment/data/other/ia/ia020226-exemptzip.zip">Feb 2026 ERA</a></li>
  <li><a href="/files/investment/data/other/ia/ia020226.zip">Feb 2026 RIA</a></li>
  <li><a href="/files/some/other/download.zip">Unrelated archive</a></li>
</ul>
`;

describe('parseAdvSnapshots', () => {
  it('pairs each month’s registered and exempt archives, newest first', () => {
    const snapshots = parseAdvSnapshots(PAGE);
    expect(snapshots.map((s) => s.label)).toEqual(['ia07012026', 'ia060126', 'ia020226']);
  });

  it('resolves relative hrefs against sec.gov and picks the right file per role', () => {
    const [latest] = parseAdvSnapshots(PAGE);
    expect(latest).toEqual({
      label: 'ia07012026',
      registered: 'https://www.sec.gov/files/investment/data/other/ia/ia07012026.zip',
      exempt: 'https://www.sec.gov/files/investment/data/other/ia/ia07012026-exempt.zip',
    });
  });

  it('recognises the irregular "-exemptzip" and "_0" suffixes', () => {
    const byLabel = Object.fromEntries(parseAdvSnapshots(PAGE).map((s) => [s.label, s]));
    expect(byLabel['ia020226']!.exempt).toContain('ia020226-exemptzip.zip');
    expect(byLabel['ia020226']!.registered).toContain('ia020226.zip');
    expect(byLabel['ia060126']!.registered).toContain('ia060126_0.zip');
  });

  it('ignores archives that are not an adviser roster', () => {
    expect(parseAdvSnapshots(PAGE).some((s) => s.label.includes('download'))).toBe(false);
  });

  it('drops a month that is missing one half of the pair', () => {
    const partial = '<a href="/files/ia/ia09012026.zip">only registered</a>';
    expect(parseAdvSnapshots(partial)).toEqual([]);
  });

  it('returns nothing for a page with no links', () => {
    expect(parseAdvSnapshots('<html><body>nothing here</body></html>')).toEqual([]);
  });
});
