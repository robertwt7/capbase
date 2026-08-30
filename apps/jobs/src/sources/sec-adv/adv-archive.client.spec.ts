import { describe, it, expect } from '@jest/globals';

import { parseAdvArchives } from './adv-archive.client';

/** Excerpt of the real SEC "Form ADV Data" FOIA page. The pre-2011 archive is
 *  genuinely listed there, and it must never be chosen: Schedule D 7.B.(1)
 *  did not exist before the 2011 Form ADV revision. */
const PAGE = `
<ul>
  <li><a href="/files/adv-filing-data-20111105-20241231-part1.zip">Part 1 (2011–2024)</a></li>
  <li><a href="/files/adv-filing-data-20111105-20241231-part2.zip">Part 2 (2011–2024)</a></li>
  <li><a href="/files/adv-filing-data-20111105-20231231-part1.zip">Part 1 (2011–2023)</a></li>
  <li><a href="/files/adv-filing-data-20111105-20231231-part2.zip">Part 2 (2011–2023)</a></li>
  <li><a href="/files/adv-filing-data-20001019-20111104-part1.zip">Part 1 (2000–2011)</a></li>
  <li><a href="/files/adv-filing-data-20001019-20111104-part2.zip">Part 2 (2000–2011)</a></li>
  <li><a href="/files/some/other/download.zip">Unrelated archive</a></li>
</ul>
`;

describe('parseAdvArchives', () => {
  it('pairs part1 with part2 and puts the newest cut first', () => {
    expect(parseAdvArchives(PAGE).map((a) => a.label)).toEqual([
      '20111105-20241231',
      '20111105-20231231',
    ]);
  });

  it('excludes the pre-2011 archive, which predates Schedule D 7.B.(1)', () => {
    expect(parseAdvArchives(PAGE).map((a) => a.label)).not.toContain('20001019-20111104');
  });

  it('resolves relative hrefs against sec.gov', () => {
    expect(parseAdvArchives(PAGE)[0]).toEqual({
      label: '20111105-20241231',
      part1: 'https://www.sec.gov/files/adv-filing-data-20111105-20241231-part1.zip',
      part2: 'https://www.sec.gov/files/adv-filing-data-20111105-20241231-part2.zip',
    });
  });

  it('ignores a cut with only one half — the join needs both', () => {
    const half = `<a href="/files/adv-filing-data-20111105-20251231-part1.zip">Part 1</a>`;
    expect(parseAdvArchives(half)).toEqual([]);
  });

  it('returns nothing for a page with no archives', () => {
    expect(parseAdvArchives('<p>No downloads today.</p>')).toEqual([]);
  });
});
