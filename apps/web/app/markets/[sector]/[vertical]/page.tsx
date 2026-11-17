import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { VERTICAL_SECTOR, verticalFromSlug, type Sector, type Vertical } from '@repo/api';

import { CompanyTable } from '@/components/CompanyTable';
import { LockedSection } from '@/components/LockedSection';
import { EmptyState, Eyebrow, PageContainer, SectionHeader, Stat } from '@/components/ui';
import { getVerticalMarket } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';
import { sectorFromSlug, sectorSlug } from '@/lib/markets';
import { canonical } from '@/lib/metadata';

type Params = Promise<{ sector: string; vertical: string }>;

/** The sector and vertical a URL names, when the vertical sits under that sector. */
function resolve(p: {
  sector: string;
  vertical: string;
}): { sector: Sector; vertical: Vertical } | null {
  const sector = sectorFromSlug(p.sector);
  const vertical = verticalFromSlug(p.vertical);
  if (!sector || !vertical || VERTICAL_SECTOR[vertical] !== sector) return null;
  return { sector, vertical };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await params;
  const names = resolve(p);
  // The page itself 404s; calling notFound() here too puts the not-found title in the head.
  if (!names) notFound();
  const market = await getVerticalMarket(p.vertical);
  if (!market) notFound();
  const { sector, vertical } = names;

  return {
    title: `${vertical} Companies — ${sector} Market Data`,
    // The public member count: never a figure only some viewers may read.
    description: `${formatCount(market.stat.companyCount)} ${vertical.toLowerCase()} companies on Capbase, by stage, with their funding — free, open market data for ${sector.toLowerCase()}.`,
    ...canonical(`/markets/${sectorSlug(sector)}/${market.stat.slug}`),
    ...(!market.indexable && { robots: { index: false, follow: true } }),
  };
}

export default async function VerticalPage({ params }: { params: Params }) {
  const p = await params;
  const names = resolve(p);
  if (!names) notFound();
  const market = await getVerticalMarket(p.vertical);
  if (!market) notFound();

  const { sector, vertical } = names;
  const { stat, visible, access } = market;
  const sectorBase = `/markets/${sectorSlug(sector)}`;
  const path = `${sectorBase}/${stat.slug}`;
  const seeAll = (stage: string) =>
    `/companies?${new URLSearchParams({ vertical, stage }).toString()}`;

  return (
    <PageContainer className="pt-14 pb-20">
      <Eyebrow>
        <Link href="/markets" className="transition-colors hover:text-ink">
          Markets
        </Link>{' '}
        /{' '}
        <Link href={sectorBase} className="transition-colors hover:text-ink">
          {sector}
        </Link>{' '}
        / {vertical}
      </Eyebrow>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
        {vertical}
      </h1>

      <div
        className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
        aria-label={`${vertical} market stats`}
      >
        <Stat size="lg" label="Companies" value={formatCount(visible.companyCount)} />
        <Stat
          size="lg"
          label="Capital raised"
          value={
            visible.totalRaisedUsd === null || visible.totalRaisedUsd === 0
              ? '—'
              : formatUsd(visible.totalRaisedUsd)
          }
        />
        <Stat size="lg" label="Disclosed deals" value={formatCount(visible.dealCount)} />
        {visible.companyCount < stat.companyCount ? (
          <p className="font-mono text-xs text-graphite-500">
            of {formatCount(stat.companyCount)} companies recorded
          </p>
        ) : null}
      </div>

      {visible.stages.length > 0 ? (
        <div className="mt-10 flex flex-col gap-10">
          <SectionHeader title="By stage" note={`${formatCount(visible.companyCount)} companies`} />
          {visible.stages.map((g) => (
            <section key={g.stage} aria-label={`${g.stage} companies`}>
              <h2 className="font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
                <span className="text-ink">{g.stage}</span> · {formatCount(g.companyCount)}{' '}
                {g.companyCount === 1 ? 'company' : 'companies'}
                {g.totalRaisedUsd ? ` · ${formatUsd(g.totalRaisedUsd)}` : ''}
              </h2>
              <div className="mt-3">
                <CompanyTable companies={g.companies} />
              </div>
              {g.companyCount > g.companies.length ? (
                <Link
                  href={seeAll(g.stage)}
                  className="mt-3 inline-block font-mono text-xs text-graphite-700 underline underline-offset-[3px] transition-colors hover:text-ink"
                >
                  See all {formatCount(g.companyCount)} →
                </Link>
              ) : null}
            </section>
          ))}
        </div>
      ) : market.unlockBy === null && visible.companyCount === stat.companyCount ? (
        <EmptyState className="mt-10">No companies in this vertical yet.</EmptyState>
      ) : null}

      <LockedSection
        access={access}
        view={{
          disabled: false,
          adminOnly: false,
          unlockBy: market.unlockBy ?? (access.signedIn ? 'contribute' : 'signIn'),
        }}
        total={stat.companyCount}
        shown={visible.companyCount}
        noun="companies"
        placeholder="row"
        next={path}
        className="mt-10"
      />
    </PageContainer>
  );
}
