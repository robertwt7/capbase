import type { LoginInput, RegisterInput } from '@repo/api';
import { z } from 'zod';

export const registerFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.'),
    email: z.email('Enter a valid email address.'),
    password: z.string().min(8, 'Use at least 8 characters.'),
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
