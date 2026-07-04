import { INVESTOR_TYPES, type CreateInvestorInput } from '@repo/api';
import { z } from 'zod';

import { urlOrEmpty } from './utils';

export const investorFormSchema = z.object({
  name: z.string().trim().min(1, 'Investor name is required.'),
  type: z.enum(INVESTOR_TYPES as readonly [string, ...string[]], {
    message: 'Pick a valid investor type.',
  }),
  firstRound: z.string().trim().min(1, 'First round is required.'),
  rounds: z.string().trim().regex(/^\d+$/, 'Enter a whole number.'),
  websiteUrl: urlOrEmpty,
  linkedinUrl: urlOrEmpty,
});

export type InvestorFormValues = z.infer<typeof investorFormSchema>;

export const investorFormDefaults: InvestorFormValues = {
  name: '',
  type: 'Venture',
  firstRound: '',
  rounds: '',
  websiteUrl: '',
  linkedinUrl: '',
};

export function toInvestorInput(v: InvestorFormValues): CreateInvestorInput {
  return {
    name: v.name,
    type: v.type as CreateInvestorInput['type'],
    firstRound: v.firstRound,
    rounds: Number(v.rounds),
    ...(v.websiteUrl ? { websiteUrl: v.websiteUrl } : {}),
    ...(v.linkedinUrl ? { linkedinUrl: v.linkedinUrl } : {}),
  };
}
