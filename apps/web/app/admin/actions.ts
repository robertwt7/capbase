'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReviewableType } from '@repo/api';

import { moderateSubmission } from '../../lib/admin';
import { TOKEN_COOKIE } from '../../lib/auth';

// Server action invoked from the moderation queue's Approve/Reject forms.
// Bound with (type, id, status) per row; no client JS required.
export async function moderateAction(
  type: ReviewableType,
  id: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<void> {
  await moderateSubmission(type, id, status);
  revalidatePath('/admin');
}

/** Clear the admin session cookie and return to the login screen. */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  redirect('/admin/login');
}
