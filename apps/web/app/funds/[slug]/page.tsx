import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Citation } from '@/components/Citation';
import { CommitmentAmount } from '@/components/CommitmentAmount';
import { LockedSection } from '@/components/LockedSection';
import { isMasked, Masked, SignInChip } from '@/components/Masked';
import { StubProfile } from '@/components/StubProfile';
import { Badge, EmptyState, SectionHeader } from '@/components/ui';
import { getFund } from '@/lib/data';
import { formatCount, formatDate, formatPct, formatPctRange, formatUsd } from '@/lib/format';
import { canonical } from '@/lib/metadata';

const DESCRIPTION_MAX = 160;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getFund(slug);
  // notFound() here too, as on the investor profile: under loading.tsx the
  // response is a streamed 200, and this is the blocking <head> for bots.
  if (!detail) notFound();
  const { fund } = detail;
  // A partner-only fund is a stub for a signed-out viewer: never indexed.
  if (fund.partnerOnly) return { title: fund.name, robots: { index: false, follow: true } };

  // Withheld facts are blank in the payload, and skipped here explicitly too.
  const shown = (field: string) => !isMasked(fund, field);
  const facts = [
    shown('strategy') && fund.strategy ? `${fund.strategy} fund` : 'Private fund',
    `managed by ${fund.manager.name}`,
    shown('vintageYear') && fund.vintageYear ? `vintage ${fund.vintageYear}` : null,
    shown('closedUsd') && fund.closedUsd ? `${formatUsd(fund.closedUsd)} closed` : null,
    detail.commitmentCount > 0 ? `${formatCount(detail.commitmentCount)} LP commitments` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description =
    facts.length > DESCRIPTION_MAX ? `${facts.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : facts;

  return {
    title: `${fund.name} — Fund Profile`,
    description,
    ...canonical(`/funds/${slug}`),
    // A name-and-NAV fund stays public and crawlable but out of the index; the
    // API decides (`fundIndexable`, the same rule as the sitemap).
    ...(!detail.indexable && { robots: { index: false, follow: true } }),
  };
}

export default async function FundProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getFund(slug);
  if (!detail) notFound();
  const { fund, commitments, commitmentCount, metrics, metricCount, citations, access, termsHidden } = detail;
  const path = `/funds/${slug}`;
  if (fund.partnerOnly) {
    return (
      <StubProfile
        kind="Fund"
        name={fund.name}
        next={path}
        back={{ href: '/funds', label: 'All funds' }}
        counts={[
          { label: 'LP commitments', value: commitmentCount },
          { label: 'Metrics', value: metricCount },
        ].filter((c) => c.value > 0)}
      />
    );
  }
  const masked = (field: string) => isMasked(fund, field);
  /** A fact, or the sign-in chip when the API withheld it from this viewer. */
  const m = (field: string, node: React.ReactNode) => (
    <Masked entity={fund} field={field} next={path}>
      {node}
    </Masked>
  );

  const hasTerms = [
    fund.managementFeePct,
    fund.carriedInterestPct,
    fund.hurdleRatePct,
    fund.targetIrrNetMinPct,
    fund.targetIrrNetMaxPct,
    fund.targetIrrGrossMinPct,
    fund.targetIrrGrossMaxPct,
  ].some((v) => v != null);

  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8">
      <Link
        href="/funds"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← All funds
      </Link>

      <header className="grid grid-cols-[1fr_auto] items-start gap-7 border-b border-ink pt-7 pb-9 max-[860px]:grid-cols-1">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink">
            {fund.name}
            <Citation citations={citations} entityId={fund.id} />
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {fund.strategy && (
              <Badge variant="pill" mono>
                {fund.strategy}
              </Badge>
            )}
            {fund.status && (
              <Badge variant="box" mono>
                {fund.status}
              </Badge>
            )}
            {(masked('strategy') || masked('status')) && <SignInChip next={path} />}
          </div>
          <p className="mt-4 text-[15px] text-graphite-700">
            Managed by{' '}
            <Link
              href={`/investors/${fund.manager.slug}`}
              prefetch={false}
              className="font-medium text-ink underline underline-offset-[3px] transition-colors hover:text-graphite-700"
            >
              {fund.manager.name}
            </Link>
          </p>
        </div>
        <dl className="grid grid-cols-[repeat(3,auto)] gap-x-8 gap-y-4 max-[860px]:justify-start max-[600px]:grid-cols-[repeat(2,auto)]">
          {fund.vintageYear || masked('vintageYear') ? (
            <Fact label="Vintage" value={m('vintageYear', String(fund.vintageYear))} />
          ) : null}
          {(fund.regionFocus || masked('regionFocus')) && (
            <Fact label="Region focus" value={m('regionFocus', fund.regionFocus)} />
          )}
          {(fund.hq || masked('hq')) && <Fact label="Location" value={m('hq', fund.hq)} />}
          {fund.launchDate && <Fact label="Launched" value={formatDate(fund.launchDate)} />}
          {fund.latestCloseDate && fund.latestCloseDate !== fund.finalCloseDate && (
            <Fact label="Latest close" value={formatDate(fund.latestCloseDate)} />
          )}
          {fund.finalCloseDate && <Fact label="Final close" value={formatDate(fund.finalCloseDate)} />}
        </dl>
      </header>

      {/* "Undisclosed", never $0, for a figure no source reported. */}
      <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
        <Metric label="Fund size" value={m('closedUsd', formatUsd(fund.closedUsd ?? null))} />
        <Metric label="Target" value={m('targetUsd', formatUsd(fund.targetUsd ?? null))} />
        {fund.hardCapUsd ? <Metric label="Hard cap" value={formatUsd(fund.hardCapUsd)} /> : null}
        {/* Form ADV's figure is NAV at filing time, not capital raised. */}
        {fund.grossAssetsUsd || masked('grossAssetsUsd') ? (
          <Metric label="Gross assets" value={m('grossAssetsUsd', formatUsd(fund.grossAssetsUsd ?? null))} />
        ) : null}
        <Metric label="LP commitments" value={formatCount(commitmentCount)} />
      </section>

      {/* A fund with no terms shows no block at all — never a false lock. */}
      {termsHidden && (
        <section className="py-8">
          <SectionHeader title="Terms" size="md" className="mb-5 border-b-0 pb-0" />
          <LockedSection
            access={access}
            next={path}
            total={1}
            shown={0}
            noun="terms"
            subject="The fund's terms and close dates"
            placeholder="terms"
            className="mt-0"
          />
        </section>
      )}
      {hasTerms && (
        <section className="py-8">
          <SectionHeader title="Terms" size="md" className="mb-5 border-b-0 pb-0" />
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-px overflow-hidden rounded-[10px] border border-line bg-line">
            <Term label="Management fee" value={formatPct(fund.managementFeePct)} />
            <Term label="Carried interest" value={formatPct(fund.carriedInterestPct)} />
            <Term label="Hurdle rate" value={formatPct(fund.hurdleRatePct)} />
            <Term
              label="Target net IRR"
              value={formatPctRange(fund.targetIrrNetMinPct, fund.targetIrrNetMaxPct)}
            />
            <Term
              label="Target gross IRR"
              value={formatPctRange(fund.targetIrrGrossMinPct, fund.targetIrrGrossMaxPct)}
            />
          </dl>
        </section>
      )}

      {metricCount > 0 && (
        <section className="border-t border-line py-8">
          <SectionHeader title="Metrics" size="md" className="mb-5 border-b-0 pb-0" />
          {metrics.length > 0 && (
          <div
            className="overflow-hidden rounded-[10px] border border-line bg-surface"
            role="table"
            aria-label="Fund metrics"
          >
            <div
              className="grid grid-cols-[7rem_repeat(3,minmax(0,1fr))] gap-x-6 bg-paper px-4 py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase"
              role="row"
            >
              <span role="columnheader">As at</span>
              <span role="columnheader" className="text-right">
                AUM
              </span>
              <span role="columnheader" className="text-right">
                Dry powder
              </span>
              <span role="columnheader" className="text-right">
                Unrealised
              </span>
            </div>
            {metrics.map((m) => (
              <div
                key={m.asAt}
                className="grid grid-cols-[7rem_repeat(3,minmax(0,1fr))] gap-x-6 border-t border-line px-4 py-3 font-mono text-sm text-ink"
                role="row"
              >
                <span role="cell">{formatDate(m.asAt)}</span>
                <span role="cell" className="text-right">
                  {m.aumUsd == null ? '—' : formatUsd(m.aumUsd)}
                </span>
                <span role="cell" className="text-right">
                  {m.dryPowderUsd == null ? '—' : formatUsd(m.dryPowderUsd)}
                </span>
                <span role="cell" className="text-right">
                  {m.unrealizedUsd == null ? '—' : formatUsd(m.unrealizedUsd)}
                </span>
              </div>
            ))}
          </div>
          )}
          <LockedSection
            access={access}
            next={path}
            total={metricCount}
            shown={metrics.length}
            noun="metrics"
            placeholder="row"
          />
        </section>
      )}

      <section className="border-t border-line py-8">
        <SectionHeader
          title="LP commitments"
          note={
            commitmentCount > commitments.length
              ? `${formatCount(commitments.length)} largest of ${formatCount(commitmentCount)}`
              : commitmentCount > 0
                ? `${formatCount(commitmentCount)} limited ${commitmentCount === 1 ? 'partner' : 'partners'}`
                : undefined
          }
          size="md"
          className="mb-5 border-b-0 pb-0"
        />
        {commitments.length > 0 ? (
          <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {commitments.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_10rem_8rem] items-center gap-x-6 border-b border-line px-4 py-3.5 last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:gap-y-1.5"
              >
                <Link
                  href={`/investors/${c.investor.slug}`}
                  prefetch={false}
                  className="min-w-0 truncate font-display text-[15px] font-semibold tracking-tight text-ink transition-colors hover:text-graphite-700"
                >
                  {c.investor.name}
                </Link>
                <Badge variant="pill" mono className="justify-self-start">
                  {c.investor.type}
                </Badge>
                <CommitmentAmount amountUsd={c.amountUsd} amountLocal={c.amountLocal} currency={c.currency} />
              </li>
            ))}
          </ul>
        ) : commitmentCount > 0 ? null : (
          <EmptyState>
            <p>
              No limited partners recorded for {fund.name} yet. Public pension plans publish their
              commitments; most other investors never disclose them.
            </p>
          </EmptyState>
        )}
        <LockedSection
          access={access}
          next={path}
          total={commitmentCount}
          shown={commitments.length}
          noun="LP commitments"
          placeholder="row"
        />
      </section>

      <div className="pb-16" />
    </div>
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

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        {label}
      </span>
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">{value}</span>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-surface px-4 py-3.5">
      <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">{label}</dt>
      <dd className={`font-mono text-lg ${value === '—' ? 'text-muted-foreground' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
