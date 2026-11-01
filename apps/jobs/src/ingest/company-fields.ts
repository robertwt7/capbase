import type { NormalizedRecord } from '../sources/ingestion-source';

/** The company columns a record actually states (the create's own defaults —
 *  'Private', 'Undisclosed', 0, the SEC placeholder copy — are not statements). */
export function suppliedCompanyFields(c: NormalizedRecord['company']): string[] {
  const stated: Record<string, unknown> = {
    domain: c.domain,
    websiteUrl: c.websiteUrl,
    linkedinUrl: c.linkedinUrl,
    legalName: c.legalName,
    operatingStatus: c.operatingStatus,
    companyType: c.companyType,
    primarySector: c.primarySector,
    countryCode: c.countryCode,
    oneLiner: c.oneLiner,
    description: c.description,
    hq: c.hq,
    founded: c.foundedYear,
    headcount: c.headcount,
    industry: c.industry,
    status: c.status,
    stage: c.stage,
    totalRaisedUsd: c.totalRaisedUsd,
  };
  return Object.entries(stated)
    .filter(([, v]) => v != null && v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
}
