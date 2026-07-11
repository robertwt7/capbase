'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  registerFormDefaults,
  registerFormSchema,
  toRegisterInput,
  type RegisterFormValues,
} from '@/lib/validation/auth';

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: registerFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toRegisterInput(values)),
    });
    if (res.ok) {
      router.replace(next || '/');
      router.refresh();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 409) {
      form.setError('email', {
        type: 'server',
        message: data.message ?? 'Email already registered.',
      });
      return;
    }
    setFormError(data.message ?? 'Registration failed. Please try again.');
  });

  return (
    <main className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
            <h1 className="font-display text-[22px] font-bold text-ink">Create your account</h1>
            <p className="mb-2 font-sans text-[13px] text-graphite-500">
              Join the open company database and start contributing.
            </p>

            <TextField control={form.control} name="name" label="Name" autoComplete="name" />
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
            />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
            />

            {formError ? <FormError>{formError}</FormError> : null}

            <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating…' : 'Create account'}
            </Button>

            <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
              Already have an account?{' '}
              <Link
                className="font-semibold text-ink underline"
                href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
              >
                Sign in
              </Link>
            </p>
          </form>
        </Form>
      </Card>
    </main>
  );
}
