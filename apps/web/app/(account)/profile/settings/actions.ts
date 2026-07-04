'use server';

import { revalidatePath } from 'next/cache';

import { changePassword, updateProfile } from '@/lib/account';
import { ApiError } from '@/lib/api';
import {
  passwordFormSchema,
  profileFormSchema,
  toPasswordInput,
  toProfileInput,
} from '@/lib/validation/profile';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

export async function updateProfileAction(values: unknown): Promise<ActionResult> {
  const parsed = profileFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await updateProfile(toProfileInput(parsed.data));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, fieldErrors: { email: 'Email already registered.' } };
    }
    return { ok: false, formError: 'Could not save your details. Please try again.' };
  }

  revalidatePath('/profile');
  revalidatePath('/profile/settings');
  return { ok: true };
}

export async function changePasswordAction(values: unknown): Promise<ActionResult> {
  const parsed = passwordFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await changePassword(toPasswordInput(parsed.data));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, fieldErrors: { currentPassword: 'Current password is incorrect.' } };
    }
    return { ok: false, formError: 'Could not change your password. Please try again.' };
  }

  return { ok: true };
}
