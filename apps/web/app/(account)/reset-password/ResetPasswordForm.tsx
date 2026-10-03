'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { LogoMark } from '@/components/Logo';
import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  resetPasswordFormDefaults,
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from '@/lib/validation/auth';
import { applyServerErrors } from '@/lib/validation/utils';

import { resetPasswordAction } from './actions';

export function ResetPasswordForm({ token }: { token: string }) {
  const [formError, setFormError] = useState<string>();
  const [done, setDone] = useState(false);
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: resetPasswordFormDefaults,
    // onTouched, not onBlur: once a field is touched it revalidates on every
    // keystroke, so a fixed "passwords do not match" clears before the click.
    // Otherwise the click's own blur removes the message, the button jumps,
    // and the first click lands on empty space.
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await resetPasswordAction(token, values);
    if (result.ok) {
      setDone(true);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError);
  });

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        {done ? (
          <div className="flex flex-col gap-3.5 p-8" role="status">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <h1 className="font-display text-[22px] font-bold text-ink">Password updated</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              You&apos;re signed out everywhere. Sign in with your new password.
            </p>
            <Button variant="primary" block href="/login">
              Sign in
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
              <LogoMark className="mb-1 h-7 self-start text-ink" />
              <h1 className="font-display text-[22px] font-bold text-ink">Choose a new password</h1>

              <TextField
                control={form.control}
                name="password"
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

              {formError ? <FormError>{formError}</FormError> : null}

              <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Set new password'}
              </Button>

              <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
                Link expired?{' '}
                <Link className="font-semibold text-ink underline" href="/forgot-password">
                  Send a new one
                </Link>
              </p>
            </form>
          </Form>
        )}
      </Card>
    </div>
  );
}
