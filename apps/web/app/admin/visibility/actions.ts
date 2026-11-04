'use server';

import { revalidatePath } from 'next/cache';

import {
  resetContributionWindow,
  resetFieldPolicy,
  resetSectionPolicy,
  updateContributionWindow,
  updateFieldPolicy,
  updateSectionPolicy,
} from '@/lib/admin';
import { ApiError } from '@/lib/api';
import {
  fieldPolicyFormSchema,
  sectionPolicyFormSchema,
  toFieldPolicyInput,
  toSectionPolicyInput,
  windowFormSchema,
} from '@/lib/validation/visibility';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

// Server actions for `/admin/visibility`. Each re-validates the form (never
// trust the client), calls the API — the `@Roles('ADMIN')` controller is the
// gate — and refreshes the page. A 400 carries the API's message as the form
// error, so a rule it refuses reads the same as the client's.

const PATH = '/admin/visibility';

async function run(call: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
      const message = (error.body as { message?: unknown } | undefined)?.message;
      const text = Array.isArray(message) ? message.join(' ') : message;
      return { ok: false, formError: typeof text === 'string' ? text : 'That setting was refused.' };
    }
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { ok: false, formError: 'Your admin session has ended. Sign in again.' };
    }
    return { ok: false, formError: 'Could not save. Please try again.' };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateSectionAction(values: unknown): Promise<ActionResult> {
  const parsed = sectionPolicyFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  return run(() => updateSectionPolicy(parsed.data.section, toSectionPolicyInput(parsed.data)));
}

export async function resetSectionAction(section: string): Promise<ActionResult> {
  return run(() => resetSectionPolicy(section));
}

export async function updateFieldAction(values: unknown): Promise<ActionResult> {
  const parsed = fieldPolicyFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  return run(() => updateFieldPolicy(parsed.data.entity, parsed.data.field, toFieldPolicyInput(parsed.data)));
}

export async function resetFieldAction(entity: string, field: string): Promise<ActionResult> {
  return run(() => resetFieldPolicy(entity, field));
}

export async function updateWindowAction(values: unknown): Promise<ActionResult> {
  const parsed = windowFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  return run(() => updateContributionWindow(Number(parsed.data.days)));
}

export async function resetWindowAction(): Promise<ActionResult> {
  return run(() => resetContributionWindow());
}
