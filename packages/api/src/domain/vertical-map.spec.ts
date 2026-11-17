import { SECTORS } from './company';
import { normaliseSicText, SIC2007 } from './sic2007';
import {
  deriveVerticals,
  explainVerticals,
  FORM_D_VERTICALS,
  PARTNER_VERTICALS,
  SIC_VERTICAL_RULES,
  verticalForSicCode,
  WIKIDATA_VERTICALS,
} from './vertical-map';
import { VERTICAL_SECTOR, VERTICALS, type Vertical } from './verticals';

const TABLES = { PARTNER_VERTICALS, FORM_D_VERTICALS, WIKIDATA_VERTICALS };

describe('vocabulary closure', () => {
  it('every table value and rule target is a vertical', () => {
    for (const [name, table] of Object.entries(TABLES)) {
      for (const [label, v] of Object.entries(table)) {
        if (v !== null) expect([name, label, VERTICALS.includes(v)]).toEqual([name, label, true]);
      }
    }
    for (const [, , v] of SIC_VERTICAL_RULES) expect(VERTICALS).toContain(v);
  });

  it('every vertical is reachable from a table entry or a rule (no dead vocabulary)', () => {
    const reachable = new Set<Vertical>();
    for (const table of Object.values(TABLES)) {
      for (const v of Object.values(table)) if (v) reachable.add(v);
    }
    for (const [, , v] of SIC_VERTICAL_RULES) reachable.add(v);
    expect(VERTICALS.filter((v) => !reachable.has(v))).toEqual([]);
  });

  it('every vertical has a known parent sector', () => {
    for (const v of VERTICALS) expect(SECTORS).toContain(VERTICAL_SECTOR[v]);
  });

  it('every SIC rule covers at least one listed code (no dead rule)', () => {
    const codes = Object.values(SIC2007).map(Number);
    for (const [low, high, v] of SIC_VERTICAL_RULES) {
      expect([low, high, v, codes.some((c) => c >= low && c <= high)]).toEqual([
        low,
        high,
        v,
        true,
      ]);
    }
  });
});

describe('cross-table agreement', () => {
  it('a label in both public tables maps to the same vertical', () => {
    for (const [label, v] of Object.entries(FORM_D_VERTICALS)) {
      if (label in WIKIDATA_VERTICALS)
        expect([label, WIKIDATA_VERTICALS[label]]).toEqual([label, v]);
    }
  });

  it('no SIC text equals a Form D or Wikidata key with a different vertical', () => {
    for (const table of [FORM_D_VERTICALS, WIKIDATA_VERTICALS]) {
      for (const [label, v] of Object.entries(table)) {
        const code = SIC2007[normaliseSicText(label)];
        if (code) expect([label, verticalForSicCode(code)]).toEqual([label, v]);
      }
    }
  });

  it('a partner label shared with a public table agrees with it', () => {
    for (const [label, v] of Object.entries(PARTNER_VERTICALS)) {
      for (const table of [FORM_D_VERTICALS, WIKIDATA_VERTICALS]) {
        if (label in table) expect([label, table[label]]).toEqual([label, v]);
      }
    }
  });
});

describe('deriveVerticals', () => {
  const derive = (labels: string[], partner = false) => deriveVerticals(labels, partner).verticals;

  it('reads a partner-marked label from the partner table', () => {
    expect(derive(['Software'], true)).toEqual(['Software']);
    expect(deriveVerticals(['Hardware'], true).sources).toEqual([
      { vertical: 'Computer hardware', scheme: 'partner', label: 'Hardware' },
    ]);
  });

  it('a partner label that restates the sector maps to nothing', () => {
    expect(derive(['Financial Services'], true)).toEqual([]);
  });

  it('maps several SIC texts in label order', () => {
    expect(derive(['Banks', 'Life insurance'])).toEqual(['Banking', 'Insurance']);
  });

  it('holding companies, SBIR agencies and Form D "Other" groups map to nothing', () => {
    expect(derive(['Activities of other holding companies n.e.c.'])).toEqual([]);
    expect(derive(['Department of Defense'])).toEqual([]);
    expect(derive(['Other Technology'])).toEqual([]);
  });

  it('resolves SIC text with doubled spaces and any case', () => {
    expect(derive(['Publishing of  consumer and business journals and periodicals'])).toEqual([
      'Publishing',
    ]);
    expect(derive(['BANKS'])).toEqual(['Banking']);
  });

  it('legacy SIC 2003 text maps to nothing', () => {
    expect(derive(['Other business activities'])).toEqual([]);
  });

  it('collapses duplicates', () => {
    expect(derive(['Banks', 'Banks', 'Commercial Banking'])).toEqual(['Banking']);
  });

  it('reads Form D and Wikidata labels', () => {
    expect(derive(['Biotechnology'])).toEqual(['Biotechnology']);
    expect(derive(['software as a service'])).toEqual(['Software']);
    expect(derive(['line of credit'])).toEqual([]);
  });

  it('reports the SIC code of a SIC source', () => {
    expect(deriveVerticals(['Banks'], false).sources).toEqual([
      { vertical: 'Banking', scheme: 'sic', label: 'Banks', code: '64191' },
    ]);
  });
});

describe('explainVerticals', () => {
  it('reports a derived vertical with its scheme, label and code', () => {
    expect(explainVerticals(['Gambling'], ['Gambling and betting activities'], false)).toEqual([
      {
        vertical: 'Gambling',
        scheme: 'sic',
        label: 'Gambling and betting activities',
        code: '92000',
      },
    ]);
  });

  it('a stored vertical no label produces came from a contributor', () => {
    expect(explainVerticals(['Retail', 'Banking'], ['Banks'], false)).toEqual([
      { vertical: 'Retail', scheme: 'contributor' },
      { vertical: 'Banking', scheme: 'sic', label: 'Banks', code: '64191' },
    ]);
  });
});

describe('SIC rule order', () => {
  it.each([
    [47910, 'E-commerce'],
    [47110, 'Grocery'],
    [47710, 'Fashion & apparel'],
    [47300, 'Retail'],
    [26200, 'Computer hardware'],
    [26110, 'Electronics'],
    [72110, 'Biotechnology'],
    [25400, 'Defence'],
    [25110, 'Metal products'],
    [28250, 'HVAC'],
    [28110, 'Industrial machinery'],
    [27200, 'Energy storage & batteries'],
    [27110, 'Electrical equipment'],
    [2100, 'Forestry & timber'],
    [1110, 'Agribusiness'],
    [52230, 'Aviation'],
    [52101, 'Logistics & freight'],
    [41100, 'Property development'],
    [41201, 'Construction'],
  ])('%s → %s', (code, vertical) => {
    expect(verticalForSicCode(code)).toBe(vertical);
  });

  it.each([64301, 64201, 70100, 99999, 74990, 64999, 66190, 32990, 74909, 82990, 96090])(
    '%s → none',
    (code) => {
      expect(verticalForSicCode(code)).toBeNull();
    },
  );
});

describe('SIC2007', () => {
  it('holds all 731 rows, keys normalised, values five digits', () => {
    const entries = Object.entries(SIC2007);
    expect(entries).toHaveLength(731);
    for (const [k, v] of entries) {
      expect(k).toBe(normaliseSicText(k));
      expect(v).toMatch(/^\d{5}$/);
    }
  });
});
