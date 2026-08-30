import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Citation } from '@/components/Citation';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Badge, Button, EmptyState, SectionHeader } from '@/components/ui';
import { getInvestor } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';

const DESCRIPTION_MAX = 160;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const investor = await getInvestor(slug);
  if (!investor) return {};

  const facts = [
    `${investor.type} investor`,
    investor.hq,
    investor.portfolioCount > 0 ? `${formatCount(investor.portfolioCount)} portfolio companies` : null,
    investor.assetsUsd ? `${formatUsd(investor.assetsUsd)} in fund assets` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description =
    facts.length > DESCRIPTION_MAX ? `${facts.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : facts;

  return {
    title: `${investor.name} — Portfolio & Profile`,
    description,
    alternates: { canonical: `/investors/${slug}` },
  };
}

export default async function InvestorProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const investor = await getInvestor(slug);
  if (!investor) notFound();

  const hasLinks = Boolean(investor.websiteUrl || investor.linkedinUrl);

  return (
    <main className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8">
      <Link
        href="/investors"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← All investors
      </Link>

      <header className="grid grid-cols-[auto_1fr_auto] items-start gap-7 border-b border-ink pt-7 pb-9 max-[860px]:grid-cols-[auto_1fr] max-[600px]:grid-cols-1">
        <CompanyLogo name={investor.name} domain={investor.domain ?? ''} size={72} />
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <h1 className="font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink">
              {investor.name}
            </h1>
            <Badge variant="pill" mono>
              {investor.type}
            </Badge>
          </div>
          {investor.description && (
            <p className="mt-3 max-w-[52ch] text-[17px] text-graphite-700">{investor.description}</p>
          )}
          {hasLinks && (
            <div className="mt-4 flex flex-wrap gap-4">
              {investor.websiteUrl && <OutboundLink href={investor.websiteUrl}>Website</OutboundLink>}
              {investor.linkedinUrl && (
                <OutboundLink href={investor.linkedinUrl}>LinkedIn</OutboundLink>
              )}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[repeat(2,auto)] gap-x-8 gap-y-4 max-[860px]:col-span-full max-[860px]:grid-cols-[repeat(4,auto)] max-[860px]:justify-start max-[600px]:grid-cols-[repeat(2,auto)]">
          {investor.hq && <Fact label="Headquarters" value={investor.hq} />}
          {investor.foundedYear ? <Fact label="Founded" value={String(investor.foundedYear)} /> : null}
          {investor.fundCount ? <Fact label="Funds" value={formatCount(investor.fundCount)} /> : null}
          {investor.assetsUsd ? <Fact label="Fund assets" value={formatUsd(investor.assetsUsd)} /> : null}
          {investor.legalName && <Fact label="Legal name" value={investor.legalName} />}
        </dl>
      </header>

      <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
        <Metric label="Portfolio companies" value={formatCount(investor.portfolioCount)} />
        <Metric label="Sectors" value={investor.sectors.length ? String(investor.sectors.length) : '—'} />
        {investor.fundCount ? <Metric label="Private funds" value={formatCount(investor.fundCount)} /> : null}
      </section>

      <section className="border-t border-line py-8">
        <SectionHeader
          title="Funds"
          note={
            investor.fundCount
              ? `${formatCount(investor.namedFundCount)} named of ${formatCount(investor.fundCount)} reported`
              : investor.namedFundCount > 0
                ? `${formatCount(investor.namedFundCount)} named`
                : undefined
          }
          size="md"
          className="mb-5 border-b-0 pb-0"
        />
        {investor.funds.length > 0 ? (
          <>
            <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
              {investor.funds.map((fund) => (
                <li
                  key={fund.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-5 border-b border-line px-4 py-3.5 last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:gap-y-1.5"
                >
                  <span className="min-w-0 font-display text-[15px] font-semibold tracking-tight text-ink">
                    {fund.name}
                    <Citation citations={investor.citations} entityId={fund.id} />
                  </span>
                  {fund.strategy ? (
                    <Badge variant="pill" mono>
                      {fund.strategy}
                    </Badge>
                  ) : (
                    <span className="font-mono text-[13px] text-graphite-500">—</span>
                  )}
                  <span className="text-right font-mono text-sm text-ink max-[720px]:text-left">
                    {fund.vintageYear ?? '—'}
                  </span>
                  {/* Never $0: a fund that reported no value shows "Undisclosed". */}
                  <span className="text-right font-mono text-[15px] font-medium text-ink max-[720px]:text-left">
                    {formatUsd(fund.grossAssetsUsd ?? fund.closedUsd ?? null)}
                  </span>
                </li>
              ))}
            </ul>
            {/* The API returns a preview, so a shortfall IS the "more" signal —
                no need to duplicate its page size here. */}
            {investor.namedFundCount > investor.funds.length && (
              <Link
                href={`/funds?manager=${investor.slug}`}
                className="mt-4 inline-block font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
              >
                All {formatCount(investor.namedFundCount)} funds →
              </Link>
            )}
          </>
        ) : (
          // The firm told the SEC how many funds it runs; the public archive
          // just has not named them yet (it stops at 2024-12-31).
          <EmptyState>
            <p>
              {investor.fundCount
                ? `${investor.name} reports ${formatCount(investor.fundCount)} private ${investor.fundCount === 1 ? 'fund' : 'funds'} to the SEC that the public filing archive does not yet name.`
                : `No private funds recorded for ${investor.name} yet.`}
            </p>
          </EmptyState>
        )}
      </section>

      <section className="border-t border-line py-8">
        <SectionHeader
          title="Portfolio"
          note={
            investor.portfolioCount > 0
              ? `${formatCount(investor.portfolioCount)} known ${investor.portfolioCount === 1 ? 'company' : 'companies'}`
              : undefined
          }
          size="md"
          className="mb-5 border-b-0 pb-0"
        />
        {investor.portfolioCount > 0 ? (
          <>
            {investor.sectors.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {investor.sectors.map((sector) => (
                  <Badge key={sector} variant="box">
                    {sector}
                  </Badge>
                ))}
              </div>
            )}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line">
              {investor.companies.map((company) => (
                <li key={company.slug} className="bg-surface">
                  <Link
                    href={`/companies/${company.slug}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-paper"
                  >
                    <CompanyLogo name={company.name} domain={company.domain} size={32} />
                    <span className="truncate font-display text-[15px] font-semibold tracking-tight text-ink">
                      {company.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          // The common case for the SEC Form ADV universe: the filing names the
          // firm but discloses nothing about what it backs. No free source does.
          <EmptyState>
            <p>
              No investments recorded for {investor.name} yet. US regulatory filings name the firm
              but never its portfolio companies — that data is contributed.
            </p>
            <Button variant="outline" shape="pill" size="sm" href="/companies" className="mt-4">
              Add an investment
            </Button>
          </EmptyState>
        )}
      </section>
    </main>
  );
}

function OutboundLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs tracking-[0.02em] text-graphite-700 underline underline-offset-[3px] transition-colors hover:text-ink"
    >
      {children}
    </a>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] tracking-[0.04em] text-graphite-500 uppercase">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        {label}
      </span>
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">{value}</span>
    </div>
  );
}
