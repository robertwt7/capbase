// Geography: the country a company or investor is based in. Same convention as
// the other controlled vocabularies here — a plain String column validated with
// @IsIn(COUNTRY_CODES) — but the codes are ISO 3166-1 alpha-2 rather than our
// own words, because every publisher we read already speaks some form of them.
// Runtime-dependency-free: names come from the platform's Intl data.

/** ISO 3166-1 alpha-2, upper-case (e.g. 'US', 'GB'). */
export type CountryCode = string;

/** The 249 officially assigned ISO 3166-1 alpha-2 codes. User-assigned codes
 *  (XK for Kosovo, EU, …) are deliberately absent: a stored code must mean the
 *  same thing to every consumer of the data. */
export const COUNTRY_CODES: readonly CountryCode[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
  'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET ' +
  'FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
  'HK HM HN HR HT HU ' +
  'ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ ' +
  'LA LB LC LI LK LR LS LT LU LV LY ' +
  'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM ' +
  'PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
  'QA ' +
  'RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
  'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ ' +
  'VA VC VE VG VI VN VU ' +
  'WF WS ' +
  'YE YT ' +
  'ZA ZM ZW'
).split(' ');

const ASSIGNED = new Set(COUNTRY_CODES);

/** Publisher codes that are not ISO: EU institutions write UK for the United
 *  Kingdom and EL for Greece. EDGAR's own location codes are a different
 *  vocabulary entirely and are handled in apps/jobs, not here. */
const CODE_ALIASES: Record<string, CountryCode> = { UK: 'GB', EL: 'GR' };

/** Canonical code, or null for anything that is not an assigned code. Never
 *  throws — the input is whatever a publisher wrote. */
export function normalizeCountryCode(raw: string | null | undefined): CountryCode | null {
  const upper = (raw ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  const code = CODE_ALIASES[upper] ?? upper;
  return ASSIGNED.has(code) ? code : null;
}

/**
 * Names our sources use that Intl's English region names do not: long official
 * forms, historical states, constituent countries, and the "Name, Qualifier"
 * style of the SEC's country lists. Keys are in `nameKey` form.
 *
 * Only names that unambiguously denote ONE current country belong here. A
 * historical empire whose territory is now several countries ("Austrian
 * Empire") stays unmapped: a guessed country is worse than none.
 */
const NAME_ALIASES: Record<string, CountryCode> = {
  'united states of america': 'US',
  usa: 'US',
  us: 'US',
  america: 'US',
  'united kingdom of great britain and northern ireland': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'kingdom of england': 'GB',
  'kingdom of scotland': 'GB',
  'kingdom of great britain': 'GB',
  "people's republic of china": 'CN',
  'peoples republic of china': 'CN',
  'mainland china': 'CN',
  'republic of china': 'TW',
  'taiwan, republic of china': 'TW',
  'taiwan, province of china': 'TW',
  'czech republic': 'CZ',
  'russian federation': 'RU',
  'republic of korea': 'KR',
  'korea, republic of': 'KR',
  'korea, south': 'KR',
  korea: 'KR',
  "democratic people's republic of korea": 'KP',
  'korea, north': 'KP',
  'hong kong': 'HK',
  'hong kong sar': 'HK',
  macau: 'MO',
  macao: 'MO',
  'macao sar': 'MO',
  turkey: 'TR',
  'republic of turkey': 'TR',
  myanmar: 'MM',
  burma: 'MM',
  'ivory coast': 'CI',
  "cote d'ivoire": 'CI',
  swaziland: 'SZ',
  'cape verde': 'CV',
  'vatican city': 'VA',
  'holy see': 'VA',
  palestine: 'PS',
  'state of palestine': 'PS',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'kingdom of the netherlands': 'NL',
  holland: 'NL',
  'federal republic of germany': 'DE',
  'east timor': 'TL',
  'timor-leste': 'TL',
  'iran, islamic republic of': 'IR',
  'islamic republic of iran': 'IR',
  'viet nam': 'VN',
  'lao pdr': 'LA',
  laos: 'LA',
  'syrian arab republic': 'SY',
  'virgin islands, british': 'VG',
  'virgin islands, us': 'VI',
  'us virgin islands': 'VI',
  'united states virgin islands': 'VI',
  'micronesia, federated states of': 'FM',
  'federated states of micronesia': 'FM',
  micronesia: 'FM',
  'georgia/gruzinskaya': 'GE',
  'north macedonia': 'MK',
  macedonia: 'MK',
  'republic of ireland': 'IE',
  'saint kitts and nevis': 'KN',
  'saint vincent and the grenadines': 'VC',
  'sao tome and principe': 'ST',
  'trinidad and tobago': 'TT',
  'antigua and barbuda': 'AG',
  'bosnia and herzegovina': 'BA',
  'the gambia': 'GM',
  gambia: 'GM',
  bahamas: 'BS',
  'kingdom of saudi arabia': 'SA',
  uae: 'AE',
  curacao: 'CW',
  reunion: 'RE',
  'aland islands': 'AX',
  // The SEC's EDGAR / Form ADV country lists use the older UN long forms.
  'brunei darussalam': 'BN',
  kazakstan: 'KZ',
  "lao people's democratic republic": 'LA',
  'libyan arab jamahiriya': 'LY',
  'macedonia, the former yugoslav republic of': 'MK',
  'moldova, republic of': 'MD',
  'republic of moldova': 'MD',
  'tanzania, united republic of': 'TZ',
  'united republic of tanzania': 'TZ',
  'palestinian territory, occupied': 'PS',
  'palestinian territories': 'PS',
  pitcairn: 'PN',
  'heard island and mcdonald islands': 'HM',
  'south georgia and the south sandwich islands': 'GS',
  'united states minor outlying islands': 'UM',
};

/** Comparison key for a country name: case, accents, curly quotes, "&" vs
 *  "and", dots and a leading "The" are all noise. */
function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\./g, '')
    // Intl writes "St. Lucia"; the SEC writes "SAINT LUCIA".
    .replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

