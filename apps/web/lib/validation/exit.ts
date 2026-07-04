import { EXIT_TYPES, type CreateExitInput } from '@repo/api';
import { z } from 'zod';

export const exitFormSchema = z.object({
  type: z.enum(EXIT_TYPES as readonly [string, ...string[]], {
    message: 'Pick a valid exit type.',
  }),
  date: z.string().trim().min(1, 'Exit date is required.'),
  valueUsd: z.string().trim().regex(/^\d*$/, 'Enter a whole number.'),
  detail: z.string().trim().min(1, 'A short description is required.'),
});

export type ExitFormValues = z.infer<typeof exitFormSchema>;

export const exitFormDefaults: ExitFormValues = {
  type: 'IPO',
  date: '',
  valueUsd: '',
  detail: '',
};

export function toExitInput(v: ExitFormValues): CreateExitInput {
  return {
    type: v.type as CreateExitInput['type'],
    date: v.date,
    detail: v.detail,
    ...(v.valueUsd ? { valueUsd: Number(v.valueUsd) } : {}),
  };
}
