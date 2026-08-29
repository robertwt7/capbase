import { describe, it, expect } from '@jest/globals';

import { cleanHolderName, isEntityName, parseOwnership } from './ownership.parser';

/** ~1,200 characters of filler, so a fixture's section heading lands past the
 *  15% front-matter floor exactly as it does in a real 2 MB filing. */
const FILLER = `<P>${'Risk factors and business description. '.repeat(40)}</P>`;

/** The table of contents every S-1 opens with. Its page numbers parse as
 *  percentages, which is the trap that makes "any table with a % column" wrong. */
const TABLE_OF_CONTENTS = `
<TABLE>
  <TR><TD>RISK FACTORS</TD><TD>12</TD></TR>
  <TR><TD>PRINCIPAL STOCKHOLDERS</TD><TD>118</TD></TR>
  <TR><TD>UNDERWRITING</TD><TD>124</TD></TR>
</TABLE>`;

/** The prose that quotes the same words: a risk factor, not the section. */
const RISK_FACTOR = `
<P STYLE="margin-top:8pt"><B><I>Our principal stockholders and management own a
significant percentage of our stock and will be able to exert significant control
over matters subject to stockholder approval.</I></B></P>`;

/**
 * A beneficial-ownership table in the shape EDGAR's generators actually emit:
 * upper-case markup, `&#160;` padding, the `%` sign in its own column, footnote
 * markers glued to the names, and a group summary row at the bottom.
 */
const OWNERSHIP_TABLE = `
<P><B>PRINCIPAL STOCKHOLDERS</B></P>
<TABLE>
  <TR>
    <TD>Name&#160;of&#160;Beneficial&#160;Owner</TD>
    <TD>Shares Beneficially Owned</TD><TD></TD>
    <TD>Percent of Class</TD><TD></TD>
  </TR>
  <TR><TD>5% Stockholders:</TD><TD></TD><TD></TD><TD></TD><TD></TD></TR>
  <TR>
    <TD>Entities affiliated with New Enterprise Associates(1)</TD>
    <TD>12,345,678</TD><TD></TD><TD>18.4</TD><TD>%</TD>
  </TR>
  <TR>
    <TD>Investment funds affiliated with The Carlyle Group (2)</TD>
    <TD>4,000,000</TD><TD></TD><TD>6.0</TD><TD>%</TD>
  </TR>
  <TR>
    <TD>FMR LLC(3)</TD>
    <TD>3,210,000</TD><TD></TD><TD>4.8</TD><TD>%</TD>
  </TR>
  <TR><TD>Directors and Named Executive Officers:</TD><TD></TD><TD></TD><TD></TD><TD></TD></TR>
  <TR>
    <TD>Jane Founder(4)</TD>
    <TD>2,000,000</TD><TD></TD><TD>3.0</TD><TD>%</TD>
  </TR>
  <TR>
    <TD>Peter Director</TD>
    <TD>50,000</TD><TD></TD><TD>*</TD><TD></TD>
  </TR>
  <TR>
    <TD>All executive officers and directors as a group (8 persons)</TD>
    <TD>6,500,000</TD><TD></TD><TD>9.7</TD><TD>%</TD>
  </TR>
</TABLE>`;

const DOCUMENT = `<HTML><BODY>${TABLE_OF_CONTENTS}${FILLER}${RISK_FACTOR}${FILLER}${OWNERSHIP_TABLE}</BODY></HTML>`;

