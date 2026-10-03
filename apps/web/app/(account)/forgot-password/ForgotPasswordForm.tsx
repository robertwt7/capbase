'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  forgotPasswordFormDefaults,
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from '@/lib/validation/auth';
import { applyServerErrors } from '@/lib/validation/utils';

import { forgotPasswordAction } from './actions';

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string>();
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: forgotPasswordFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await forgotPasswordAction(values);
    if (result.ok) {
      setSent(true);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError);
  });

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        {sent ? (
          <div className="flex flex-col gap-3.5 p-8" role="status">
            <h1 className="font-display text-[22px] font-bold text-ink">Check your email</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              If an account exists for{' '}
              <span className="font-medium text-ink">{form.getValues('email')}</span>, a link to
              reset its password is on the way. It works once, for one hour.
            </p>
            <Button variant="outline" block href="/login">
              Back to sign in
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
              <h1 className="font-display text-[22px] font-bold text-ink">Reset your password</h1>
              <p className="mb-2 font-sans text-[13px] text-graphite-500">
                Enter the email you signed up with and we&apos;ll send you a reset link.
              </p>

              <TextField
                control={form.control}
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
              />

              {formError ? <FormError>{formError}</FormError> : null}

              <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>

              <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
                Remembered it?{' '}
                <Link className="font-semibold text-ink underline" href="/login">
                  Sign in
                </Link>
              </p>
            </form>
          </Form>
        )}
      </Card>
    </div>
  );
}
