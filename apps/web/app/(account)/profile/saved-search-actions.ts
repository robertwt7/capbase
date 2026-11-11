'use server';
import { revalidatePath } from 'next/cache';
import { ApiError } from '@/lib/api';
import { featureFetch, saveSearch } from '@/lib/saved-searches';
import {
  saveSearchSchema,
  savedSearchFormSchema,
} from '@/lib/validation/saved-search';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';
const failure = (error: unknown): ActionResult => ({
  ok: false,
  formError:
    error instanceof ApiError && error.status === 403
      ? 'Current full access is required.'
      : 'Could not save this change. Check your search and try again.',
});
export async function saveSearchAction(values: unknown): Promise<ActionResult> {
  const parsed = saveSearchSchema.safeParse(values);
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  try {
    await saveSearch(parsed.data);
    revalidatePath('/profile');
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
export async function renameSearchAction(
  id: string,
  values: unknown,
): Promise<ActionResult> {
  const parsed = savedSearchFormSchema.safeParse(values);
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  try {
    await featureFetch(
      `/auth/me/saved-searches/${encodeURIComponent(id)}`,
      'PATCH',
      parsed.data,
    );
    revalidatePath('/profile');
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
export async function deleteSearchAction(id: string): Promise<ActionResult> {
  try {
    await featureFetch(
      `/auth/me/saved-searches/${encodeURIComponent(id)}`,
      'DELETE',
    );
    revalidatePath('/profile');
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
