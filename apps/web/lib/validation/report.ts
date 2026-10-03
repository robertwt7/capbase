import {
  REPORT_MESSAGE_MAX,
  REPORT_MESSAGE_MIN,
  REPORT_REASONS,
  type CreateReportInput,
  type ReportableType,
  type ReportReason,
} from '@repo/api';
import { z } from 'zod';

export const reportFormSchema = z.object({
  // The empty default fails the enum, so "no reason picked" shows this message.
  reason: z.enum(REPORT_REASONS as readonly [string, ...string[]], {
    message: 'Choose a reason.',
  }),
  message: z
    .string()
    .trim()
    .min(
      REPORT_MESSAGE_MIN,
      `Tell us a little more (at least ${REPORT_MESSAGE_MIN} characters).`,
    )
    .max(REPORT_MESSAGE_MAX, `Keep it under ${REPORT_MESSAGE_MAX} characters.`),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || z.email().safeParse(v).success,
      'Enter a valid email, or leave it blank.',
    ),
});

export type ReportFormValues = z.infer<typeof reportFormSchema>;

export const reportFormDefaults: ReportFormValues = {
  reason: '',
  message: '',
  email: '',
};

export function toReportInput(
  entityType: ReportableType,
  slug: string,
  v: ReportFormValues,
): CreateReportInput {
  return {
    entityType,
    slug,
    reason: v.reason as ReportReason,
    message: v.message,
    ...(v.email ? { email: v.email } : {}),
  };
}
