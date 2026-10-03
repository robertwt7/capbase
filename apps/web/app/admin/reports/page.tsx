import Link from 'next/link';
import {
  REPORT_STATUSES,
  type ReportableType,
  type ReportItem,
  type ReportStatus,
} from '@repo/api';

import { Badge, Button, Card, Input, Textarea } from '../../../components/ui';
import { getReports } from '../../../lib/admin';
import { requireAdmin } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
import {
  dismissAction,
  resolveAction,
  suppressAndResolveAction,
} from './actions';

/** Where each entity type's public profile lives. */
const PROFILE_PATH: Record<ReportableType, string> = {
  company: 'companies',
  investor: 'investors',
  person: 'people',
};

export const dynamic = 'force-dynamic';

export default async function ReportQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const { status } = await searchParams;
  const active: ReportStatus = REPORT_STATUSES.includes(status as ReportStatus)
    ? (status as ReportStatus)
    : 'OPEN';

  const queue = await getReports(active);

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Reports
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          &ldquo;Report an issue&rdquo; submissions from profile pages.
          Resolving or dismissing is bookkeeping: it records your note and
          changes nothing on the site. The one exception is Suppress &amp;
          resolve on a person report, which hides that person&rsquo;s profile.
          Corrections still go through a proposed edit and the moderation queue.
        </p>
      </header>

      <nav
        className="flex flex-wrap items-center gap-2 pt-6"
        aria-label="Filter by status"
      >
        {REPORT_STATUSES.map((s) => (
          <FilterLink
            key={s}
            href={`/admin/reports?status=${s}`}
            active={s === active}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {s === active ? ` (${queue.total})` : ''}
          </FilterLink>
        ))}
      </nav>

      {queue.items.length === 0 ? (
        <p className="mt-8 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          Nothing {active.toLowerCase()} right now.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {queue.items.map((item) => (
            <li key={item.id}>
              <ReportCard item={item} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        'rounded-full border px-3.5 py-1.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors ' +
        (active
          ? 'border-ink bg-primary text-primary-foreground'
          : 'border-line bg-surface text-graphite-700 hover:border-ink hover:text-ink')
      }
    >
      {children}
    </Link>
  );
}

function ReportCard({ item }: { item: ReportItem }) {
  const canSuppress =
    item.entityType === 'person' && item.entity && !item.entity.suppressed;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
        <Badge variant="box" mono>
          {item.entityType}
        </Badge>
        {item.entity ? (
          <Link
            href={`/${PROFILE_PATH[item.entityType]}/${item.entity.slug}`}
            className="font-display text-[17px] font-semibold text-ink underline-offset-[3px] hover:underline"
          >
            {item.entity.name}
          </Link>
        ) : (
          <span className="font-display text-[17px] font-semibold text-graphite-500">
            — removed
          </span>
        )}
        {item.entity?.suppressed ? (
          <Badge variant="pill" mono>
            suppressed
          </Badge>
        ) : null}
        <Badge variant="pill">{item.reason}</Badge>
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {formatDate(item.createdAt)}
        </span>
      </div>

      <p className="pt-3 text-[14px] whitespace-pre-wrap text-ink">
        {item.message}
      </p>
      <p className="mt-2 font-mono text-[12px] text-graphite-500">
        {item.email ? (
          <a
            href={`mailto:${item.email}`}
            className="underline underline-offset-[3px] transition-colors hover:text-ink"
          >
            {item.email}
          </a>
        ) : (
          'No contact email'
        )}
      </p>

      {item.status === 'OPEN' ? (
        // One form, several buttons: the clicked button's formAction decides
        // what the note and link are submitted to.
        <form className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          <Textarea
            name="note"
            rows={2}
            placeholder="Note (optional) — what you checked or did"
          />
          <Input
            name="url"
            type="url"
            placeholder="Link to the fix (optional)"
          />
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              shape="box"
              size="sm"
              type="submit"
              formAction={resolveAction.bind(null, item.id)}
            >
              Resolve
            </Button>
            <Button
              variant="outline"
              shape="box"
              size="sm"
              type="submit"
              formAction={dismissAction.bind(null, item.id)}
            >
              Dismiss
            </Button>
            {canSuppress && item.entity ? (
              // Destructive, so emphasis is weight and border — never red.
              <Button
                variant="outline"
                shape="box"
                size="sm"
                type="submit"
                className="ml-auto border-ink font-semibold"
                formAction={suppressAndResolveAction.bind(
                  null,
                  item.id,
                  item.entity.slug,
                )}
              >
                Suppress &amp; resolve
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-4">
          <Fact label="Status" value={item.status} />
          <Fact
            label="By"
            value={
              [
                item.resolvedBy,
                item.resolvedAt ? formatDate(item.resolvedAt) : null,
              ]
                .filter(Boolean)
                .join(' · ') || null
            }
          />
          <Fact label="Note" value={item.resolutionNote} />
          <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
            Link
          </dt>
          <dd className="font-mono text-[12px] break-all text-graphite-700">
            {item.resolutionUrl ? (
              <a
                href={item.resolutionUrl}
                className="underline underline-offset-[3px] transition-colors hover:text-ink"
              >
                {item.resolutionUrl}
              </a>
            ) : (
              '—'
            )}
          </dd>
        </dl>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        {label}
      </dt>
      <dd className="text-[13px] whitespace-pre-wrap text-graphite-700">
        {value || '—'}
      </dd>
    </>
  );
}
