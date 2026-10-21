import { PASSKEY_NAME_MAX, type PasswordConfirmInput } from '@repo/api';
import { z } from 'zod';

/** Step-up before any security change: the current password. */
export const passwordConfirmSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(128, 'Use at most 128 characters.'),
});

export type PasswordConfirmValues = z.infer<typeof passwordConfirmSchema>;

export const passwordConfirmDefaults: PasswordConfirmValues = { password: '' };

export function toPasswordConfirmInput(v: PasswordConfirmValues): PasswordConfirmInput {
  return { password: v.password };
}

/** A 6-digit authenticator code, allowing the `123 456` some apps display. */
export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3}\s?\d{3}$/, 'Enter the 6-digit code.'),
});

export type TotpCodeValues = z.infer<typeof totpCodeSchema>;

/** The digits only, as the API wants them. */
export const totpDigits = (code: string) => code.replace(/\s/g, '');

export const totpCodeDefaults: TotpCodeValues = { code: '' };

/** A recovery code as printed (`xxxxx-xxxxx`), in any case, with or without the dash. */
export const recoveryCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{5}[\s-]?[a-z0-9]{5}$/i, 'Enter a recovery code, like abcde-23456.'),
});

export type RecoveryCodeValues = z.infer<typeof recoveryCodeSchema>;

export const recoveryCodeDefaults: RecoveryCodeValues = { code: '' };

/** Adding a passkey: the password plus a name to tell it apart later. */
export const passkeyFormSchema = passwordConfirmSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, 'Give it a name, like “Work laptop”.')
    .max(PASSKEY_NAME_MAX, `Keep it under ${PASSKEY_NAME_MAX} characters.`),
});

export type PasskeyFormValues = z.infer<typeof passkeyFormSchema>;

export const passkeyFormDefaults: PasskeyFormValues = { password: '', name: 'Passkey' };
