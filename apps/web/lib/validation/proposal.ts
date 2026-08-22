import {
  COMPANY_TYPES,
  OPERATING_STATUSES,
  SECTORS,
  type Company,
  type CompanyEditFields,
  type CompanyStatus,
  type CompanyType,
  type CreateChangeProposalInput,
  type OperatingStatus,
  type Sector,
  type Stage,
} from '@repo/api';
import { z } from 'zod';

import { companyFormSchema } from './company';
import { urlOrEmpty } from './utils';

// Optional vocab select: '' means unset, mirroring a null column on the row.
const vocabOrEmpty = (values: readonly string[]) =>
  z.enum(['', ...values] as readonly [string, ...string[]]);

/** The full company form, pre-fillable: everything `companyFormSchema` has plus
    the link/metadata fields, all string-valued. `primarySector` is relaxed to
    allow '' because existing rows (e.g. SEC-ingested) can hold null. */
export const editFormSchema = companyFormSchema.extend({
  primarySector: vocabOrEmpty(SECTORS),
  websiteUrl: urlOrEmpty,
  linkedinUrl: urlOrEmpty,
  twitterUrl: urlOrEmpty,
  legalName: z.string().trim(),
  operatingStatus: vocabOrEmpty(OPERATING_STATUSES),
  companyType: vocabOrEmpty(COMPANY_TYPES),
  note: z.string().trim().max(500, 'Keep the note under 500 characters.'),
});

export type EditFormValues = z.infer<typeof editFormSchema>;

/** Pre-fill the edit form from the live company: numbers → strings, nulls → ''. */
export function editDefaultsFromCompany(company: Company): EditFormValues {
  return {
    name: company.name,
    domain: company.domain,
    oneLiner: company.oneLiner,
    description: company.description,
    hq: company.hq,
    founded: String(company.founded),
    headcount: String(company.headcount),
    totalRaisedUsd: String(company.totalRaisedUsd),
    lastValuationUsd: company.lastValuationUsd == null ? '' : String(company.lastValuationUsd),
    industry: company.industry.join(', '),
    primarySector: company.primarySector ?? '',
    status: company.status,
    stage: company.stage,
    websiteUrl: company.websiteUrl ?? '',
    linkedinUrl: company.linkedinUrl ?? '',
    twitterUrl: company.twitterUrl ?? '',
    legalName: company.legalName ?? '',
    operatingStatus: company.operatingStatus ?? '',
    companyType: company.companyType ?? '',
    // The source is about *this* edit, so it never pre-fills from the company.
    sourceUrl: '',
    note: '',
  };
}

const strOrNull = (s: string): string | null => (s === '' ? null : s);

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

/** Map form values to `CompanyEditFields` shapes, diff against the company's
    current values, and keep only the differences. Returns null when nothing
    changed (empty-string optionals compare as null). */
export function toProposalInput(
  v: EditFormValues,
  current: Company,
): CreateChangeProposalInput | null {
  const candidate: Required<CompanyEditFields> = {
    name: v.name,
    domain: v.domain,
    oneLiner: v.oneLiner,
    description: v.description,
    hq: v.hq,
    founded: Number(v.founded),
    headcount: Number(v.headcount),
    industry: v.industry
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    status: v.status as CompanyStatus,
    stage: v.stage as Stage,
    totalRaisedUsd: Number(v.totalRaisedUsd),
    lastValuationUsd: v.lastValuationUsd === '' ? null : Number(v.lastValuationUsd),
    websiteUrl: strOrNull(v.websiteUrl),
    linkedinUrl: strOrNull(v.linkedinUrl),
    twitterUrl: strOrNull(v.twitterUrl),
    legalName: strOrNull(v.legalName),
    operatingStatus: strOrNull(v.operatingStatus) as OperatingStatus | null,
    companyType: strOrNull(v.companyType) as CompanyType | null,
    primarySector: strOrNull(v.primarySector) as Sector | null,
  };

  const currentView: Required<CompanyEditFields> = {
    name: current.name,
    domain: current.domain,
    oneLiner: current.oneLiner,
    description: current.description,
    hq: current.hq,
    founded: current.founded,
    headcount: current.headcount,
    industry: current.industry,
    status: current.status,
    stage: current.stage,
    totalRaisedUsd: current.totalRaisedUsd,
    lastValuationUsd: current.lastValuationUsd ?? null,
    websiteUrl: current.websiteUrl ?? null,
    linkedinUrl: current.linkedinUrl ?? null,
    twitterUrl: current.twitterUrl ?? null,
    legalName: current.legalName ?? null,
    operatingStatus: current.operatingStatus ?? null,
    companyType: current.companyType ?? null,
    primarySector: current.primarySector ?? null,
  };

  const changes: CompanyEditFields = {};
  for (const key of Object.keys(candidate) as (keyof CompanyEditFields)[]) {
    if (!sameValue(candidate[key], currentView[key])) {
      (changes as Record<string, unknown>)[key] = candidate[key];
    }
  }
  if (Object.keys(changes).length === 0) return null;

  const note = v.note.trim();
  return {
    changes,
    ...(note ? { note } : {}),
    ...(v.sourceUrl ? { sourceUrl: v.sourceUrl } : {}),
  };
}
