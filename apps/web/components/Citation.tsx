import type { Citation as CitationRow, SourceType } from '@repo/api';

// A compact, mono publisher tag — the same uppercase meta treatment the rest of
// the ledger uses for labels. No colour: per the design system, emphasis is
// weight and size, and red is reserved for validation feedback.
const SOURCE_LABELS: Record<SourceType, string> = {
  'SEC filing': 'SEC',
  Wikidata: 'WD',
  'Company website': 'WEB',
  Press: 'PR',
  Other: 'SRC',
};

// More than a few markers on one fact stops being provenance and starts being
// clutter; the rest are still reachable from the history page.
const MAX_MARKERS = 3;

/**
 * Citations attesting one fact. An exact field-level citation wins; failing
 * that, a whole-row citation (`field: ''`) attests the row and therefore the
 * fields on it — which is what every backfilled citation is.
 */
export function citationsFor(
  citations: CitationRow[],
  entityId: string,
  field = '',
): CitationRow[] {
  const forEntity = citations.filter((c) => c.entityId === entityId);
  const exact = field ? forEntity.filter((c) => c.field === field) : [];
  return (exact.length > 0 ? exact : forEntity.filter((c) => c.field === '')).slice(
    0,
    MAX_MARKERS,
  );
}

/**
 * The company row's own id, recovered from its citations. The public `Company`
 * type is keyed by slug and carries no row id, but its citations name it — and
 * a company with no citations has nothing to link anyway.
 */
export function companyEntityId(citations: CitationRow[]): string {
  return citations.find((c) => c.entityType === 'company')?.entityId ?? '';
}

const markerClass =
  'font-mono text-[10px] tracking-[0.04em] text-graphite-500 transition-colors ' +
  'hover:text-ink focus-visible:rounded-[2px] focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-ink';

/**
 * The source marker next to a published fact: a small bracketed superscript
 * linking to the primary document.
 *
 * An unsourced fact renders a muted em dash instead of nothing at all — the
 * whole point is that a stranger's guess must not look identical to an SEC
 * filing.
 */
export function Citation({
  citations,
  entityId,
  field,
  className,
}: {
  citations: CitationRow[];
  entityId: string;
  /** Column name for a field-level citation; omit to attest the whole row. */
  field?: string;
  className?: string;
}) {
  const matches = citationsFor(citations, entityId, field);

  if (matches.length === 0) {
    return (
      <span
        className={`ml-1 align-super font-mono text-[10px] text-graphite-400 ${className ?? ''}`}
        title="No source on file for this figure"
      >
        <span className="sr-only">Uncited</span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }

  return (
    <span className={`ml-1 inline-flex align-super gap-0.5 ${className ?? ''}`}>
      {matches.map((c) => (
        <a
          key={c.id}
          href={c.source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={sourceTitle(c)}
          className={markerClass}
        >
          <span className="sr-only">Source: </span>[{SOURCE_LABELS[c.source.sourceType] ?? 'SRC'}]
        </a>
      ))}
    </span>
  );
}

function sourceTitle(c: CitationRow): string {
  return [c.source.publisher, c.source.title ?? c.source.url, c.note]
    .filter(Boolean)
    .join(' · ');
}