let byName: Map<string, CountryCode> | null = null;

/** Built on first use, not at import: the web bundle imports this package, and
 *  most of its pages never ask for a country name. */
function nameTable(): Map<string, CountryCode> {
  if (byName) return byName;
  const table = new Map<string, CountryCode>();
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of COUNTRY_CODES) {
    const label = display.of(code);
    if (!label || label === code) continue;
    table.set(nameKey(label), code);
    // Intl labels some territories "Hong Kong SAR China" or "Congo - Kinshasa";
    // the part before the qualifier is how sources write them too.
    const short = label.replace(/\s+(SAR China|- .*|\(.*\))$/, '');
    if (short !== label && !table.has(nameKey(short))) table.set(nameKey(short), code);
  }
  for (const [alias, code] of Object.entries(NAME_ALIASES)) table.set(nameKey(alias), code);
  byName = table;
  return table;
}

/**
 * English country name → ISO code, or null when unrecognised.
 *
 * Accepts Intl's English region names ("United Kingdom", "Czechia"), the long
 * and historical forms our sources write ("People's Republic of China",
 * "Kingdom of England"), constituent countries ("Scotland" → GB), and the SEC's
 * inverted "Name, Qualifier" style ("Korea, South", "Bahamas, The").
 * Case-insensitive. A US state name ("Ohio") is not a country and returns null.
 */
export function countryCodeFromName(name: string | null | undefined): CountryCode | null {
  if (!name) return null;
  const key = nameKey(name);
  if (!key) return null;
  const table = nameTable();
  const direct = table.get(key);
  if (direct) return direct;

  // "Falkland Islands (Malvinas)", "Holy See (Vatican City State)".
  const bare = key.replace(/\s*\(.*\)$/, '');
  if (bare !== key && table.has(bare)) return table.get(bare)!;

  // "Korea, South" → "south korea"; "Bahamas, The" → "the bahamas".
  const comma = key.indexOf(', ');
  if (comma > 0) {
    const flipped = nameKey(`${key.slice(comma + 2)} ${key.slice(0, comma)}`);
    return table.get(flipped) ?? null;
  }
  return null;
}

/** English display name for a code, or null for anything unassigned. */
export function countryName(code: string | null | undefined): string | null {
  const canonical = normalizeCountryCode(code);
  if (!canonical) return null;
  const label = new Intl.DisplayNames(['en'], { type: 'region' }).of(canonical);
  return label && label !== canonical ? label : null;
}

/** One country in a directory's country filter, with how many rows carry it. */
export interface CountryFacet {
  code: CountryCode;
  count: number;
}
