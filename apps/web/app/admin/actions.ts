'use server';

import { revalidatePath } from 'next/cache';
import type { ReviewableType } from '@repo/api';

import { decideClaim, moderateSubmission } from '../../lib/admin';

// Server action invoked from each queue card's decision form. Approve and
// Reject share that form and pick the action via `formAction`, bound with
// (type, id, status); no client JS required. The optional `note` is a
// rejection reason quoted in the contributor's email, so it is read only on a
// rejection — an approval never forwards a reason typed into the box.
export async function moderateAction(
  type: ReviewableType,
  id: string,
  status: 'APPROVED' | 'REJECTED',
  formData?: FormData,
): Promise<void> {
  const note = status === 'REJECTED' ? formData?.get('note') : null;
  await moderateSubmission(
    type,
    id,
    status,
    typeof note === 'string' && note.trim() ? note.trim() : undefined,
  );
  revalidatePath('/admin');
}

/** Revoke, approve or reject a company claim from `/admin/claims` or the per-user view. The
 *  reason box is read only on a rejection. */
export async function claimDecisionAction(
  id: string,
  decision: 'approve' | 'reject' | 'revoke',
  formData?: FormData,
): Promise<void> {
  const note = decision === 'reject' ? formData?.get('note') : null;
  await decideClaim(id, decision, typeof note === 'string' && note.trim() ? note.trim() : undefined);
  revalidatePath('/admin', 'layout');
}
