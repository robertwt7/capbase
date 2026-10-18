import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Citation } from '@/components/Citation';
import { CommitmentAmount } from '@/components/CommitmentAmount';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Identifiers } from '@/components/Identifiers';
import { JsonLd } from '@/components/JsonLd';
import { LockedSection } from '@/components/LockedSection';
import { isMasked, Masked, SignInChip } from '@/components/Masked';
import { StubProfile } from '@/components/StubProfile';
import { Badge, Button, EmptyState, SectionHeader } from '@/components/ui';
import { getInvestor } from '@/lib/data';
import { countryName, formatCount, formatUsd } from '@/lib/format';
import { canonical } from '@/lib/metadata';
import { investorBreadcrumbJsonLd, investorJsonLd } from '@/lib/schema';

const DESCRIPTION_MAX = 160;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const investor = await getInvestor(slug);
  // notFound() here too, not only in the page: under loading.tsx the response
  // is already a streamed 200, and metadata is the blocking <head> for
  // HTML-limited bots (Bingbot, link previewers) — this puts the noindex and
  // not-found title there rather than later in the body.
  if (!investor) notFound();
  // A partner-only firm is a stub for a signed-out viewer: never indexed.
  if (investor.partnerOnly) return { title: investor.name, robots: { index: false, follow: true } };

  // Withheld facts are blank in the payload, and skipped here explicitly too.
  const shown = (field: string) => !isMasked(investor, field);
  const facts = [
    shown('type') && `${investor.type} investor`,
    shown('hq') && investor.hq,
    investor.portfolioCount > 0 ? `${formatCount(investor.portfolioCount)} portfolio companies` : null,
    shown('assetsUsd') && investor.assetsUsd ? `${formatUsd(investor.assetsUsd)} in fund assets` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description =
    facts.length > DESCRIPTION_MAX ? `${facts.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : facts;

  return {
    title: `${investor.name} — Portfolio & Profile`,
    description,
    ...canonical(`/investors/${slug}`),
    // Thin profiles stay public and crawlable but out of the index; the API
    // decides (the same rule drops them from the sitemap).
    ...(!investor.indexable && { robots: { index: false, follow: true } }),
  };
}

export default async function InvestorProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const investor = await getInvestor(slug);
  if (!investor) notFound();
  const path = `/investors/${investor.slug}`;
  if (investor.partnerOnly) {
    return (
      <StubProfile
        kind="Investor"
        name={investor.name}
        domain={investor.domain}
        next={path}
        back={{ href: '/investors', label: 'All investors' }}
        counts={[
          { label: 'Portfolio companies', value: investor.portfolioCount },
          { label: 'Funds named', value: investor.namedFundCount },
          { label: 'Fund commitments', value: investor.commitmentCount },
          { label: 'People', value: investor.peopleCount },
        ].filter((c) => c.value > 0)}
      />
    );
  }
  const country = countryName(investor.countryCode);
  const { access } = investor;
  const masked = (field: string) => isMasked(investor, field);
  /** A fact, or the sign-in chip when the API withheld it from this viewer. */
  const m = (field: string, node: React.ReactNode) => (
    <Masked entity={investor} field={field} next={path}>
      {node}
    </Masked>
  );

  const hasLinks = Boolean(
    investor.websiteUrl || investor.linkedinUrl || masked('websiteUrl') || masked('linkedinUrl'),
  );
  // A limited partner (a pension, an endowment) usually manages no funds of its
  // own; its funds block would only say so. Its commitments say what it does.
  const showFunds = investor.namedFundCount > 0 || !!investor.fundCount || investor.commitmentCount === 0;

  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8">
      <JsonLd data={investorJsonLd(investor)} />
      <JsonLd data={investorBreadcrumbJsonLd(investor)} />
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
            {!masked('type') && (
              <Badge variant="pill" mono>
                {investor.type}
              </Badge>
            )}
          </div>
          {(investor.description || masked('description')) && (
            <p className="mt-3 max-w-[52ch] text-[17px] text-graphite-700">
              {m('description', investor.description)}
            </p>
          )}
          {hasLinks && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {investor.websiteUrl && <OutboundLink href={investor.websiteUrl}>Website</OutboundLink>}
              {investor.linkedinUrl && (
                <OutboundLink href={investor.linkedinUrl}>LinkedIn</OutboundLink>
              )}
              {(masked('websiteUrl') || masked('linkedinUrl')) && (
                <span className="flex items-center gap-2 font-mono text-xs text-graphite-500">
                  Links <SignInChip next={path} />
                </span>
              )}
            </div>
          )}
          {/* CRD, CIK, LEI, QID — the firm's identity in the public registries.
              Renders nothing when we hold none. */}
          <Identifiers identifiers={investor.identifiers} className="mt-5" />
        </div>
        <dl className="grid grid-cols-[repeat(2,auto)] gap-x-8 gap-y-4 max-[860px]:col-span-full max-[860px]:grid-cols-[repeat(4,auto)] max-[860px]:justify-start max-[600px]:grid-cols-[repeat(2,auto)]">
          {(investor.hq || masked('hq')) && <Fact label="Headquarters" value={m('hq', investor.hq)} />}
          {(country || masked('countryCode')) && <Fact label="Country" value={m('countryCode', country)} />}
          {investor.foundedYear || masked('foundedYear') ? (
            <Fact label="Founded" value={m('foundedYear', String(investor.foundedYear))} />
          ) : null}
          {investor.fundCount ? <Fact label="Funds" value={formatCount(investor.fundCount)} /> : null}
          {investor.assetsUsd || masked('assetsUsd') ? (
            <Fact label="Fund assets" value={m('assetsUsd', formatUsd(investor.assetsUsd ?? null))} />
          ) : null}
          {(investor.legalName || masked('legalName')) && (
            <Fact label="Legal name" value={m('legalName', investor.legalName)} />
          )}
        </dl>
      </header>

      <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
        <Metric label="Portfolio companies" value={formatCount(investor.portfolioCount)} />
        <Metric label="Sectors" value={investor.sectors.length ? String(investor.sectors.length) : '—'} />
        {investor.fundCount ? <Metric label="Private funds" value={formatCount(investor.fundCount)} /> : null}
      </section>

      {showFunds && (
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
                  className="grid grid-cols-[minmax(0,1fr)_10rem_3.5rem_7rem] items-center gap-x-6 border-b border-line px-4 py-3.5 last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:gap-y-1.5"
                >
                  <span className="min-w-0 font-display text-[15px] font-semibold tracking-tight text-ink">
                    {fund.slug ? (
                      <Link
                        href={`/funds/${fund.slug}`}
                        prefetch={false}
                        className="underline-offset-[3px] transition-colors hover:text-graphite-700 hover:underline"
                      >
                        {fund.name}
                      </Link>
                    ) : (
                      fund.name
                    )}
                    <Citation citations={investor.citations} entityId={fund.id} />
                  </span>
                  {isMasked(fund, 'strategy') ? (
                    <span className="justify-self-start">
                      <SignInChip next={path} />
                    </span>
                  ) : fund.strategy ? (
                    <Badge variant="pill" mono className="justify-self-start">
                      {fund.strategy}
                    </Badge>
                  ) : (
                    <span className="font-mono text-[13px] text-graphite-500">—</span>
                  )}
                  <span className="text-right font-mono text-sm text-ink max-[720px]:text-left">
                    <Masked entity={fund} field="vintageYear" next={path}>
                      {fund.vintageYear ?? '—'}
                    </Masked>
                  </span>
                  {/* Never $0: a fund that reported no value shows "Undisclosed". */}
                  <span className="text-right font-mono text-[15px] font-medium text-ink max-[720px]:text-left">
                    {/* The size shown is gross assets, else capital closed —
                        withheld when that figure is the partner's. */}
                    {fund.grossAssetsUsd == null && isMasked(fund, 'closedUsd') ? (
                      <SignInChip next={path} />
                    ) : (
                      formatUsd(fund.grossAssetsUsd ?? fund.closedUsd ?? null)
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {/* The API returns a preview, so a shortfall IS the "more" signal —
                no need to duplicate its page size here. A gated preview says
                so below instead. */}
            {access.unlocked && investor.namedFundCount > investor.funds.length && (
              <Link
                href={`/funds?manager=${investor.slug}`}
                className="mt-4 inline-block font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
              >
                All {formatCount(investor.namedFundCount)} funds →
              </Link>
            )}
          </>
        ) : investor.namedFundCount > 0 ? null : (
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
        <LockedSection
          access={access}
          next={path}
          total={investor.namedFundCount}
          shown={investor.funds.length}
          noun="funds"
          placeholder="row"
        />
      </section>
      )}

      {investor.commitmentCount > 0 && (
        <section className="border-t border-line py-8">
          <SectionHeader
            title="Fund commitments"
            note={
              investor.commitmentCount > investor.commitments.length
                ? `${formatCount(investor.commitments.length)} largest of ${formatCount(investor.commitmentCount)}`
                : `${formatCount(investor.commitmentCount)} as a limited partner`
            }
            size="md"
            className="mb-5 border-b-0 pb-0"
          />
          <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {investor.commitments.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_3.5rem_8rem] items-center gap-x-6 border-b border-line px-4 py-3.5 last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:gap-y-1.5"
              >
                <span className="min-w-0 font-display text-[15px] font-semibold tracking-tight text-ink">
                  {c.fund.slug ? (
                    <Link
                      href={`/funds/${c.fund.slug}`}
                      prefetch={false}
                      className="underline-offset-[3px] transition-colors hover:text-graphite-700 hover:underline"
                    >
                      {c.fund.name}
                    </Link>
                  ) : (
                    c.fund.name
                  )}
                </span>
                <Link
                  href={`/investors/${c.manager.slug}`}
                  prefetch={false}
                  className="max-w-full justify-self-start truncate text-[13px] text-graphite-700 underline-offset-[3px] transition-colors hover:text-ink hover:underline"
                  title={c.manager.name}
                >
                  {c.manager.name}
                </Link>
                <span className="text-right font-mono text-sm text-ink max-[720px]:text-left">
                  {c.fund.vintageYear ?? '—'}
                </span>
                <CommitmentAmount amountUsd={c.amountUsd} amountLocal={c.amountLocal} currency={c.currency} />
              </li>
            ))}
          </ul>
          <LockedSection
            access={access}
            next={path}
            total={investor.commitmentCount}
            shown={investor.commitments.length}
            noun="commitments"
            placeholder="row"
          />
        </section>
      )}

      <section className="border-t border-line py-8">
        <SectionHeader
          title="People"
          note={
            investor.peopleCount > investor.people.length
              ? `${formatCount(investor.people.length)} of ${formatCount(investor.peopleCount)} named`
              : investor.people.length > 0
                ? `${formatCount(investor.people.length)} named`
                : undefined
          }
          size="md"
          className="mb-5 border-b-0 pb-0"
        />
        {investor.people.length > 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line">
            {investor.people.map((person) => (
              <li key={person.id} className="flex flex-col gap-1 bg-surface px-4 py-3.5">
                {person.personSlug ? (
                  <Link
                    href={`/people/${person.personSlug}`}
                    prefetch={false}
                    className="font-display text-[15px] font-semibold tracking-tight text-ink transition-colors hover:text-graphite-700"
                  >
                    {person.name}
                  </Link>
                ) : (
                  <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
                    {person.name}
                  </span>
                )}
                <span className="font-mono text-xs tracking-[0.02em] text-graphite-500">
                  {person.title || person.role}
                </span>
              </li>
            ))}
          </ul>
        ) : investor.peopleCount > 0 ? null : (
          // Only Wikidata names a firm's officers, and it covers a few hundred
          // firms — so an empty block is the norm, not a failure.
          <EmptyState>
            <p>
              No people recorded for {investor.name} yet. US regulatory filings name the firm but
              rarely its partners.
            </p>
          </EmptyState>
        )}
        <LockedSection
          access={access}
          next={path}
          total={investor.peopleCount}
          shown={investor.people.length}
          noun="people"
          placeholder="card"
        />
      </section>

      <section className="border-t border-line py-8">
        <SectionHeader
          title="Portfolio"
          note={
            investor.portfolioCount > investor.companies.length
              ? `${formatCount(investor.companies.length)} largest of ${formatCount(investor.portfolioCount)} known companies`
              : investor.portfolioCount > 0
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
                    prefetch={false}
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
            <LockedSection
              access={access}
              next={path}
              total={investor.portfolioCount}
              shown={investor.companies.length}
              noun="portfolio companies"
              placeholder="card"
            />
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

      <footer className="mt-6 border-t border-line pt-7 pb-16 font-mono text-xs text-graphite-500">
        Something wrong here?{' '}
        <Link href={`/report/investor/${investor.slug}`} className="underline underline-offset-[3px] transition-colors hover:text-ink">
          Report an issue
        </Link>
        .
      </footer>
    </div>
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
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
