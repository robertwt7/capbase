'use server';

import { revalidatePath } from 'next/cache';

import { mergeCandidate, rejectCandidate, unmergeRecord } from '../../../lib/admin';

// Server actions for the merge queue, bound per row. No client JS required —
// same plain-form pattern as the moderation queue's Approve/Reject.

export async function mergeAction(candidateId: string, survivorId: string): Promise<void> {
  await mergeCandidate(candidateId, survivorId);
  revalidatePath('/admin/merges');
}

export async function rejectAction(candidateId: string): Promise<void> {
  await rejectCandidate(candidateId);
  revalidatePath('/admin/merges');
}

export async function unmergeAction(recordId: string): Promise<void> {
  await unmergeRecord(recordId);
  revalidatePath('/admin/merges');
}
