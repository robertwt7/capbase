import type { FundingRound } from '@/lib/data';
import { formatDate, formatUsd } from '@/lib/format';

interface FundingLadderProps {
  rounds: FundingRound[];
}

// The signature view: funding rounds are an ordered sequence, so we render them
// as a vertical ledger where each rung's bar width encodes the capital raised.
// Reading top to bottom traces the company's trajectory like a cap table.
export function FundingLadder({ rounds }: FundingLadderProps) {
  const max = Math.max(...rounds.map((r) => r.amountUsd));

  return (
    <ol className="flex flex-col">
      {rounds.map((round, i) => {
        const width = Math.max(8, Math.round((round.amountUsd / max) * 100));
        const last = i === rounds.length - 1;
        return (
          <li
            key={round.name}
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
              <span className="font-display text-base font-semibold tracking-tight text-ink">
                {round.name}
              </span>
              <span className="font-mono text-xs text-graphite-500">{formatDate(round.date)}</span>
            </div>

            <div className="flex h-[34px] items-center max-md:col-start-2">
              <div
                className="flex h-full min-w-16 items-center justify-end rounded-[3px] bg-ink px-3 transition-[width] duration-500 ease-out"
                style={{ width: `${width}%` }}
              >
                <span className="font-mono text-[13px] font-medium text-paper">
                  {formatUsd(round.amountUsd)}
                </span>
              </div>
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
