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
import { cn } from '../../lib/utils';

interface Field {
  label: string;
  value: ReactNode;
  /** Long text or a URL: spans the full card width instead of one column. */
  wide?: boolean;
}

const LABEL = 'font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase';
const VALUE = 'text-[13px] text-ink [overflow-wrap:anywhere]';

// Outbound link for a submitted URL (rendered monochrome, opens in a new tab).
function extLink(url: string | null | undefined): ReactNode {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-[3px]">
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
    { label: 'One-liner', wide: true, value: c.oneLiner },
    { label: 'Description', wide: true, value: c.description },
    { label: 'Domain', value: c.domain },
    { label: 'Website', wide: true, value: extLink(c.websiteUrl) },
    { label: 'LinkedIn', wide: true, value: extLink(c.linkedinUrl) },
    { label: 'Twitter', wide: true, value: extLink(c.twitterUrl) },
    { label: 'Legal name', value: c.legalName },
    { label: 'HQ', value: c.hq },
    { label: 'Founded', value: c.founded ? String(c.founded) : null },
    { label: 'Headcount', value: c.headcount ? formatCount(c.headcount) : null },
    { label: 'Industry', wide: true, value: c.industry?.length ? c.industry.join(', ') : null },
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
    { label: 'Investors', wide: true, value: investors || null },
  ];
}

function personFields(p: Person): Field[] {
  return [
    { label: 'Name', value: p.name },
    { label: 'Title', value: p.title },
    { label: 'Role', value: p.role },
    { label: 'Since', value: p.since ? String(p.since) : null },
    { label: 'Prior', wide: true, value: p.prior ?? null },
    { label: 'LinkedIn', wide: true, value: extLink(p.linkedinUrl) },
  ];
}

function investorFields(i: InvestorHolding): Field[] {
  return [
    { label: 'Name', value: i.name },
    { label: 'Type', value: i.type },
    { label: 'First round', value: i.firstRound },
    { label: 'Rounds participated', value: i.rounds ? formatCount(i.rounds) : null },
    { label: 'Website', wide: true, value: extLink(i.websiteUrl) },
    { label: 'LinkedIn', wide: true, value: extLink(i.linkedinUrl) },
  ];
}

function acquisitionFields(a: AcquisitionDeal): Field[] {
  return [
    { label: 'Target', value: a.target },
    { label: 'Date', value: a.date ? formatDate(a.date) : null },
    { label: 'Amount', value: usd(a.amountUsd) },
    { label: 'Rationale', wide: true, value: a.rationale },
  ];
}

function exitFields(e: ExitEvent): Field[] {
  return [
    { label: 'Type', value: e.type },
    { label: 'Date', value: e.date ? formatDate(e.date) : null },
    { label: 'Value', value: usd(e.valueUsd) },
    { label: 'Detail', wide: true, value: e.detail },
  ];
}

function diversityFields(d: DiversitySignal): Field[] {
  return [
    { label: 'Label', value: d.label },
    { label: 'Value', value: d.value },
    { label: 'Note', wide: true, value: d.note },
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

/** Field / current → proposed rows for an edit proposal, one per changed field.
 *  Stacks under `sm`, the arrow turning to point down at the proposed value. */
function ProposalDiff({ review }: { review: ChangeProposalReview }) {
  const keys = Object.keys(review.changes) as (keyof CompanyEditFields)[];
  return (
    <div className="grid grid-cols-[7.5rem_1fr_auto_1fr] items-baseline gap-x-4 gap-y-2 max-sm:grid-cols-1 max-sm:gap-y-0.5">
      {keys.map((key) => (
        <Fragment key={key}>
          <span className={cn(LABEL, 'max-sm:not-first:mt-3')}>{EDIT_FIELD_LABELS[key] ?? key}</span>
          <span className={cn(VALUE, 'text-graphite-500')}>
            {formatEditValue(key, review.current[key])}
          </span>
          <span
            className="font-mono text-[12px] text-graphite-500 max-sm:justify-self-start max-sm:rotate-90"
            aria-hidden="true"
          >
            →
          </span>
          <span className={cn(VALUE, 'font-medium')}>
            {formatEditValue(key, review.changes[key])}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Label/value pairs: short facts two to a row on wider screens, long ones
 *  across the full width; under 480px each label sits above its value. */
function FieldList({ fields }: { fields: Field[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      {fields.map((f) => (
        <div
          key={f.label}
          className={cn(
            'grid grid-cols-[7.5rem_1fr] items-baseline gap-x-3 max-[480px]:grid-cols-1',
            f.wide && 'sm:col-span-2',
          )}
        >
          <dt className={LABEL}>{f.label}</dt>
          <dd className={cn(VALUE, 'whitespace-pre-line')}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === '';
}

export function SubmissionDetail({ item }: { item: PendingSubmission }) {
  // The cited source comes first, so a moderator can check it before reading
  // anything else — the single highest-value use of the citation feature.
  const source: Field[] = item.sourceUrl
    ? [{ label: 'Source', wide: true, value: extLink(item.sourceUrl) }]
    : [];

  if (item.type === 'proposal') {
    const review = item.data as ChangeProposalReview;
    return (
      <div className="flex flex-col gap-4">
        {source.length ? <FieldList fields={source} /> : null}
        <ProposalDiff review={review} />
        {review.note ? (
          <FieldList fields={[{ label: "Submitter's note", wide: true, value: review.note }]} />
        ) : null}
      </div>
    );
  }

  const fields = [...source, ...buildFields(item)].filter((f) => !isEmpty(f.value));
  return fields.length ? (
    <FieldList fields={fields} />
  ) : (
    <p className="text-[13px] text-graphite-500">No fields submitted.</p>
  );
}
