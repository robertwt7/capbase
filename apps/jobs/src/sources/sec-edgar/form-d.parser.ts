import { XMLParser } from 'fast-xml-parser';

import { looksLikeEntityName } from '../../util/text';

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
  /** Fund class from `investmentFundInfo.investmentFundType`, present only on
   *  pooled filings: Venture Capital Fund | Private Equity Fund | Hedge Fund |
   *  Other Investment Fund. A structured field, not a guess from the name. */
  investmentFundType: string;
  /** Target raise. NULL — not 0 — when the filing says "Indefinite", which
   *  51–67% of pooled filings do. Zero would read as "they targeted nothing". */
  totalOfferingUsd: number | null;
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
  const totalOfferingUsd = offeringAmount(amounts.totalOfferingAmount);

  const sale = offering.typeOfFiling?.dateOfFirstSale ?? offering.dateOfFirstSale;
  const dateOfFirstSale = isoDate(str(sale?.value));

  const isPooledFund = industry === 'Pooled Investment Fund';
  const investmentFundType = str(offering.industryGroup?.investmentFundInfo?.investmentFundType);
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
    investmentFundType,
    totalOfferingUsd,
    isAmendment,
    previousAccession,
    people,
  };
}

function parseRelatedPersons(raw: unknown): ParsedPerson[] {
  const out: ParsedPerson[] = [];
  for (const info of toArray<Record<string, any>>(raw)) {
    const nameParts = info.relatedPersonName ?? {};
    const name = [nameParts.firstName, nameParts.middleName, nameParts.lastName]
      .map(str)
      .filter(Boolean)
      .join(' ');
    // Fund administrators and similar entities file as "related persons" too —
    // skip anything whose name reads like a company rather than an individual.
    if (!name || looksLikeEntityName(name)) continue;

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

/**
 * `totalOfferingAmount` is either a number or the literal string "Indefinite".
 *
 * `num()` strips non-digits, so "Indefinite" would silently become 0 — a target
 * size of zero dollars, which is a claim the filing never made. Null is the
 * honest reading, and it is the common one: half to two thirds of pooled
 * filings declare an indefinite offering.
 */
function offeringAmount(v: unknown): number | null {
  const raw = str(v);
  if (!raw || /indefinite/i.test(raw)) return null;
  const n = num(raw);
  return n > 0 ? n : null;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
