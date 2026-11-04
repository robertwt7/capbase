import type { FundMandate } from '@repo/api';
import type { ReactNode } from 'react';

import { FocusLabels } from '@/components/FocusLabels';
import { SectionHeader } from '@/components/ui';
import { formatDate } from '@/lib/format';

/** A labelled fact in the fund page's header style: an uppercase meta label
 *  over a mono value. Shared with `app/funds/[slug]/page.tsx`. */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] tracking-[0.04em] text-graphite-500 uppercase">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}

/** One row of the mandate grid: rendered only when it has something to say. */
type Row = { label: string; node: ReactNode } | null;

const labels = (label: string, values: string[]): Row =>
  values.length > 0 ? { label, node: <FocusLabels labels={values} /> } : null;

function ReportedOn({ date }: { date: string | null }) {
  if (!date) return null;
  // Noon UTC, so no server timezone can move the day into the previous month.
  return <p className="mt-5 font-mono text-[12px] text-graphite-500">Reported as of {formatDate(`${date}T12:00:00Z`)}</p>;
}

/**
 * What the fund reports it targets (partner data, gated `members` — the page
 * renders a sign-in panel instead when the API withheld it): its detailed
 * strategy, industries, verticals, target geography and reported exposure.
 * Labels as published. Renders nothing when no row has a value.
 */
export function FundMandateSection({
  mandate,
  badge,
}: {
  mandate: FundMandate;
  /** Beside the title (the admin's "Hidden from visitors" tag). */
  badge?: ReactNode;
}) {
  const rows = [
    mandate.detailedStrategy
      ? { label: 'Strategy', node: <span className="font-mono text-sm text-ink">{mandate.detailedStrategy}</span> }
      : null,
    labels('Industries', mandate.industries),
    labels('Verticals', mandate.verticals),
    labels('Geographic focus', mandate.geographicFocus),
    labels('Geographic exposure', mandate.geographicExposure),
  ].filter((r): r is NonNullable<Row> => r !== null);
  if (rows.length === 0) return null;

  return (
    <section className="border-t border-line py-8">
      <SectionHeader
        title={
          <>
            Investment mandate
            {badge}
          </>
        }
        size="md"
        className="mb-5 border-b-0 pb-0"
      />
      <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-6 gap-y-4 max-[600px]:grid-cols-1 max-[600px]:gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-graphite-500 uppercase max-[600px]:pt-3">
              {r.label}
            </dt>
            <dd className="min-w-0">{r.node}</dd>
          </div>
        ))}
      </dl>
      <ReportedOn date={mandate.reportedOn} />
    </section>
  );
}

/**
 * How the fund is set up, as reported: its domicile (a country or a US state —
 * not the header's location), its structure and its legal form. Renders
 * nothing when none is reported.
 */
export function FundStructureSection({
  mandate,
  badge,
}: {
  mandate: FundMandate;
  /** Beside the title (the admin's "Hidden from visitors" tag). */
  badge?: ReactNode;
}) {
  const facts = [
    { label: 'Domicile', value: mandate.domicile },
    { label: 'Structure', value: mandate.structure },
    { label: 'Legal structure', value: mandate.legalStructure },
  ].filter((f): f is { label: string; value: string } => f.value !== null);
  if (facts.length === 0) return null;

  return (
    <section className="border-t border-line py-8">
      <SectionHeader
        title={
          <>
            Fund structure
            {badge}
          </>
        }
        size="md"
        className="mb-5 border-b-0 pb-0"
      />
      <dl className="grid grid-cols-[repeat(3,auto)] justify-start gap-x-8 gap-y-4 max-[600px]:grid-cols-[repeat(2,auto)]">
        {facts.map((f) => (
          <Fact key={f.label} label={f.label} value={f.value} />
        ))}
      </dl>
      <ReportedOn date={mandate.reportedOn} />
    </section>
  );
}
