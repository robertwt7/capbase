import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type {
  AcquisitionDeal,
  ChangeProposalReview,
  Company,
  CompanyEditFields,
  DiversitySignal,
  ExitEvent,
  FundingRound,
  InvestorHolding,
  PendingSubmission,
  Person,
} from '@repo/api';

import { formatCount, formatDate, formatUsd, signedPct } from '../../lib/format';

import styles from './admin.module.css';

interface Field {
  label: string;
  value: ReactNode;
}

// Outbound link for a submitted URL (rendered monochrome, opens in a new tab).
function extLink(url: string | null | undefined): ReactNode {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={styles.detailLink}>
      {url}
    </a>
  );
}

// Money always renders — a null amount is *undisclosed*, not skipped. `formatUsd(null)`
// yields "Undisclosed" (the app-wide convention), so a blank/undisclosed figure reads the
// same here as on the public profile, and a future "submit as undisclosed" frontend just
// sends null. (Optional links/metadata below still skip when empty — those are "not
// provided", a different thing from "undisclosed".)
function usd(value: number | null | undefined): string {
  return formatUsd(value ?? null);
}

function companyFields(c: Company): Field[] {
  const fields: Field[] = [
    { label: 'One-liner', value: c.oneLiner },
    { label: 'Description', value: c.description },
    { label: 'Domain', value: c.domain },
    { label: 'Website', value: extLink(c.websiteUrl) },
    { label: 'LinkedIn', value: extLink(c.linkedinUrl) },
    { label: 'Twitter', value: extLink(c.twitterUrl) },
    { label: 'Legal name', value: c.legalName },
    { label: 'HQ', value: c.hq },
    { label: 'Founded', value: c.founded ? String(c.founded) : null },
    { label: 'Headcount', value: c.headcount ? formatCount(c.headcount) : null },
    { label: 'Industry', value: c.industry?.length ? c.industry.join(', ') : null },
    { label: 'Sector', value: c.primarySector },
    { label: 'Stage', value: c.stage },
    { label: 'Status', value: c.status },
    { label: 'Operating status', value: c.operatingStatus },
    { label: 'Company type', value: c.companyType },
    { label: 'Total raised', value: usd(c.totalRaisedUsd) },
    { label: 'Last valuation', value: usd(c.lastValuationUsd) },
  ];
  if (c.financials) {
    fields.push(
      { label: 'Revenue', value: usd(c.financials.revenueUsd) },
      { label: 'Revenue growth', value: signedPct(c.financials.revenueGrowthPct) },
      { label: 'Gross margin', value: `${c.financials.grossMarginPct}%` },
      {
        label: 'Burn months',
        value: c.financials.burnMonths === null ? null : String(c.financials.burnMonths),
      },
    );
  }
  return fields;
}

function roundFields(r: FundingRound): Field[] {
  const investors = r.investors
    .map((inv) => (inv.lead ? `${inv.name} (lead)` : inv.name))
    .join(', ');
  return [
    { label: 'Round', value: r.name },
    { label: 'Date', value: r.date ? formatDate(r.date) : null },
    { label: 'Amount', value: usd(r.amountUsd) },
    { label: 'Post-money', value: usd(r.postMoneyUsd) },
    { label: 'Lead', value: r.lead },
    { label: 'Investors', value: investors || null },
  ];
}

function personFields(p: Person): Field[] {
  return [
    { label: 'Name', value: p.name },
    { label: 'Title', value: p.title },
    { label: 'Role', value: p.role },
    { label: 'Since', value: p.since ? String(p.since) : null },
    { label: 'Prior', value: p.prior ?? null },
    { label: 'LinkedIn', value: extLink(p.linkedinUrl) },
  ];
}

function investorFields(i: InvestorHolding): Field[] {
  return [
    { label: 'Name', value: i.name },
    { label: 'Type', value: i.type },
    { label: 'First round', value: i.firstRound },
    { label: 'Rounds participated', value: i.rounds ? formatCount(i.rounds) : null },
    { label: 'Website', value: extLink(i.websiteUrl) },
    { label: 'LinkedIn', value: extLink(i.linkedinUrl) },
  ];
}

function acquisitionFields(a: AcquisitionDeal): Field[] {
  return [
    { label: 'Target', value: a.target },
    { label: 'Date', value: a.date ? formatDate(a.date) : null },
    { label: 'Amount', value: usd(a.amountUsd) },
    { label: 'Rationale', value: a.rationale },
  ];
}

function exitFields(e: ExitEvent): Field[] {
  return [
    { label: 'Type', value: e.type },
    { label: 'Date', value: e.date ? formatDate(e.date) : null },
    { label: 'Value', value: usd(e.valueUsd) },
    { label: 'Detail', value: e.detail },
  ];
}

