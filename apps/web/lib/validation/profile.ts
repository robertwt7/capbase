import type { AuthUser, ChangePasswordInput, UpdateProfileInput } from '@repo/api';
import { z } from 'zod';

export const profileFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  email: z.email('Enter a valid email address.'),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function profileDefaultsFromUser(user: AuthUser): ProfileFormValues {
  return { name: user.name, email: user.email };
}

export function toProfileInput(v: ProfileFormValues): UpdateProfileInput {
  return { name: v.name, email: v.email };
}

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export type PasswordFormValues = z.infer<typeof passwordFormSchema>;

export const passwordFormDefaults: PasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export function toPasswordInput(v: PasswordFormValues): ChangePasswordInput {
  return { currentPassword: v.currentPassword, newPassword: v.newPassword };
}
