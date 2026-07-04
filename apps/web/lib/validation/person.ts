import type { CreatePersonInput } from '@repo/api';
import { z } from 'zod';

import { urlOrEmpty } from './utils';

const NEXT_YEAR = new Date().getFullYear() + 1;

export const personFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  role: z.string().trim().min(1, 'Role is required.'),
  since: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter a 4-digit year.')
    .refine((v) => Number(v) >= 1800 && Number(v) <= NEXT_YEAR, 'Enter a realistic year.'),
  title: z.string().trim(),
  prior: z.string().trim(),
  linkedinUrl: urlOrEmpty,
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

export const personFormDefaults: PersonFormValues = {
  name: '',
  role: '',
  since: '',
  title: '',
  prior: '',
  linkedinUrl: '',
};

export function toPersonInput(v: PersonFormValues): CreatePersonInput {
  return {
    name: v.name,
    role: v.role,
    since: Number(v.since),
    ...(v.title ? { title: v.title } : {}),
    ...(v.prior ? { prior: v.prior } : {}),
    ...(v.linkedinUrl ? { linkedinUrl: v.linkedinUrl } : {}),
  };
}
