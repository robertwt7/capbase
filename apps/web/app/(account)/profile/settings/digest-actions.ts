'use server';
import { revalidatePath } from 'next/cache';
import { featureFetch } from '@/lib/saved-searches';
import type { ActionResult } from '@/lib/validation/utils';
export async function setDigestAction(enabled: boolean): Promise<ActionResult> {
  try {
    await featureFetch('/auth/me/digest', enabled ? 'PUT' : 'DELETE');
    revalidatePath('/profile/settings');
    return { ok: true };
  } catch {
    return {
      ok: false,
      formError:
        'Weekly email could not be changed. Enabling it requires current full access and a verified email.',
    };
  }
}
