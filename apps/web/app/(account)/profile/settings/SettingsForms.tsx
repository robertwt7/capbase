'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { AuthUser } from '@repo/api';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  passwordFormDefaults,
  passwordFormSchema,
  profileDefaultsFromUser,
  profileFormSchema,
  type PasswordFormValues,
  type ProfileFormValues,
} from '@/lib/validation/profile';
import { applyServerErrors, type ActionResult } from '@/lib/validation/utils';

import { changePasswordAction, updateProfileAction } from './actions';

/** Inline post-save confirmation, in the mono meta style. */
function SavedNote() {
  return (
    <span
      role="status"
      className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-graphite-500"
    >
      Saved
    </span>
  );
}

function AccountDetailsForm({ user }: { user: AuthUser }) {
  const router = useRouter();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileDefaultsFromUser(user),
    mode: 'onBlur',
  });
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    setSaved(false);
    const result: ActionResult = await updateProfileAction(values);
    if (result.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    if (result.formError || !result.fieldErrors) {
      setFormError(result.formError ?? 'Something went wrong. Please try again.');
    }
  });

  return (
    <Card className="p-6">
      <h2 className="font-display text-base font-semibold tracking-tight text-ink">
        Account details
      </h2>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <TextField control={form.control} name="name" label="Name" autoComplete="name" />
          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
          />

          {formError ? <FormError>{formError}</FormError> : null}

          <div className="flex items-center gap-4">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
            {saved ? <SavedNote /> : null}
          </div>
        </form>
      </Form>
    </Card>
  );
}

function ChangePasswordForm() {
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: passwordFormDefaults,
    mode: 'onBlur',
  });
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    setSaved(false);
    const result: ActionResult = await changePasswordAction(values);
    if (result.ok) {
      setSaved(true);
      form.reset(passwordFormDefaults);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    if (result.formError || !result.fieldErrors) {
      setFormError(result.formError ?? 'Something went wrong. Please try again.');
    }
  });

  return (
    <Card className="p-6">
      <h2 className="font-display text-base font-semibold tracking-tight text-ink">
        Change password
      </h2>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <TextField
            control={form.control}
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
            />
          </div>

          {formError ? <FormError>{formError}</FormError> : null}

          <div className="flex items-center gap-4">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
            {saved ? <SavedNote /> : null}
          </div>
        </form>
      </Form>
    </Card>
  );
}

export function SettingsForms({ user }: { user: AuthUser }) {
  return (
    <div className="flex flex-col gap-6">
      <AccountDetailsForm user={user} />
      <ChangePasswordForm />
    </div>
  );
}
