import {
  CLAIM_EVIDENCE_URL_MAX,
  CLAIM_NOTE_MAX,
  CLAIM_NOTE_MIN,
  type ClaimRequestInput,
  type StartEmailClaimInput,
} from '@repo/api';
import { z } from 'zod';

import { urlOrEmpty } from './utils';

/** "I am authorised to represent this company" — the same must-be-true boolean as the
 *  contribution attestation, under its own key and wording (the API checks `@Equals(true)`). */
const authorised = z.boolean().refine((v) => v, {
  message: 'Please confirm you are authorised to represent this company.',
});

export const claimEmailFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your work email address.')
    .max(254, 'That address is too long.')
    .email('Enter a valid email address.'),
  authorised,
});

export type ClaimEmailFormValues = z.infer<typeof claimEmailFormSchema>;

export const claimEmailFormDefaults: ClaimEmailFormValues = { email: '', authorised: false };

export function toStartEmailClaimInput(v: ClaimEmailFormValues): StartEmailClaimInput {
  return { email: v.email.trim(), authorised: v.authorised };
}

export const claimRequestFormSchema = z.object({
  note: z
    .string()
    .trim()
    .min(CLAIM_NOTE_MIN, `Tell us how you're connected to the company (at least ${CLAIM_NOTE_MIN} characters).`)
    .max(CLAIM_NOTE_MAX, `Keep it under ${CLAIM_NOTE_MAX} characters.`),
  evidenceUrl: urlOrEmpty.refine((v) => v.length <= CLAIM_EVIDENCE_URL_MAX, 'That link is too long.'),
  authorised,
});

export type ClaimRequestFormValues = z.infer<typeof claimRequestFormSchema>;

export const claimRequestFormDefaults: ClaimRequestFormValues = {
  note: '',
  evidenceUrl: '',
  authorised: false,
};

export function toClaimRequestInput(v: ClaimRequestFormValues): ClaimRequestInput {
  return {
    note: v.note.trim(),
    ...(v.evidenceUrl ? { evidenceUrl: v.evidenceUrl } : {}),
    authorised: v.authorised,
  };
}