function diversityFields(d: DiversitySignal): Field[] {
  return [
    { label: 'Label', value: d.label },
    { label: 'Value', value: d.value },
    { label: 'Note', value: d.note },
  ];
}

// Narrows the (unknown) payload by item.type — safe because the API builds `data`
// from these exact mappers (apps/api/src/companies/company.mapper.ts).
function buildFields(item: PendingSubmission): Field[] {
  switch (item.type) {
    case 'company':
      return companyFields(item.data as Company);
    case 'round':
      return roundFields(item.data as FundingRound);
    case 'person':
      return personFields(item.data as Person);
    case 'investor':
      return investorFields(item.data as InvestorHolding);
    case 'acquisition':
      return acquisitionFields(item.data as AcquisitionDeal);
    case 'exit':
      return exitFields(item.data as ExitEvent);
    case 'diversity':
      return diversityFields(item.data as DiversitySignal);
    default:
      return [];
  }
}

const EDIT_FIELD_LABELS: Record<keyof CompanyEditFields, string> = {
  name: 'Name',
  domain: 'Domain',
  oneLiner: 'One-liner',
  description: 'Description',
  hq: 'HQ',
  founded: 'Founded',
  headcount: 'Headcount',
  industry: 'Industry',
  status: 'Status',
  stage: 'Stage',
  totalRaisedUsd: 'Total raised',
  lastValuationUsd: 'Last valuation',
  websiteUrl: 'Website',
  linkedinUrl: 'LinkedIn',
  twitterUrl: 'Twitter',
  legalName: 'Legal name',
  operatingStatus: 'Operating status',
  companyType: 'Company type',
  primarySector: 'Sector',
};

// Renders one side of a diff cell. Unlike the row payloads above, a proposal
// value can legitimately be absent/null — that renders as "—", not skipped.
function formatEditValue(key: keyof CompanyEditFields, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'totalRaisedUsd' || key === 'lastValuationUsd') return usd(value as number);
  if (key === 'headcount') return formatCount(value as number);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Field / current → proposed rows for an edit proposal, one per changed field. */
function ProposalDiff({ review }: { review: ChangeProposalReview }) {
  const keys = Object.keys(review.changes) as (keyof CompanyEditFields)[];
  return (
    <>
      <div className={styles.diffGrid}>
        {keys.map((key) => (
          <Fragment key={key}>
            <span className={styles.detailLabel}>{EDIT_FIELD_LABELS[key] ?? key}</span>
            <span className={styles.diffCurrent}>{formatEditValue(key, review.current[key])}</span>
            <span className={styles.diffArrow} aria-hidden="true">
              →
            </span>
            <span className={styles.diffProposed}>{formatEditValue(key, review.changes[key])}</span>
          </Fragment>
        ))}
      </div>
      {review.note ? (
        <p className={styles.detailNote}>
          <span className={styles.detailNoteLabel}>Submitter&apos;s note</span>
          {review.note}
        </p>
      ) : null}
    </>
  );
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === '';
}

export function SubmissionDetail({ item }: { item: PendingSubmission }) {
  const isProposal = item.type === 'proposal';
  const fields = isProposal ? [] : buildFields(item).filter((f) => !isEmpty(f.value));

  // Child submissions carry their parent company; link it to the public profile.
  const companyLink =
    item.type !== 'company' && item.companySlug && item.companyName ? (
      <Link href={`/companies/${item.companySlug}`} className={styles.detailLink}>
        {item.companyName}
      </Link>
    ) : null;

  return (
    <>
      <dl className={styles.detailGrid}>
        {companyLink ? (
          <>
            <dt className={styles.detailLabel}>Company</dt>
            <dd className={styles.detailValue}>{companyLink}</dd>
          </>
        ) : null}
        {/* The cited source, so a moderator can check it before approving —
            the single highest-value use of the whole citation feature. */}
        {item.sourceUrl ? (
          <>
            <dt className={styles.detailLabel}>Source</dt>
            <dd className={styles.detailValue}>{extLink(item.sourceUrl)}</dd>
          </>
        ) : null}
        {fields.map((f) => (
          <Fragment key={f.label}>
            <dt className={styles.detailLabel}>{f.label}</dt>
            <dd className={styles.detailValue}>{f.value}</dd>
          </Fragment>
        ))}
      </dl>
      {isProposal ? <ProposalDiff review={item.data as ChangeProposalReview} /> : null}
      <p className={styles.detailFoot}>
        {item.submittedBy
          ? `Submitted by ${item.submittedBy.name} <${item.submittedBy.email}> · ${formatDate(item.createdAt)}`
          : 'Ingested automatically (no submitter)'}
      </p>
    </>
  );
}
