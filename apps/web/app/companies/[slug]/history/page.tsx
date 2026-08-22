import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Revision } from '@repo/api';

import { Button, EmptyState, Pagination, SectionHeader } from '@/components/ui';
import { getCompanyDetail, getCompanyHistory } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';

// Fields whose values are money or counts, so the timeline formats them the way
// the profile does rather than dumping a raw integer.
const MONEY_FIELDS = new Set(['totalRaisedUsd', 'lastValuationUsd', 'amountUsd', 'postMoneyUsd']);
const COUNT_FIELDS = new Set(['headcount', 'rounds']);

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  domain: 'Domain',
  oneLiner: 'One-liner',
  description: 'Description',
  hq: 'Headquarters',
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCompanyDetail(slug);
  if (!result) return {};
  return {
    title: `${result.company.name} — Change history`,
    description: `Every recorded change to ${result.company.name}'s Capbase profile: what changed, who changed it, and when.`,
    alternates: { canonical: `/companies/${slug}/history` },
  };
}

export default async function CompanyHistory({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);

  const [detail, history] = await Promise.all([
    getCompanyDetail(slug),
    getCompanyHistory(slug, page),
  ]);

  if (!detail || !history) {
    notFound();
  }

  const { company } = detail;

  return (
    <main className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8 pb-16">
      <Link
        href={`/companies/${company.slug}`}
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← {company.name}
      </Link>

      <header className="border-b border-ink pt-6 pb-7">
        <h1 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Change history
        </h1>
        <p className="mt-3 max-w-[60ch] text-[15px] text-graphite-700">
          Every recorded change to {company.name}&apos;s profile — from moderated contributions and
          from automated ingestion. Public and complete, so anyone can audit where a figure came
          from.
        </p>
      </header>

      <section className="pt-8">
        <SectionHeader
          title="Timeline"
          note={history.total > 0 ? `${formatCount(history.total)} entries` : undefined}
          size="md"
          className="mb-5"
        />

        {history.items.length === 0 ? (
          <EmptyState
            action={
              <Button
                variant="outline"
                shape="pill"
                size="sm"
                href={`/companies/${company.slug}/contribute?type=edit`}
              >
                Propose a change
              </Button>
            }
          >
            Nothing recorded yet. Capbase started keeping a public change log recently, so changes
            made before then are not listed here — this is not a claim that {company.name} has never
            been edited.
          </EmptyState>
        ) : (
          <ol className="flex flex-col">
            {history.items.map((item) => (
              <Entry key={item.id} item={item} />
            ))}
          </ol>
        )}

        <Pagination
          page={history.page}
          pageSize={history.pageSize}
          total={history.total}
          href={(p) => `/companies/${company.slug}/history?page=${p}`}
          className="mt-8"
        />
      </section>
    </main>
  );
}

/** One hairline-ruled ledger row: when, what, and from what to what. */
function Entry({ item }: { item: Revision }) {
  return (
    <li className="grid grid-cols-[170px_1fr] items-baseline gap-x-6 border-t border-line py-4 max-md:grid-cols-1 max-md:gap-y-2">
      <span className="font-mono text-[11px] tracking-[0.04em] text-graphite-500 uppercase">
        <time dateTime={item.createdAt}>{stamp(item.createdAt)}</time>
        <span className="mt-0.5 block text-graphite-700">{actorLabel(item)}</span>
      </span>

      <div className="min-w-0">
        <p className="text-[15px] text-ink">
          <span className="font-display font-semibold">{item.entityLabel}</span>
          {item.action === 'CREATE' ? (
            <span className="text-graphite-700"> added</span>
          ) : (
            <span className="text-graphite-700">
              {' '}
              — {FIELD_LABELS[item.field] ?? item.field} changed
            </span>
          )}
        </p>

        {item.action === 'UPDATE' ? (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[13px]">
            <span className="text-graphite-500 line-through decoration-graphite-400">
              {display(item.field, item.before)}
            </span>
            <span aria-hidden="true" className="text-graphite-400">
              →
            </span>
            <span className="text-ink">{display(item.field, item.after)}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function actorLabel(item: Revision): string {
  if (item.actor === 'INGEST') return `Ingest · ${item.actorName ?? 'automated'}`;
  return item.actorName ?? (item.actor === 'ADMIN' ? 'Moderator' : 'Contributor');
}

/** Date + time: several revisions can land in one day, so the day alone would
    not order them for a reader. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Render one side of a diff. A stored null is a real value ("cleared"), so it
    prints as an em dash rather than being skipped. */
function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && MONEY_FIELDS.has(field)) return formatUsd(value);
  if (typeof value === 'number' && COUNT_FIELDS.has(field)) return formatCount(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return truncate(JSON.stringify(value));
  return truncate(String(value));
}

const MAX_VALUE_CHARS = 140;

function truncate(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}
