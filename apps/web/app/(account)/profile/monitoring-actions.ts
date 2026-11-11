'use server';
import { revalidatePath } from 'next/cache';
import type { MonitorState } from '@repo/api';
import { featureFetch } from '@/lib/saved-searches';
import type { ActionResultWith } from '@/lib/validation/utils';
export async function setMonitoringAction(
  kind: 'search' | 'company',
  id: string,
  enabled: boolean,
): Promise<ActionResultWith<MonitorState>> {
  try {
    const result = await featureFetch<MonitorState>(
      `/auth/me/${kind === 'search' ? 'saved-searches' : 'saved-companies'}/${encodeURIComponent(id)}/monitoring`,
      enabled ? 'PUT' : 'DELETE',
    );
    revalidatePath('/profile');
    return { ok: true, ...result };
  } catch {
    return {
      ok: false,
      formError:
        'Monitoring could not be changed. Check your current access and try again.',
    };
  }
}
