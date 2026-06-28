import type { CreateFundingRoundInput } from '@repo/api';
import { z } from 'zod';

export const roundFormSchema = z.object({
  name: z.string().trim().min(1, 'Round name is required.'),
  date: z.string().trim().min(1, 'Round date is required.'),
  amountUsd: z.string().trim().regex(/^\d+$/, 'Enter a valid raise amount.'),
  postMoneyUsd: z.string().trim().regex(/^\d*$/, 'Enter a whole number.'),
  lead: z.string().trim(),
});

export type RoundFormValues = z.infer<typeof roundFormSchema>;

export const roundFormDefaults: RoundFormValues = {
  name: '',
  date: '',
  amountUsd: '',
  postMoneyUsd: '',
  lead: '',
};

export function toRoundInput(v: RoundFormValues): CreateFundingRoundInput {
  const lead = v.lead.trim();
  return {
    name: v.name,
    date: v.date,
    amountUsd: Number(v.amountUsd),
    ...(v.postMoneyUsd ? { postMoneyUsd: Number(v.postMoneyUsd) } : {}),
    ...(lead ? { lead } : {}),
    investors: lead ? [{ name: lead, lead: true }] : [],
  };
}
