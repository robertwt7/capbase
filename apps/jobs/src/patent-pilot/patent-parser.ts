import { XMLParser, XMLValidator } from 'fast-xml-parser';

type XmlNode = Record<string, unknown>;

export interface PatentPublication {
  publicationId: string;
  country: string;
  number: string;
  kind: string;
  title: string | null;
  applicants: { name: string; country: string | null }[];
  filingDate: string | null;
  publicationDate: string | null;
  classifications: string[];
  familyId: string | null;
  sourceUrl: string;
  /** Only reviewed EP/US grant kinds; other jurisdictions remain unclassified. */
  isReviewedGrantKind: boolean;
}

export interface PatentPage {
  publications: PatentPublication[];
  totalResults: number;
  begin: number;
  end: number;
  skippedRecords: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function node(value: unknown): XmlNode {
  return value && typeof value === 'object' ? (value as XmlNode) : {};
}

function list(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  const raw = typeof value === 'object' ? node(value)['#text'] : value;
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 1000) : '';
}

function date(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d{8}$/.test(raw)) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function number(value: unknown): number {
  const raw = text(value);
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

function documentId(reference: unknown): XmlNode {
  const ids = list(node(reference)['document-id']).map(node);
  return ids.find((id) => id['@_document-id-type'] === 'docdb') ?? ids[0] ?? {};
}

/** Original synthetic fixtures follow the documented OPS 3.2 exchange XML shape. */
export function parsePatentPage(xml: string): PatentPage {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('Unsupported or oversized OPS XML');
  }
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid OPS XML');
  const root = node(parser.parse(xml));
  const search = node(node(root['world-patent-data'])['biblio-search']);
  if (!/^\d+$/.test(text(search['@_total-result-count']))) throw new Error('Missing OPS search result');
  const range = node(search.range);
  const rawDocuments = list(node(search['search-result'])['exchange-documents'])
    .flatMap((group) => list(node(group)['exchange-document']));
  const publications = new Map<string, PatentPublication>();
  let skippedRecords = 0;
  for (const raw of rawDocuments) {
    const doc = node(raw);
    const biblio = node(doc['bibliographic-data']);
    const publication = documentId(biblio['publication-reference']);
    const country = text(publication.country) || text(doc['@_country']);
    const publicationNumber = text(publication['doc-number']) || text(doc['@_doc-number']);
    const kind = text(publication.kind) || text(doc['@_kind']);
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Za-z0-9]+$/.test(publicationNumber) || !/^[A-Z]\d{0,2}$/.test(kind)) {
      skippedRecords++;
      continue;
    }
    const publicationId = `${country}.${publicationNumber}.${kind}`;
    const allApplicants = list(node(node(biblio.parties).applicants).applicant).map(node);
    const epodocApplicants = allApplicants.filter((applicant) => applicant['@_data-format'] === 'epodoc');
    const applicants = (epodocApplicants.length ? epodocApplicants : allApplicants)
      .map((applicant) => {
        const name = node(applicant['applicant-name']);
        const addressbook = node(applicant.addressbook);
        return {
          name: text(name.name) || text(addressbook.name),
          country: text(node(name.address).country) || text(node(addressbook.address).country) || null,
        };
      })
      .filter((applicant) => applicant.name);
    const titles = list(biblio['invention-title']);
    const title = titles.find((item) => node(item)['@_lang'] === 'en') ?? titles[0];
    const ipc = list(node(biblio['classifications-ipcr'])['classification-ipcr'])
      .map((item) => text(node(item).text)).filter(Boolean);
    const cpc = list(node(biblio['patent-classifications'])['patent-classification'])
      .map((item) => {
        const classification = node(item);
        return [classification.section, classification.class, classification.subclass,
          classification['main-group'], classification.subgroup].map(text).filter(Boolean).join(' ');
      }).filter(Boolean);
    publications.set(publicationId, {
      publicationId, country, number: publicationNumber, kind,
      title: text(title) || null,
      applicants,
      filingDate: date(documentId(biblio['application-reference']).date),
      publicationDate: date(publication.date),
      classifications: [...new Set([...ipc, ...cpc])],
      familyId: text(doc['@_family-id']) || null,
      sourceUrl: `https://worldwide.espacenet.com/publicationDetails/biblio?CC=${country}&NR=${publicationNumber}&KC=${kind}`,
      isReviewedGrantKind: (country === 'EP' && ['B1', 'B2', 'B3'].includes(kind)) ||
        (country === 'US' && ['B1', 'B2'].includes(kind)),
    });
  }
  return {
    publications: [...publications.values()], totalResults: number(search['@_total-result-count']),
    begin: number(range['@_begin']), end: number(range['@_end']), skippedRecords,
  };
}

export function summarizePublications(publications: PatentPublication[]) {
  const unique = [...new Map(publications.map((item) => [item.publicationId, item])).values()];
  const dates = unique.map((item) => item.publicationDate).filter((item): item is string => item !== null).sort();
  return {
    retrievedPublications: unique.length,
    reviewedGrantKindPublications: unique.filter((item) => item.isReviewedGrantKind).length,
    retrievedFamilies: new Set(unique.map((item) => item.familyId).filter(Boolean)).size,
    missingFamilyIds: unique.filter((item) => !item.familyId).length,
    latestPublicationDate: dates.at(-1) ?? null,
    // Retrieval and latest publication date do not establish worldwide source coverage.
    sourceCoverageDate: null,
  };
}
