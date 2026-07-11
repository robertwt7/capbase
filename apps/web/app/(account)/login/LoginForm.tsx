'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  loginFormDefaults,
  loginFormSchema,
  toLoginInput,
  type LoginFormValues,
} from '@/lib/validation/auth';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: loginFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toLoginInput(values)),
    });
    if (res.ok) {
      router.replace(next || '/');
      router.refresh();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    setFormError(data.message ?? 'Invalid email or password.');
  });

  return (
    <main className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
            <h1 className="font-display text-[22px] font-bold text-ink">Sign in</h1>
            <p className="mb-2 font-sans text-[13px] text-graphite-500">
              Contribute company and funding data to unlock full profiles.
            </p>

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
              autoComplete="current-password"
            />

            {formError ? <FormError>{formError}</FormError> : null}

            <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
              New here?{' '}
              <Link
                className="font-semibold text-ink underline"
                href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
              >
                Create an account
              </Link>
            </p>
          </form>
        </Form>
      </Card>
    </main>
  );
}
