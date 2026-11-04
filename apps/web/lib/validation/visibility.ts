import {
  AUDIENCES,
  CONTRIBUTION_WINDOW_MAX_DAYS,
  PREVIEW_ROWS_MAX,
  SECTION_LEVELS,
  validateFieldPolicy,
  validateSectionPolicy,
  validateWindowDays,
  type FieldPolicy,
  type SectionPolicy,
} from '@repo/api';
import { z } from 'zod';

// The `/admin/visibility` forms. They mirror the API's DTOs (vocabularies,
// bounds) plus the same cross-field rules from `@repo/api` visibility.ts, so a
// rule the API would refuse shows the same message before the round trip. The
// API stays authoritative. Form values are strings; numbers convert in the
// mappers.

const level = z.enum(SECTION_LEVELS);
const audience = z.enum(AUDIENCES);
const digits = (max: number, what: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Enter a whole number of ${what}.`)
    .refine((v) => Number(v) >= 1 && Number(v) <= max, `From 1 to ${max} ${what}.`);

export const sectionPolicyFormSchema = z
  .object({
    section: z.string(),
    signedOut: level,
    signedIn: level,
    unlocked: level,
    previewRows: digits(PREVIEW_ROWS_MAX, 'rows'),
    partnerAudience: audience,
  })
  .superRefine((v, ctx) => {
    if (!/^\d+$/.test(v.previewRows.trim())) return;
    const error = validateSectionPolicy(v.section, toSectionPolicyInput(v));
    if (error) ctx.addIssue({ code: 'custom', path: ['signedOut'], message: error });
  });
export type SectionPolicyFormValues = z.infer<typeof sectionPolicyFormSchema>;

export const toSectionPolicyFormValues = (section: string, p: SectionPolicy): SectionPolicyFormValues => ({
  section,
  signedOut: p.signedOut,
  signedIn: p.signedIn,
  unlocked: p.unlocked,
  previewRows: String(p.previewRows),
  partnerAudience: p.partnerAudience,
});

export const toSectionPolicyInput = (v: SectionPolicyFormValues): SectionPolicy => ({
  signedOut: v.signedOut,
  signedIn: v.signedIn,
  unlocked: v.unlocked,
  previewRows: Number(v.previewRows),
  partnerAudience: v.partnerAudience,
});

export const fieldPolicyFormSchema = z
  .object({
    entity: z.string(),
    field: z.string(),
    audience,
    partnerAudience: audience,
  })
  .superRefine((v, ctx) => {
    const error = validateFieldPolicy(v.entity, v.field, toFieldPolicyInput(v));
    if (error) ctx.addIssue({ code: 'custom', path: ['partnerAudience'], message: error });
  });
export type FieldPolicyFormValues = z.infer<typeof fieldPolicyFormSchema>;

export const toFieldPolicyInput = (v: FieldPolicyFormValues): FieldPolicy => ({
  audience: v.audience,
  partnerAudience: v.partnerAudience,
});

export const windowFormSchema = z
  .object({ days: digits(CONTRIBUTION_WINDOW_MAX_DAYS, 'days') })
  .superRefine((v, ctx) => {
    if (!/^\d+$/.test(v.days.trim())) return;
    const error = validateWindowDays(Number(v.days));
    if (error) ctx.addIssue({ code: 'custom', path: ['days'], message: error });
  });
export type WindowFormValues = z.infer<typeof windowFormSchema>;
