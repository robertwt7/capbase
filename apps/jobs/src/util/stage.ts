import type { Stage } from '@repo/api';

/** Rough stage inference from round size, for a source that does not name the
 *  round series — Form D never does, and a partner deal often doesn't. Bands
 *  by amount to keep a valid Stage value. */
export function stageFromAmount(amountUsd: number): Stage {
  if (amountUsd < 5_000_000) return 'Seed';
  if (amountUsd < 20_000_000) return 'Series A';
  if (amountUsd < 60_000_000) return 'Series B';
  if (amountUsd < 150_000_000) return 'Series C';
  if (amountUsd < 400_000_000) return 'Series D';
  return 'Late stage';
}
