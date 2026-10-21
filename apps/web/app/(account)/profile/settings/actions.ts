'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { PasskeyOptions, RecoveryCodes, TotpSetup } from '@repo/api';
import type { z } from 'zod';

import {
  beginTotp,
  changePassword,
  confirmTotp,
  disableTotp,
  passkeyRegistrationOptions,
  regenerateRecoveryCodes,
  registerPasskey,
  removePasskey,
  updateProfile,
} from '@/lib/account';
import { ApiError } from '@/lib/api';
import { TOKEN_COOKIE, TOKEN_COOKIE_OPTIONS } from '@/lib/auth';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import {
  passkeyFormSchema,
  passwordConfirmSchema,
  toPasswordConfirmInput,
  totpCodeSchema,
  totpDigits,
} from '@/lib/validation/mfa';
import {
  passwordFormSchema,
  profileFormSchema,
  toPasswordInput,
  toProfileInput,
} from '@/lib/validation/profile';
import {
  fieldErrorsFromZod,
  type ActionResult,
  type ActionResultWith,
} from '@/lib/validation/utils';

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
    // Changing the password revokes every session, this one included; keep
    // the user signed in here with the fresh token the API hands back.
    const auth = await changePassword(toPasswordInput(parsed.data));
    (await cookies()).set(TOKEN_COOKIE, auth.accessToken, TOKEN_COOKIE_OPTIONS);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, fieldErrors: { currentPassword: 'Current password is incorrect.' } };
    }
    return { ok: false, formError: 'Could not change your password. Please try again.' };
  }

  return { ok: true };
}

// --- Security: two-factor authentication & passkeys -----------------------------------------

/** The API's message for a 400 (it is written for people), else the fallback. */
function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    const message = (error.body as { message?: unknown } | undefined)?.message;
    if (error.status === 400 && typeof message === 'string') return message;
  }
  return fallback;
}

/** A failed password-confirmed call: 401 is the password, anything else a form error. */
function passwordFailure(error: unknown, fallback: string): { ok: false; formError?: string; fieldErrors?: Record<string, string> } {
  if (error instanceof ApiError && error.status === 401) {
    return { ok: false, fieldErrors: { password: 'Password is incorrect.' } };
  }
  return { ok: false, formError: apiMessage(error, fallback) };
}

function invalid(error: z.ZodError) {
  return {
    ok: false as const,
    fieldErrors: fieldErrorsFromZod(error),
    formError: 'Please fix the highlighted fields.',
  };
}

export async function beginTotpAction(values: unknown): Promise<ActionResultWith<{ setup: TotpSetup }>> {
  const parsed = passwordConfirmSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { ok: true, setup: await beginTotp(toPasswordConfirmInput(parsed.data)) };
  } catch (error) {
    return passwordFailure(error, 'Could not start setup. Please try again.');
  }
}

export async function confirmTotpAction(
  challenge: string,
  values: unknown,
): Promise<ActionResultWith<RecoveryCodes>> {
  const parsed = totpCodeSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await confirmTotp({ challenge, code: totpDigits(parsed.data.code) });
    revalidatePath('/profile/settings');
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, formError: 'This setup has expired. Start again.' };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { ok: false, fieldErrors: { code: apiMessage(error, 'That code didn’t work.') } };
    }
    return { ok: false, formError: apiMessage(error, 'Could not finish setup. Please try again.') };
  }
}

export async function disableTotpAction(values: unknown): Promise<ActionResult> {
  const parsed = passwordConfirmSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await disableTotp(toPasswordConfirmInput(parsed.data));
  } catch (error) {
    return passwordFailure(error, 'Could not remove the authenticator app. Please try again.');
  }
  revalidatePath('/profile/settings');
  return { ok: true };
}

export async function regenerateRecoveryCodesAction(
  values: unknown,
): Promise<ActionResultWith<RecoveryCodes>> {
  const parsed = passwordConfirmSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await regenerateRecoveryCodes(toPasswordConfirmInput(parsed.data));
    revalidatePath('/profile/settings');
    return { ok: true, ...result };
  } catch (error) {
    return passwordFailure(error, 'Could not generate new codes. Please try again.');
  }
}

/** Step one of adding a passkey: the password, then the options the browser needs. */
export async function passkeyOptionsAction(
  values: unknown,
): Promise<ActionResultWith<PasskeyOptions & { name: string }>> {
  const parsed = passkeyFormSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const options = await passkeyRegistrationOptions({ password: parsed.data.password });
    return { ok: true, ...options, name: parsed.data.name };
  } catch (error) {
    return passwordFailure(error, 'Could not add a passkey. Please try again.');
  }
}

/** Step two: the browser's registration response. */
export async function registerPasskeyAction(input: {
  challenge: string;
  response: Record<string, unknown>;
  name: string;
}): Promise<ActionResultWith<RecoveryCodes>> {
  const name = passkeyFormSchema.shape.name.safeParse(input.name);
  if (!name.success || typeof input.challenge !== 'string') {
    return { ok: false, formError: 'Could not add a passkey. Please try again.' };
  }
  try {
    const result = await registerPasskey({ ...input, name: name.data });
    revalidatePath('/profile/settings');
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, formError: 'That passkey is already registered.' };
    }
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, formError: 'This request has expired. Start again.' };
    }
    return { ok: false, formError: apiMessage(error, 'Could not add a passkey. Please try again.') };
  }
}

export async function removePasskeyAction(id: string, values: unknown): Promise<ActionResult> {
  const parsed = passwordConfirmSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await removePasskey(id, toPasswordConfirmInput(parsed.data));
  } catch (error) {
    return passwordFailure(error, 'Could not remove the passkey. Please try again.');
  }
  revalidatePath('/profile/settings');
  return { ok: true };
}
