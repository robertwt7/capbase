import Link from 'next/link';
import type { Company } from '@repo/api';

import { CompanyLogo } from '@/components/CompanyLogo';
import { EmptyState, PageContainer, SectionHeader } from '@/components/ui';
import { getCompanies } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';

import { ComparePicker } from './ComparePicker';

export const metadata = {
  title: 'Compare companies',
  description:
    'Line up funding, stage, valuation, and scale for up to four private companies side by side.',
  // Selection query variants canonicalise to the bare compare URL.
  alternates: { canonical: '/compare' },
};

const MAX_COMPARE = 4;

// Public summary facts shown side by side — everything on the base Company type.
const FACTS: { label: string; value: (c: Company) => string }[] = [
  { label: 'Sector', value: (c) => c.primarySector ?? '—' },
  { label: 'Stage', value: (c) => c.stage },
  { label: 'Status', value: (c) => c.status },
  { label: 'Founded', value: (c) => c.founded.toString() },
  { label: 'HQ', value: (c) => c.hq },
  { label: 'Headcount', value: (c) => formatCount(c.headcount) },
  { label: 'Total raised', value: (c) => formatUsd(c.totalRaisedUsd) },
  { label: 'Last valuation', value: (c) => formatUsd(c.lastValuationUsd) },
];

function compareHref(slugs: string[]) {
  return slugs.length ? `/compare?companies=${slugs.join(',')}` : '/compare';
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ companies?: string }>;
}) {
  const { companies: raw } = await searchParams;

  // Unknown slugs are silently dropped; duplicates collapse; cap at 4.
  const slugs = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_COMPARE);

  // Fetch exactly the selected companies; preserve the URL's column order.
  const { items } = slugs.length
    ? await getCompanies({ slugs: slugs.join(','), pageSize: MAX_COMPARE })
    : { items: [] as Company[] };
  const selected = slugs
    .map((s) => items.find((c) => c.slug === s))
    .filter((c): c is Company => Boolean(c));
  const current = selected.map((c) => c.slug);

  return (
    <PageContainer as="main" className="pt-8 pb-20">
      <SectionHeader
        as="h1"
        title="Compare companies"
        note={selected.length > 0 ? `${selected.length} of ${MAX_COMPARE}` : undefined}
      />

      {selected.length === 0 ? (
        <div className="mt-7">
          <EmptyState>
            Nothing to compare yet — add companies below to line up their funding, stage, and
            scale side by side.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-7 overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full min-w-[640px] border-collapse bg-surface">
            <thead>
              <tr>
                <th className="w-44 p-4" />
                {selected.map((c) => (
                  <th key={c.slug} className="border-l border-line p-4 text-left align-top">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <CompanyLogo name={c.name} domain={c.domain} size={36} />
                        <Link
                          href={`/companies/${c.slug}`}
                          className="font-display text-[15px] font-semibold text-ink underline-offset-[3px] hover:underline"
                        >
                          {c.name}
                        </Link>
                      </div>
                      <Link
                        href={compareHref(current.filter((s) => s !== c.slug))}
                        aria-label={`Remove ${c.name} from comparison`}
                        className="font-mono text-base leading-none text-graphite-500 transition-colors hover:text-ink"
                      >
                        ×
                      </Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FACTS.map((fact) => (
                <tr key={fact.label}>
                  <th
                    scope="row"
                    className="border-t border-line px-4 py-3 text-left font-mono text-[11px] font-medium tracking-[0.14em] text-graphite-500 uppercase"
                  >
                    {fact.label}
                  </th>
                  {selected.map((c) => (
                    <td
                      key={c.slug}
                      className="border-t border-l border-line px-4 py-3 font-mono text-sm text-ink"
                    >
                      {fact.value(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-7">
        {selected.length < MAX_COMPARE ? (
          <ComparePicker key={current.join(',')} current={current} />
        ) : (
          <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-graphite-500 uppercase">
            Up to {MAX_COMPARE} companies
          </p>
        )}
      </div>
    </PageContainer>
  );
}
