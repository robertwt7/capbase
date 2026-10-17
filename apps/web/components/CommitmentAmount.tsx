import { formatMoney, formatUsd } from '@/lib/format';

/** A commitment in its own currency with the USD equivalent beside it — the
 *  Funding Ladder's convention. "Undisclosed" when the amount is unknown. */
export function CommitmentAmount({
  amountUsd,
  amountLocal,
  currency,
}: {
  amountUsd: number | null;
  amountLocal: number | null;
  currency: string;
}) {
  const foreign = currency !== 'USD' && amountLocal != null;
  if (amountUsd == null && !foreign) {
    return (
      <span className="text-right font-mono text-[13px] text-muted-foreground max-[720px]:text-left">
        Undisclosed
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end text-right max-[720px]:items-start max-[720px]:text-left">
      <span className="font-mono text-[15px] font-medium text-ink">
        {foreign ? formatMoney(amountLocal, currency) : formatUsd(amountUsd)}
      </span>
      {foreign && amountUsd != null && (
        <span className="font-mono text-xs text-graphite-500" title="USD equivalent (ECB reference rate)">
          ≈ {formatUsd(amountUsd)}
        </span>
      )}
    </span>
  );
}
