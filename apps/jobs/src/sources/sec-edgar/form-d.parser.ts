import { XMLParser } from 'fast-xml-parser';

export interface ParsedPerson {
  name: string;
  role: string;
  title: string | null;
}

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
  /** True for pooled-fund/SPV filers (industryGroupType = "Pooled Investment Fund"). */
  isPooledFund: boolean;
  /** True for D/A amendment filings. */
  isAmendment: boolean;
  /** Accession of the filing this D/A amends, or null. */
  previousAccession: string | null;
  /** Executives/directors from relatedPersonsList (fund administrators filtered out). */
  people: ParsedPerson[];
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

  const isPooledFund = industry === 'Pooled Investment Fund';
  const newOrAmendment = offering.typeOfFiling?.newOrAmendment ?? {};
  const isAmendment =
    newOrAmendment.isAmendment === true || str(newOrAmendment.isAmendment) === 'true';
  const previousAccession = str(newOrAmendment.previousAccessionNumber) || null;

  const people = parseRelatedPersons(sub.relatedPersonsList?.relatedPersonInfo);

  return {
    entityName,
    city,
    state,
    yearOfInc,
    industry,
    amountSoldUsd,
    dateOfFirstSale,
    isPooledFund,
    isAmendment,
    previousAccession,
    people,
  };
}

/** Fund administrators and similar entities file as "related persons" too —
 *  skip anything whose name reads like a company rather than an individual. */
const ENTITY_RE =
  /\b(llc|l\.l\.c\.?|lp|l\.p\.?|inc|ltd|corp|fund|capital|management|advis[oe]rs?|partners)\b/i;

function parseRelatedPersons(raw: unknown): ParsedPerson[] {
  const out: ParsedPerson[] = [];
  for (const info of toArray<Record<string, any>>(raw)) {
    const nameParts = info.relatedPersonName ?? {};
    const name = [nameParts.firstName, nameParts.middleName, nameParts.lastName]
      .map(str)
      .filter(Boolean)
      .join(' ');
    if (!name || ENTITY_RE.test(name)) continue;

    const relationships = toArray(info.relatedPersonRelationshipList?.relationship).map(str);
    const role = relationships.find(Boolean) ?? '';
    if (!role) continue;

    out.push({ name, role, title: str(info.relationshipClarification) || null });
  }
  return out;
}

/** fast-xml-parser yields an object for single children and an array for many. */
function toArray<T>(v: unknown): T[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
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
