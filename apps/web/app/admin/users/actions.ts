'use server';

import { revalidatePath } from 'next/cache';
import type { Role } from '@repo/api';

import { updateUser } from '../../../lib/admin';

// Server actions for the user list, bound per row — the same plain-form
// pattern as the moderation and merge queues.

/** Ban (which also rejects the user's pending submissions) or lift a ban. */
export async function setBannedAction(id: string, banned: boolean): Promise<void> {
  await updateUser(id, { banned });
  revalidatePath('/admin/users');
  revalidatePath('/admin');
}

export async function setRoleAction(id: string, role: Role): Promise<void> {
  await updateUser(id, { role });
  revalidatePath('/admin/users');
}
