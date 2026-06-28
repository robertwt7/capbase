import { COMPANY_STATUSES, SECTORS, STAGES, type CreateCompanyInput } from '@repo/api';
import { z } from 'zod';

// Form values are all strings (that's what the inputs hold); numeric fields are
// validated as digit-strings and converted in `toCompanyInput`. Keeping the form
// shape string-only makes react-hook-form defaults and typing trivial.
const NEXT_YEAR = new Date().getFullYear() + 1;

export const companyFormSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required.'),
  domain: z
    .string()
    .trim()
    .min(1, 'Website domain is required.')
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'Enter a valid domain like acme.com.'),
  oneLiner: z
    .string()
    .trim()
    .min(1, 'A one-liner is required.')
    .max(160, 'Keep the one-liner under 160 characters.'),
  description: z.string().trim().min(1, 'A description is required.'),
  hq: z.string().trim().min(1, 'Headquarters is required.'),
  founded: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter a 4-digit year.')
    .refine((v) => Number(v) >= 1800 && Number(v) <= NEXT_YEAR, 'Enter a realistic year.'),
  headcount: z.string().trim().regex(/^\d+$/, 'Enter a whole number.'),
  totalRaisedUsd: z.string().trim().regex(/^\d+$/, 'Enter a whole number.'),
  lastValuationUsd: z.string().trim().regex(/^\d*$/, 'Enter a whole number.'),
  industry: z.string().trim().min(1, 'Add at least one industry tag (comma-separated).'),
  primarySector: z.enum(SECTORS as readonly [string, ...string[]], {
    message: 'Pick a valid sector.',
  }),
  status: z.enum(COMPANY_STATUSES as readonly [string, ...string[]], {
    message: 'Pick a valid status.',
  }),
  stage: z.enum(STAGES as readonly [string, ...string[]], { message: 'Pick a valid stage.' }),
});

export type CompanyFormValues = z.infer<typeof companyFormSchema>;

export const companyFormDefaults: CompanyFormValues = {
  name: '',
  domain: '',
  oneLiner: '',
  description: '',
  hq: '',
  founded: '',
  headcount: '',
  totalRaisedUsd: '',
  lastValuationUsd: '',
  industry: '',
  primarySector: '' as CompanyFormValues['primarySector'],
  status: 'Private' as CompanyFormValues['status'],
  stage: 'Seed' as CompanyFormValues['stage'],
};

/** Map validated form values to the API payload (`@repo/api` is the source of truth). */
export function toCompanyInput(v: CompanyFormValues): CreateCompanyInput {
  return {
    name: v.name,
    domain: v.domain,
    oneLiner: v.oneLiner,
    description: v.description,
    hq: v.hq,
    founded: Number(v.founded),
    headcount: Number(v.headcount),
    totalRaisedUsd: Number(v.totalRaisedUsd),
    industry: v.industry
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    primarySector: v.primarySector as CreateCompanyInput['primarySector'],
    status: v.status as CreateCompanyInput['status'],
    stage: v.stage as CreateCompanyInput['stage'],
    ...(v.lastValuationUsd ? { lastValuationUsd: Number(v.lastValuationUsd) } : {}),
  };
}
