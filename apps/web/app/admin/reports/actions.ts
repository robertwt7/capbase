'use server';

import { revalidatePath } from 'next/cache';

import { dismissReport, resolveReport } from '../../../lib/admin';

// Server actions for the report queue. Bound per report; the note/link come
// from the card's one <form>, and the clicked button's `formAction` picks which
// of these runs. No client JS required.

/** Trimmed field value, or undefined when blank. */
function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function dismissAction(
  id: string,
  formData: FormData,
): Promise<void> {
  await dismissReport(id, text(formData, 'note'));
  revalidatePath('/admin/reports');
}

export async function resolveAction(
  id: string,
  formData: FormData,
): Promise<void> {
  await resolveReport(id, {
    note: text(formData, 'note'),
    url: text(formData, 'url'),
  });
  revalidatePath('/admin/reports');
}

export async function suppressAndResolveAction(
  id: string,
  personSlug: string,
  formData: FormData,
): Promise<void> {
  await resolveReport(id, {
    note: text(formData, 'note'),
    url: text(formData, 'url'),
    suppressPerson: true,
  });
  revalidatePath('/admin/reports');
  // Drop the 60s ISR copy so the profile 404s now, not in a minute.
  revalidatePath(`/people/${personSlug}`);
}
