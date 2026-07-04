import type { CreateAcquisitionInput } from '@repo/api';
import { z } from 'zod';

export const acquisitionFormSchema = z.object({
  target: z.string().trim().min(1, 'Target company is required.'),
  date: z.string().trim().min(1, 'Deal date is required.'),
  amountUsd: z.string().trim().regex(/^\d*$/, 'Enter a whole number.'),
  rationale: z.string().trim().min(1, 'A rationale is required.'),
});

export type AcquisitionFormValues = z.infer<typeof acquisitionFormSchema>;

export const acquisitionFormDefaults: AcquisitionFormValues = {
  target: '',
  date: '',
  amountUsd: '',
  rationale: '',
};

export function toAcquisitionInput(v: AcquisitionFormValues): CreateAcquisitionInput {
  return {
    target: v.target,
    date: v.date,
    rationale: v.rationale,
    ...(v.amountUsd ? { amountUsd: Number(v.amountUsd) } : {}),
  };
}
