'use server';

import { REPORTABLE_TYPES, type ReportableType } from '@repo/api';

import { reportErrorMessage, submitReport } from '@/lib/reports';
import { reportFormSchema, toReportInput } from '@/lib/validation/report';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

export async function reportAction(
  type: string,
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  if (!REPORTABLE_TYPES.includes(type as ReportableType) || !slug) {
    return {
      ok: false,
      formError: 'Missing profile reference. Reload and try again.',
    };
  }

  const parsed = reportFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await submitReport(
      toReportInput(type as ReportableType, slug, parsed.data),
      turnstileToken,
    );
  } catch (err) {
    return { ok: false, formError: reportErrorMessage(err) };
  }
  return { ok: true };
}
