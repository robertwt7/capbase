import type { CompanyEditFields, ReviewableType, ReviewStatus } from '@repo/api';

import type { PrismaService } from '../prisma/prisma.service';

/** Shown in the rejection email when the moderator left no note. */
export const DEFAULT_REJECTION_REASON =
  "The moderator didn't leave a note. The usual reasons are a missing or unverifiable " +
  'source, or a duplicate of something already on the page.';

/** Plain-English names for the editable company fields, as an edit's summary lists them. */
const FIELD_LABELS: Record<keyof CompanyEditFields, string> = {
  name: 'name',
  domain: 'domain',
  oneLiner: 'one-liner',
  description: 'description',
  hq: 'headquarters',
  founded: 'founding year',
  headcount: 'headcount',
  industry: 'industries',
  status: 'status',
  stage: 'stage',
  totalRaisedUsd: 'total raised',
  lastValuationUsd: 'last valuation',
  websiteUrl: 'website',
  linkedinUrl: 'LinkedIn',
  twitterUrl: 'Twitter',
  legalName: 'legal name',
  operatingStatus: 'operating status',
  companyType: 'company type',
  primarySector: 'sector',
};

/**
 * Everything the contributor email needs about one submission, read before the
 * decision so the email can say what it was and the service can tell a real
 * decision from a repeat of the current status.
 */
export interface SubmissionNotice {
  status: ReviewStatus;
  submitter: {
    email: string;
    name: string;
    role: 'USER' | 'ADMIN';
    bannedAt: Date | null;
    emailVerifiedAt: Date | null;
  } | null;
  /** A noun phrase: "the Series B round for Helia". */
  summary: string;
  companySlug: string;
  /** True for a whole new company profile, whose rejection points back at /contribute. */
  isCompany: boolean;
}

const submittedBy = {
  select: { email: true, name: true, role: true, bannedAt: true, emailVerifiedAt: true },
} as const;
const company = { select: { slug: true, name: true } } as const;

/**
 * Load one submission for its notice, or null when it doesn't exist (the
 * decision itself then 404s) or has no company to link to.
 *
 * Every contribution is a single row — a round carries its investors, an edit
 * proposal all its fields — so one decision is one email, never one per field.
 */
export async function loadSubmissionNotice(
  prisma: PrismaService,
  type: ReviewableType,
  id: string,
): Promise<SubmissionNotice | null> {
  const where = { id };
  const notice = (
    row: { moderationStatus: string; submittedBy: SubmissionNotice['submitter'] },
    on: { slug: string; name: string } | null,
    summary: (companyName: string) => string,
  ): SubmissionNotice | null =>
    on
      ? {
          status: row.moderationStatus as ReviewStatus,
          submitter: row.submittedBy,
          summary: summary(on.name),
          companySlug: on.slug,
          isCompany: type === 'company',
        }
      : null;

  switch (type) {
    case 'company': {
      const row = await prisma.company.findUnique({
        where,
        select: { moderationStatus: true, slug: true, name: true, submittedBy },
      });
      return row && notice(row, row, (c) => `a new profile for ${c}`);
    }
    case 'round': {
      const row = await prisma.fundingRound.findUnique({
        where,
        select: { moderationStatus: true, name: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `the ${row.name} round for ${c}`);
    }
    case 'person': {
      const row = await prisma.personRole.findUnique({
        where,
        select: { moderationStatus: true, name: true, role: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `${row.name} (${row.role}) at ${c}`);
    }
    case 'investor': {
      const row = await prisma.investorHolding.findUnique({
        where,
        select: { moderationStatus: true, name: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `${row.name} as an investor in ${c}`);
    }
    case 'acquisition': {
      const row = await prisma.acquisitionDeal.findUnique({
        where,
        select: { moderationStatus: true, target: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `${c}'s acquisition of ${row.target}`);
    }
    case 'exit': {
      const row = await prisma.exitEvent.findUnique({
        where,
        select: { moderationStatus: true, type: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `the ${row.type} exit for ${c}`);
    }
    case 'diversity': {
      const row = await prisma.diversitySignal.findUnique({
        where,
        select: { moderationStatus: true, label: true, company, submittedBy },
      });
      return row && notice(row, row.company, (c) => `the diversity signal "${row.label}" for ${c}`);
    }
    case 'proposal': {
      const row = await prisma.changeProposal.findUnique({
        where,
        select: { moderationStatus: true, changes: true, company, submittedBy },
      });
      if (!row) return null;
      const fields = Object.keys(row.changes as CompanyEditFields) as (keyof CompanyEditFields)[];
      const labels = fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
      return notice(row, row.company, (c) => `an edit to ${c} (${labels})`);
    }
  }
}

/**
 * Whether this decision should email the contributor. Not for: ingested rows
 * (no submitter), admins (they moderate their own work), banned users (a ban
 * already rejected their queue), an address nobody has confirmed (it may not be
 * theirs), or a decision that repeats the row's current status.
 */
export function shouldNotify(
  notice: SubmissionNotice | null,
  status: 'APPROVED' | 'REJECTED',
): notice is SubmissionNotice & { submitter: NonNullable<SubmissionNotice['submitter']> } {
  const who = notice?.submitter;
  return Boolean(
    notice &&
      who &&
      notice.status !== status &&
      who.role !== 'ADMIN' &&
      !who.bannedAt &&
      who.emailVerifiedAt,
  );
}