describe('parseOwnership', () => {
  const rows = parseOwnership(DOCUMENT);
  const names = rows.map((r) => r.name);

  it('finds the ownership table past the table of contents', () => {
    // The TOC's "118" would parse as 118% if the parser anchored on any table
    // with a percentage column.
    expect(names).not.toContain('RISK FACTORS');
    expect(names).not.toContain('UNDERWRITING');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('reads upper-case EDGAR markup', () => {
    // Several filing agents still emit <TABLE>/<TR>/<TD>.
    expect(names).toContain('FMR LLC');
  });

  it('strips the affiliation prefix an S-1 wraps a firm name in', () => {
    expect(names).toContain('New Enterprise Associates');
    expect(names).toContain('The Carlyle Group');
  });

  it('strips footnote markers from names', () => {
    expect(names.every((n) => !/\(\d+\)$/.test(n))).toBe(true);
  });

  it('reads a percentage whose % sign is in its own column', () => {
    const nea = rows.find((r) => r.name === 'New Enterprise Associates');
    expect(nea?.percent).toBe(18.4);
    expect(nea?.shares).toBe(12_345_678);
  });

  it("treats '*' as less than one percent", () => {
    expect(rows.find((r) => r.name === 'Peter Director')?.percent).toBe(0.5);
  });

  it('drops the officers-and-directors group summary row', () => {
    expect(names.some((n) => /as a group/i.test(n))).toBe(false);
  });

  it('drops the block headings that label a group of holders', () => {
    expect(names).not.toContain('5% Stockholders');
    expect(names.some((n) => n.includes('Named Executive Officers'))).toBe(false);
  });

  it('scores a firm in an anchored table at full confidence', () => {
    // 0.4 section + 0.2 owner header + 0.2 percentage + 0.2 entity token.
    expect(rows.find((r) => r.name === 'FMR LLC')?.confidence).toBeCloseTo(1);
  });

  it('scores an individual below a firm, on the entity token alone', () => {
    const founder = rows.find((r) => r.name === 'Jane Founder')!;
    const fmr = rows.find((r) => r.name === 'FMR LLC')!;
    expect(founder.confidence).toBeLessThan(fmr.confidence);
    // The score alone cannot separate them, which is why the source also
    // requires a legal-entity token before publishing an edge.
    expect(isEntityName(founder.name)).toBe(false);
    expect(isEntityName(fmr.name)).toBe(true);
  });

  it('is not fooled by the risk factor that quotes the section title', () => {
    // The heading test is structural: a heading is (almost) the whole of its own
    // text node, while the risk factor is a sentence.
    const noTable = `<HTML>${FILLER}${RISK_FACTOR}${FILLER}<P>Nothing else.</P></HTML>`;
    expect(parseOwnership(noTable)).toEqual([]);
  });

  it('returns nothing for a filing with no ownership section', () => {
    expect(parseOwnership(`<HTML>${FILLER}<P>No such section.</P></HTML>`)).toEqual([]);
    expect(parseOwnership('')).toEqual([]);
  });

  it('reads a multi-class layout, taking the first parsed percentage', () => {
    const multi = `<HTML>${FILLER}
      <P><B>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS</B></P>
      <table>
        <tr>
          <td>Beneficial Owner</td>
          <td>Class A Shares</td><td>% of Class A</td>
          <td>Class B Shares</td><td>% of Class B</td>
        </tr>
        <tr>
          <td>Affiliate of Bain Capital(2)</td>
          <td>9,000,000</td><td>22.5%</td>
          <td>1,000,000</td><td>4.1%</td>
        </tr>
      </table></HTML>`;
    expect(parseOwnership(multi)).toEqual([
      { name: 'Bain Capital', percent: 22.5, shares: 9_000_000, confidence: 1 },
    ]);
  });
});

describe('cleanHolderName', () => {
  it.each([
    ['Baker Hughes Holdings LLC(5)', 'Baker Hughes Holdings LLC'],
    ['FMR LLC (1)(2)', 'FMR LLC'],
    ['Entities affiliated with OrbiMed Advisors LLC', 'OrbiMed Advisors LLC'],
    ['Investment funds affiliated with The Carlyle Group', 'The Carlyle Group'],
    ['Affiliate of Bain Capital', 'Bain Capital'],
    ['Armistice Capital, LLC *', 'Armistice Capital, LLC'],
    ['RedHawk Acquisition One, LLC 3, 5, 6', 'RedHawk Acquisition One, LLC'],
    ['Fifth Era Acquisition Sponsor I LLC (our sponsor)', 'Fifth Era Acquisition Sponsor I LLC'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanHolderName(raw)).toBe(expected);
  });

  it('leaves a name that is already clean alone', () => {
    expect(cleanHolderName('New Enterprise Associates')).toBe('New Enterprise Associates');
    expect(cleanHolderName('Sequoia Capital 2010 LP')).toBe('Sequoia Capital 2010 LP');
  });
});
