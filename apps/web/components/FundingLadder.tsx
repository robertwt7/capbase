import type { Citation as CitationRow } from '@repo/api';

import { Citation } from '@/components/Citation';
import { Badge } from '@/components/ui';
import type { FundingRound } from '@/lib/data';
import { formatDate, formatMoney, formatUsd } from '@/lib/format';

interface FundingLadderProps {
  rounds: FundingRound[];
  /** The profile's citations; each rung resolves its own from this list. */
  citations?: CitationRow[];
}

// The signature view: funding rounds are an ordered sequence, so we render them
// as a vertical ledger where each rung's bar width encodes the capital raised.
// Reading top to bottom traces the company's trajectory like a cap table.
//
// A round published in another currency (an Innovate UK grant in pounds) is
// labelled in that currency, with its USD equivalent beside the date — but the
// bar width stays on `amountUsd`, so rungs in two currencies remain comparable.
//
// A round whose amount was never disclosed (amountUsd 0, no local figure) is a
// real event with an unknown size: it keeps the minimum width as an outline,
// reads "Undisclosed", and is left out of the scale so it cannot squash the
// rungs that do have a size.
const isUndisclosed = (r: FundingRound) => r.amountUsd === 0 && r.amountLocal == null;

export function FundingLadder({ rounds, citations = [] }: FundingLadderProps) {
  const max = Math.max(1, ...rounds.filter((r) => !isUndisclosed(r)).map((r) => r.amountUsd));

  return (
    <ol className="flex flex-col">
      {rounds.map((round, i) => {
        const undisclosed = isUndisclosed(round);
        const width = undisclosed ? 8 : Math.max(8, Math.round((round.amountUsd / max) * 100));
        const last = i === rounds.length - 1;
        const foreign =
          round.currency && round.currency !== 'USD' && round.amountLocal != null
            ? { currency: round.currency, amount: round.amountLocal }
            : null;
        return (
          <li
            key={round.id}
            className={
              'grid items-center gap-x-5 border-t border-line py-[18px] first:border-t-0 ' +
              'grid-cols-[24px_150px_1fr_200px] ' +
              'max-md:grid-cols-[18px_1fr] max-md:gap-y-2.5'
            }
          >
            <div
              className="relative flex justify-center self-stretch max-md:row-[1/span_3]"
              aria-hidden="true"
            >
              <span className="relative z-[1] mt-1.5 size-[9px] rounded-full bg-ink" />
              {!last && (
                <span className="absolute top-2.5 -bottom-[18px] w-px bg-graphite-300 max-md:-bottom-2.5" />
              )}
            </div>

            <div className="flex flex-col gap-0.5 max-md:col-start-2 max-md:flex-row max-md:items-baseline max-md:gap-2.5">
              <span className="flex items-center gap-2">
                <span className="font-display text-base font-semibold tracking-tight text-ink">
                  {round.name}
                </span>
                {/* Non-equity capital is a different kind of event, and the ladder
                    must not let a federal grant read as a priced round. */}
                {round.kind !== 'Equity' && (
                  <Badge variant="box" mono>
                    {round.kind}
                  </Badge>
                )}
              </span>
              <span className="font-mono text-xs text-graphite-500">
                {formatDate(round.date)}
                {foreign && (
                  <span className="ml-2" title="USD equivalent at the round's date (ECB reference rate)">
                    ≈ {formatUsd(round.amountUsd)}
                  </span>
                )}
                <Citation citations={citations} entityId={round.id} />
              </span>
            </div>

            <div className="flex h-[34px] items-center max-md:col-start-2">
              {undisclosed ? (
                <div
                  className="flex h-full min-w-28 items-center rounded-[3px] border border-dashed border-graphite-400 px-3"
                  style={{ width: `${width}%` }}
                >
                  <span className="font-mono text-[13px] text-muted-foreground">Undisclosed</span>
                </div>
              ) : (
                <div
                  className="flex h-full min-w-16 items-center justify-end rounded-[3px] bg-ink px-3 transition-[width] duration-500 ease-out"
                  style={{ width: `${width}%` }}
                >
                  <span className="font-mono text-[13px] font-medium text-paper">
                    {foreign ? formatMoney(foreign.amount, foreign.currency) : formatUsd(round.amountUsd)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-0.5 text-right max-md:col-start-2 max-md:items-start max-md:text-left">
              <span className="flex items-baseline gap-1.5 font-mono text-[15px] font-medium text-ink">
                {round.postMoneyUsd ? formatUsd(round.postMoneyUsd) : '—'}
                <span className="font-sans text-[11px] uppercase tracking-[0.04em] text-graphite-400">
                  post-money
                </span>
              </span>
              {round.lead && (
                <span className="font-sans text-xs text-graphite-500">Led by {round.lead}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
