import type { CreateDiversityInput } from '@repo/api';
import { z } from 'zod';

export const diversityFormSchema = z.object({
  label: z.string().trim().min(1, 'A label is required.'),
  value: z.string().trim().min(1, 'A value is required.'),
  note: z.string().trim().min(1, 'A one-line note is required.'),
});

export type DiversityFormValues = z.infer<typeof diversityFormSchema>;

export const diversityFormDefaults: DiversityFormValues = {
  label: '',
  value: '',
  note: '',
};

export function toDiversityInput(v: DiversityFormValues): CreateDiversityInput {
  return {
    label: v.label,
    value: v.value,
    note: v.note,
  };
}
