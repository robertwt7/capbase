import Link from 'next/link';
import type { ReactNode } from 'react';

import type { MatchedRound } from '@repo/api';

import { Citation } from '@/components/Citation';
import { CompanyLogo } from '@/components/CompanyLogo';
import { isMasked, SignInChip, unlockOf } from '@/components/Masked';
import { Badge } from '@/components/ui';
import type { Company } from '@/lib/data';
import { countryName, formatCount, formatDate, formatMoney, formatUsd, foundedYear } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Optional columns the /companies directory can add (`?cols=`). */
export type CompanyColumn = 'country' | 'founded' | 'headcount';
const COLUMN_ORDER: readonly CompanyColumn[] = ['country', 'founded', 'headcount'];
const COLUMN_LABELS: Record<CompanyColumn, string> = {
  country: 'Country',
  founded: 'Founded',
  headcount: 'Headcount',
};

// Literal class strings, one per shape, so Tailwind sees every track list:
// [extra columns][financing column]. The base shape is the landing/markets one.
const TRACKS: Record<string, string> = {
  '0-0': 'grid-cols-[minmax(0,2.6fr)_1.1fr_1fr_1fr]',
  '1-0': 'grid-cols-[minmax(0,2.6fr)_1.1fr_0.8fr_1fr_1fr]',
  '2-0': 'grid-cols-[minmax(0,2.6fr)_1.1fr_0.8fr_0.8fr_1fr_1fr]',
  '3-0': 'grid-cols-[minmax(0,2.6fr)_1.1fr_0.8fr_0.8fr_0.8fr_1fr_1fr]',
  '0-1': 'grid-cols-[minmax(0,2.4fr)_1fr_1.6fr_1fr_1fr]',
  '1-1': 'grid-cols-[minmax(0,2.2fr)_1fr_0.8fr_1.6fr_1fr_1fr]',
  '2-1': 'grid-cols-[minmax(0,2fr)_1fr_0.8fr_0.8fr_1.6fr_1fr_1fr]',
  '3-1': 'grid-cols-[minmax(0,2fr)_1fr_0.8fr_0.8fr_0.8fr_1.6fr_1fr_1fr]',
};
const MOBILE =
  'gap-5 max-[700px]:grid-cols-2 max-[700px]:gap-y-3 max-[700px]:[&>:nth-child(-n+2)]:col-span-full';

/** The table's grid (tracks + gaps) for `extra` optional columns and, with
    `financing`, the matched-round column. The default call is the shape the
    landing page, markets and the skeletons share. On a phone each row stacks:
    the name on its own line, the stage and sector wrapping under it, then the
    figures two by two. */
export function companyColumns(extra = 0, financing = false): string {
  return `${TRACKS[`${Math.min(Math.max(extra, 0), 3)}-${financing ? 1 : 0}`]} ${MOBILE}`;
}

export const COMPANY_COLUMNS = companyColumns();

/** Presentational company directory table. Shared by the landing page,
    /companies, and /markets/[sector].

    `columns` adds optional fact columns and `matches` the Financing column
    (the latest round that satisfied the directory's financing criteria) —
    both /companies only.

    `locked` appends blurred, non-interactive rows under an overlay — the
    landing page's teaser for the contribution gate. They are hidden from
    assistive tech and unfocusable, so the overlay is the only thing read. */
