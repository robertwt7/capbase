import Link from 'next/link';
import type {
  IdentifiableType,
  MergeCandidateItem,
  MergeSide,
  MergeSignal,
  MergeStatus,
} from '@repo/api';

import { Badge, Button, Card } from '../../../components/ui';
import { getMergeQueue } from '../../../lib/admin';
import { requireAdmin } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
import { mergeAction, rejectAction, unmergeAction } from './actions';

const STATUSES: MergeStatus[] = ['PENDING', 'MERGED', 'REJECTED'];
const TYPES: IdentifiableType[] = ['company', 'investor'];

/** What each signal means, so a reviewer knows how much to trust the proposal
 *  before opening both rows. */
const SIGNAL_NOTE: Record<MergeSignal, string> = {
  identifier: 'Both rows carry the same external identifier — the publisher says they are one entity.',
  domain: 'Both rows claim the same website. Strong, but an inference.',
  name: 'Both names normalize to the same string. The weakest signal — check before merging.',
};

export const dynamic = 'force-dynamic';

export default async function MergeQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  await requireAdmin();

  const { status, type } = await searchParams;
  const active: MergeStatus = STATUSES.includes(status as MergeStatus)
    ? (status as MergeStatus)
    : 'PENDING';
  const activeType = TYPES.includes(type as IdentifiableType)
    ? (type as IdentifiableType)
    : undefined;

  const queue = await getMergeQueue(active, activeType);
  const typeParam = activeType ? `&type=${activeType}` : '';

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Merge queue
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          Pairs of rows that look like one entity. Merging moves every child row onto the survivor
          and turns the losing address into a permanent redirect; the losing row is kept, not
          deleted, so re-ingesting its source cannot recreate the duplicate. Every merge can be
          reversed.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 pt-6" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <FilterLink key={s} href={`/admin/merges?status=${s}${typeParam}`} active={s === active}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </FilterLink>
        ))}
      </nav>

      <nav className="flex flex-wrap items-center gap-2 pt-3" aria-label="Filter by type">
        <FilterLink href={`/admin/merges?status=${active}`} active={!activeType}>
          All ({queue.total})
        </FilterLink>
        {TYPES.map((t) => (
          <FilterLink
            key={t}
            href={`/admin/merges?status=${active}&type=${t}`}
            active={t === activeType}
          >
            {t}
          </FilterLink>
        ))}
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {(Object.keys(queue.countsBySignal) as MergeSignal[])
            .map((s) => `${s} ${queue.countsBySignal[s]}`)
            .join('  ·  ')}
        </span>
      </nav>

      {queue.items.length === 0 ? (
        <p className="mt-8 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          Nothing {active.toLowerCase()} right now.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {queue.items.map((item) => (
            <li key={item.id}>
              <CandidateCard item={item} />
            </li>
          ))}
        </ol>
      )}
    </main>
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

function CandidateCard({ item }: { item: MergeCandidateItem }) {
  // Fields that differ get marked, so the reviewer's eye lands on the decision
  // rather than on the twenty things that match.
  const differs = (key: keyof MergeSide) => item.left[key] !== item.right[key];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
        <Badge variant="box" mono>
          {item.signal}
        </Badge>
        <span className="font-mono text-[13px] text-ink">{item.evidence}</span>
        <span className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {item.entityType} · {formatDate(item.createdAt)}
        </span>
        {item.status !== 'PENDING' && (
          <Badge variant="pill" mono>
            {item.status}
          </Badge>
        )}
      </div>

      <p className="pt-3 text-[13px] text-graphite-700">{SIGNAL_NOTE[item.signal]}</p>

      {/* Stacks below 820px rather than scrolling the page sideways. */}
      <div className="mt-4 grid grid-cols-2 gap-4 max-[820px]:grid-cols-1">
        <SidePanel side={item.left} entityType={item.entityType} differs={differs} />
        <SidePanel side={item.right} entityType={item.entityType} differs={differs} />
      </div>

      {item.status === 'PENDING' ? (
        <div className="mt-4 flex flex-wrap gap-2.5 border-t border-line pt-4">
          <form action={mergeAction.bind(null, item.id, item.left.id)}>
            <Button variant="outline" shape="box" size="sm" type="submit">
              Keep left · {item.left.name}
            </Button>
          </form>
          <form action={mergeAction.bind(null, item.id, item.right.id)}>
            <Button variant="outline" shape="box" size="sm" type="submit">
              Keep right · {item.right.name}
            </Button>
          </form>
          <form action={rejectAction.bind(null, item.id)} className="ml-auto">
            <Button variant="ghost" shape="box" size="sm" type="submit">
              Not a duplicate
            </Button>
          </form>
        </div>
      ) : item.status === 'MERGED' && item.mergeRecordId ? (
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <form action={unmergeAction.bind(null, item.mergeRecordId)}>
            <Button variant="outline" shape="box" size="sm" type="submit">
              Unmerge
            </Button>
          </form>
          <span className="text-[13px] text-graphite-500">
            Restores both rows and reopens this pair.
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function SidePanel({
  side,
  entityType,
  differs,
}: {
  side: MergeSide;
  entityType: IdentifiableType;
  differs: (key: keyof MergeSide) => boolean;
}) {
  const total = Object.values(side.counts).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <p className="font-display text-[17px] font-semibold text-ink">{side.name}</p>
      <Link
        href={`/${entityType === 'company' ? 'companies' : 'investors'}/${side.slug}`}
        className="font-mono text-[12px] text-graphite-500 underline underline-offset-[3px] transition-colors hover:text-ink"
      >
        /{side.slug}
      </Link>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <Fact label="Domain" value={side.domain} marked={differs('domain')} />
        <Fact label="HQ" value={side.hq} marked={differs('hq')} />
        <Fact
          label="Source"
          value={side.externalSource ? `${side.externalSource}:${side.externalId ?? ''}` : null}
          marked={differs('externalSource')}
        />
        <Fact label="Created" value={formatDate(side.createdAt)} marked={false} />
      </dl>

      <p className="mt-3 font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        Identifiers
      </p>
      <p className="mt-1 font-mono text-[12px] text-ink">
        {side.identifiers.length > 0
          ? side.identifiers.map((i) => `${i.scheme}:${i.value}`).join('  ')
          : '—'}
      </p>

      <p className="mt-3 font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        Child rows ({total})
      </p>
      <p className="mt-1 font-mono text-[12px] text-ink">
        {total > 0
          ? Object.entries(side.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k} ${n}`)
              .join('  ')
          : '—'}
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  marked,
}: {
  label: string;
  value: string | null;
  marked: boolean;
}) {
  return (
    <>
      <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        {label}
      </dt>
      <dd
        className={
          'font-mono text-[12px] break-all ' +
          // Emphasis is weight, not hue: the ledger has no accent colour.
          (marked ? 'font-semibold text-ink' : 'text-graphite-700')
        }
      >
        {value || '—'}
      </dd>
    </>
  );
}
