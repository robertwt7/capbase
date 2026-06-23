import { XMLParser } from 'fast-xml-parser';

export interface ParsedFormD {
  entityName: string;
  city: string;
  state: string;
  yearOfInc: number;
  industry: string;
  /** Total amount sold to date in USD (0 if undisclosed). */
  amountSoldUsd: number;
  /** ISO date of first sale, or null if not yet occurred. */
  dateOfFirstSale: string | null;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: true });

/** Extract the fields we need from a Form D primary_doc.xml. Returns null if
 *  the document lacks an issuer name (i.e. not a usable Form D). */
export function parseFormD(xml: string): ParsedFormD | null {
  const root = (parser.parse(xml) ?? {}) as Record<string, any>;
  const sub = root.edgarSubmission ?? {};
  const issuer = sub.primaryIssuer ?? {};
  const offering = sub.offeringData ?? {};

  const entityName = str(issuer.entityName);
  if (!entityName) return null;

  const address = issuer.issuerAddress ?? {};
  const city = str(address.city);
  const state = str(address.stateOrCountryDescription) || str(address.stateOrCountry);

  const yearOfInc = num(issuer.yearOfInc?.value);

  const industry = str(offering.industryGroup?.industryGroupType);

  const amounts = offering.offeringSalesAmounts ?? {};
  const amountSoldUsd = num(amounts.totalAmountSold) || num(amounts.totalOfferingAmount);

  const sale = offering.typeOfFiling?.dateOfFirstSale ?? offering.dateOfFirstSale;
  const dateOfFirstSale = isoDate(str(sale?.value));

  return {
    entityName,
    city,
    state,
    yearOfInc,
    industry,
    amountSoldUsd,
    dateOfFirstSale,
  };
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
