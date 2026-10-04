import Link from 'next/link';
import type { ReactNode } from 'react';

import { CompanyLogo } from '@/components/CompanyLogo';
import { Badge } from '@/components/ui';
import type { Company } from '@/lib/data';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const ROW =
  'grid grid-cols-[minmax(0,2.6fr)_1.1fr_1fr_1fr] items-center gap-5 border-t border-line px-[22px] py-4 max-[700px]:grid-cols-[1fr_auto] max-[700px]:gap-y-3';

/** Presentational company directory table. Shared by the landing page,
    /companies, and /markets/[sector].

    `locked` appends blurred, non-interactive rows under an overlay — the
    landing page's teaser for the contribution gate. They are hidden from
    assistive tech and unfocusable, so the overlay is the only thing read. */
export function CompanyTable({
  companies,
  locked,
}: {
  companies: Company[];
  locked?: { companies: Company[]; overlay: ReactNode };
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-line bg-surface"
      role="table"
      aria-label="Company directory"
    >
      <div
        className="grid grid-cols-[minmax(0,2.6fr)_1.1fr_1fr_1fr] items-center gap-5 bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[700px]:hidden"
        role="row"
      >
        <span role="columnheader">Company</span>
        <span role="columnheader">Stage</span>
        <span role="columnheader" className="text-right">
          Last valuation
        </span>
        <span role="columnheader" className="text-right">
          Total raised
        </span>
      </div>

      {companies.map((company) => (
        <Link
          key={company.slug}
          href={`/companies/${company.slug}`}
          className={cn(ROW, 'transition-colors hover:bg-paper')}
          role="row"
        >
          <CompanyCells company={company} />
        </Link>
      ))}

      {locked && locked.companies.length > 0 && (
        <div className="relative">
          <div aria-hidden inert className="pointer-events-none blur-[5px] select-none">
            {locked.companies.map((company) => (
              <div key={company.slug} className={ROW}>
                <CompanyCells company={company} />
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

function CompanyCells({ company }: { company: Company }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-3.5" role="cell">
        <CompanyLogo name={company.name} domain={company.domain} size={40} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-base font-semibold tracking-tight text-ink">
            {company.name}
          </span>
          <span className="truncate text-[13px] text-graphite-500">{company.oneLiner}</span>
        </span>
      </span>
      <span
        className="flex flex-col items-start gap-1.5 max-[700px]:flex-row max-[700px]:items-center max-[700px]:gap-2"
        role="cell"
      >
        <Badge variant="pill">{company.stage}</Badge>
        <span className="text-xs text-graphite-500">
          {company.primarySector ?? company.industry[0]}
        </span>
      </span>
      <span
        className="text-right font-mono text-base font-medium text-ink max-[700px]:col-start-1 max-[700px]:text-left"
        role="cell"
      >
        {formatUsd(company.lastValuationUsd)}
      </span>
      <span
        className="text-right font-mono text-[15px] text-graphite-700 max-[700px]:col-start-1 max-[700px]:text-left"
        role="cell"
      >
        {formatUsd(company.totalRaisedUsd)}
      </span>
    </>
  );
}