export function CompanyTable({
  companies,
  locked,
  columns = [],
  matches,
}: {
  companies: Company[];
  locked?: { companies: Company[]; overlay: ReactNode };
  columns?: readonly CompanyColumn[];
  matches?: Record<string, MatchedRound>;
}) {
  const extra = COLUMN_ORDER.filter((c) => columns.includes(c));
  const grid = companyColumns(extra.length, Boolean(matches));
  const row = cn('grid items-center border-t border-line px-[22px] py-4', grid);
  return (
    <div
      className="overflow-hidden rounded-xl border border-line bg-surface"
      role="table"
      aria-label="Company directory"
    >
      <div
        className={cn(
          'grid items-center bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[700px]:hidden',
          grid,
        )}
        role="row"
      >
        <span role="columnheader">Company</span>
        <span role="columnheader">Stage</span>
        {extra.map((c) => (
          <span key={c} role="columnheader" className="text-right">
            {COLUMN_LABELS[c]}
          </span>
        ))}
        {matches ? <span role="columnheader">Financing</span> : null}
        <span role="columnheader" className="text-right">
          Last valuation
        </span>
        <span role="columnheader" className="text-right">
          Total raised
        </span>
      </div>

      {companies.map((company) => (
        // prefetch={false}: a profile prefetch runs its generateMetadata, i.e. an
        // uncached detail API call per row in view. The (profile) skeleton still
        // streams first on click. Every entity-profile link follows this rule.
        <Link
          key={company.slug}
          href={`/companies/${company.slug}`}
          prefetch={false}
          className={cn(row, 'transition-colors hover:bg-paper')}
          role="row"
        >
          <CompanyCells
            company={company}
            extra={extra}
            financing={matches ? (matches[company.slug] ?? null) : undefined}
          />
        </Link>
      ))}

      {locked && locked.companies.length > 0 && (
        <div className="relative">
          <div aria-hidden inert className="pointer-events-none blur-[5px] select-none">
            {locked.companies.map((company) => (
              <div key={company.slug} className={row}>
                <CompanyCells company={company} extra={extra} />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-paper/45 p-4">
            {locked.overlay}
          </div>
        </div>
      )}
    </div>
  );
}

const DASH = <span className="text-graphite-400">—</span>;

function CompanyCells({
  company,
  extra,
  financing,
}: {
  company: Company;
  extra: readonly CompanyColumn[];
  /** Undefined: no Financing column. Null: no matched round for this row. */
  financing?: MatchedRound | null;
}) {
  // A value the API withheld from this viewer is blank in the payload: a plain
  // chip stands in (the row is already a link, so it cannot be one), saying
  // what reveals it.
  const chip = (field: string) => (
    <SignInChip next="/companies" link={false} unlockBy={unlockOf(company, field)} />
  );
  const masked = (field: string) => isMasked(company, field);
  const extraValue = (c: CompanyColumn): ReactNode => {
    if (c === 'country') {
      return masked('countryCode') ? chip('countryCode') : (countryName(company.countryCode) ?? DASH);
    }
    if (c === 'founded') return masked('founded') ? chip('founded') : (foundedYear(company.founded) ?? DASH);
    return masked('headcount') ? chip('headcount') : company.headcount > 0 ? formatCount(company.headcount) : DASH;
  };
  return (
    <>
      <span className="flex min-w-0 items-center gap-3.5" role="cell">
        <CompanyLogo name={company.name} domain={company.domain} size={40} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-base font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
            {company.name}
          </span>
          <span className="truncate text-[13px] text-graphite-500">
            {masked('oneLiner') ? null : company.oneLiner}
          </span>
        </span>
      </span>
      <span
        className="flex min-w-0 flex-col items-start gap-1.5 max-[700px]:flex-row max-[700px]:flex-wrap max-[700px]:items-center max-[700px]:gap-x-2 max-[700px]:gap-y-1"
        role="cell"
      >
        {masked('stage') ? chip('stage') : <Badge variant="pill">{company.stage}</Badge>}
        <span className="text-xs text-graphite-500">
          {masked('primarySector') ? null : (company.primarySector ?? company.industry[0])}
        </span>
      </span>
      {extra.map((c) => (
        <span
          key={c}
          className="text-right font-mono text-[14px] text-graphite-700 max-[700px]:flex max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-0.5"
          role="cell"
        >
          <MobileLabel>{COLUMN_LABELS[c]}</MobileLabel>
          {extraValue(c)}
        </span>
      ))}
      {financing !== undefined ? <FinancingCell round={financing} /> : null}
      <span
        className="text-right font-mono text-base font-medium text-ink max-[700px]:flex max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-0.5"
        role="cell"
      >
        <MobileLabel>Last valuation</MobileLabel>
        {masked('lastValuationUsd') ? chip('lastValuationUsd') : formatUsd(company.lastValuationUsd)}
      </span>
      <span
        className="text-right font-mono text-[15px] text-graphite-700 max-[700px]:flex max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-0.5"
        role="cell"
      >
        <MobileLabel>Total raised</MobileLabel>
        {masked('totalRaisedUsd') ? chip('totalRaisedUsd') : formatUsd(company.totalRaisedUsd)}
      </span>
    </>
  );
}

/** The latest round that met every financing criterion: its label and kind,
    date, amount (its own currency first, ≈ USD beside a non-USD one; an em
    dash for an undisclosed amount) and source marker. */
function FinancingCell({ round }: { round: MatchedRound | null }) {
  if (!round) {
    return (
      <span role="cell" className="max-[700px]:col-span-full">
        {DASH}
      </span>
    );
  }
  const chip = (field: string) => (
    <SignInChip next="/companies" link={false} unlockBy={round.maskedUnlock?.[field] ?? 'signIn'} />
  );
  const masked = (field: string) => isMasked(round, field);
  const amount = masked('amountUsd')
    ? chip('amountUsd')
    : round.amountUsd === 0
      ? DASH
      : round.currency !== 'USD' && round.amountLocal !== null
        ? (
            <>
              {formatMoney(round.amountLocal, round.currency)}
              <span className="ml-1.5 text-graphite-500">≈ {formatUsd(round.amountUsd)}</span>
            </>
          )
        : formatUsd(round.amountUsd);
  return (
    <span
      role="cell"
      className="flex min-w-0 flex-col items-start gap-1 max-[700px]:col-span-full max-[700px]:gap-0.5"
    >
      <MobileLabel>Matching financing</MobileLabel>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate text-[13px] text-ink">{masked('name') ? chip('name') : round.name}</span>
        <Badge variant="box" mono>
          {round.kind}
        </Badge>
      </span>
      <span className="font-mono text-[13px] text-graphite-700">
        {masked('date') ? chip('date') : formatDate(round.date)}
        <span className="mx-1.5 text-graphite-400">·</span>
        {amount}
        <Citation citations={round.citation ? [round.citation] : []} entityId={round.id} link={false} />
      </span>
    </span>
  );
}

/** The column header, repeated inside the cell where the header strip is
    hidden — two bare figures side by side would not say which is which. */
function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="hidden text-[10px] tracking-[0.05em] text-graphite-500 uppercase max-[700px]:block">
      {children}
    </span>
  );
}
