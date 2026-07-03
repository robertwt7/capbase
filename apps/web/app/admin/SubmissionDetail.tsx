import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type {
  AcquisitionDeal,
  Company,
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

// USD that participates in the "skip null" rule: null → omitted, not "Undisclosed".
function usd(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatUsd(value);
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

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === '';
}

export function SubmissionDetail({ item }: { item: PendingSubmission }) {
  const fields = buildFields(item).filter((f) => !isEmpty(f.value));

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
        {fields.map((f) => (
          <Fragment key={f.label}>
            <dt className={styles.detailLabel}>{f.label}</dt>
            <dd className={styles.detailValue}>{f.value}</dd>
          </Fragment>
        ))}
      </dl>
      <p className={styles.detailFoot}>
        {item.submittedBy
          ? `Submitted by ${item.submittedBy.name} <${item.submittedBy.email}> · ${formatDate(item.createdAt)}`
          : 'Ingested automatically (no submitter)'}
      </p>
    </>
  );
}
