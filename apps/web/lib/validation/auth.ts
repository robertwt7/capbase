import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '@repo/api';
import { z } from 'zod';

export const registerFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120, 'Keep it under 120 characters.'),
    email: z.email('Enter a valid email address.'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export const registerFormDefaults: RegisterFormValues = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

/** confirmPassword is client-only — never sent to the API. */
export function toRegisterInput(v: RegisterFormValues): RegisterInput {
  return { name: v.name, email: v.email, password: v.password };
}

export const loginFormSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const loginFormDefaults: LoginFormValues = { email: '', password: '' };

export function toLoginInput(v: LoginFormValues): LoginInput {
  return { email: v.email, password: v.password };
}

export const forgotPasswordFormSchema = z.object({
  email: z.email('Enter a valid email address.'),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

export const forgotPasswordFormDefaults: ForgotPasswordFormValues = { email: '' };

export function toForgotPasswordInput(v: ForgotPasswordFormValues): ForgotPasswordInput {
  return { email: v.email };
}

export const resetPasswordFormSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const resetPasswordFormDefaults: ResetPasswordFormValues = {
  password: '',
  confirmPassword: '',
};

/** The token rides in the link, not the form; confirmPassword stays client-side. */
export function toResetPasswordInput(
  token: string,
  v: ResetPasswordFormValues,
): ResetPasswordInput {
  return { token, password: v.password };
}
