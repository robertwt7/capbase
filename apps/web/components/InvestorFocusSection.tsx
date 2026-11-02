import type { InvestorFocus, ReportedRange } from '@repo/api';
import type { ReactNode } from 'react';

import { FocusLabels } from '@/components/FocusLabels';
import { SectionHeader } from '@/components/ui';
import { formatDate, formatMoney, formatMoneyRange } from '@/lib/format';

/** One row of the grid: rendered only when it has something to say. */
type Row = { label: string; node: ReactNode } | null;

const labels = (label: string, values: string[]): Row =>
  values.length > 0 ? { label, node: <FocusLabels labels={values} /> } : null;

/** USD figures without the From / Up to wording, for the "≈" aside. */
function bareUsd(r: ReportedRange): string | null {
  if (r.minUsd !== null && r.maxUsd !== null && r.minUsd !== r.maxUsd) {
    return `${formatMoney(r.minUsd)}–${formatMoney(r.maxUsd)}`;
  }
  const one = r.minUsd ?? r.maxUsd;
  return one === null ? null : formatMoney(one);
}

/** In the firm's own currency first, then a muted "≈ $…" — the Funding Ladder
 *  convention for a non-USD amount. */
function range(label: string, r: ReportedRange | null): Row {
  if (!r) return null;
  const local = r.currency !== 'USD' ? formatMoneyRange(r.minLocal, r.maxLocal, r.currency) : null;
  const usd = formatMoneyRange(r.minUsd, r.maxUsd);
  if (!local && !usd) return null;
  return {
    label,
    node: (
      <span className="font-mono text-sm text-ink">
        {local ?? usd}
        {local && bareUsd(r) && <span className="ml-2 text-graphite-500">≈ {bareUsd(r)}</span>}
      </span>
    ),
  };
}

const text = (label: string, value: string | null): Row =>
  value ? { label, node: <span className="font-mono text-sm text-ink">{value}</span> } : null;

function RoleBlock({ heading, rows, reportedOn }: { heading: string | null; rows: Row[]; reportedOn: string }) {
  const shown = rows.filter((r): r is NonNullable<Row> => r !== null);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {heading && (
        <h3 className="font-mono text-[11px] font-medium tracking-[0.08em] text-graphite-500 uppercase">{heading}</h3>
      )}
      <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-6 gap-y-4 max-[600px]:grid-cols-1 max-[600px]:gap-y-1.5">
        {shown.map((r) => (
          <div key={r.label} className="contents">
            <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-graphite-500 uppercase max-[600px]:pt-3">
              {r.label}
            </dt>
            <dd className="min-w-0">{r.node}</dd>
          </div>
        ))}
      </dl>
      {/* Noon UTC, so no server timezone can move the day into the previous month. */}
      <p className="font-mono text-[12px] text-graphite-500">Reported as of {formatDate(`${reportedOn}T12:00:00Z`)}</p>
    </div>
  );
}

/**
 * What the firm reports it invests in (partner data, gated `members` — the
 * page renders a sign-in panel instead when the API withheld it). One block per
 * role: as a fund manager (its own initial equity cheques, where it HAS
 * invested) and as a limited partner (its commitments to funds, where it
 * WANTS to commit). Renders nothing without focus.
 */
export function InvestorFocusSection({ focus }: { focus: InvestorFocus | null }) {
  if (!focus || (!focus.manager && !focus.lp)) return null;
  const both = Boolean(focus.manager && focus.lp);
  const { manager, lp } = focus;

  return (
    <section className="border-t border-line py-8">
      <SectionHeader title="Investment focus" size="md" className="mb-5 border-b-0 pb-0" />
      <div className="flex flex-col gap-8">
        {manager && (
          <RoleBlock
            heading={both ? 'As a fund manager' : null}
            reportedOn={manager.reportedOn}
            rows={[
              labels('Stages', manager.stages),
              text('Main strategy', manager.mainStrategy),
              labels('Strategies', manager.strategies),
              labels('Industries', manager.industries),
              labels('Verticals', manager.verticals),
              labels('Geographic exposure', manager.geographicExposure),
              range('Initial equity investment', manager.initialEquityInvestment),
            ]}
          />
        )}
        {lp && (
          <RoleBlock
            heading={both ? 'As a limited partner' : null}
            reportedOn={lp.reportedOn}
            rows={[
              labels('Strategy preferences', lp.strategyPreferences),
              labels('Industries', lp.industries),
              labels('Verticals', lp.verticals),
              labels('Geographic preferences', lp.geographicPreferences),
              range('Typical fund commitment', lp.typicalCommitment),
            ]}
          />
        )}
      </div>
    </section>
  );
}
