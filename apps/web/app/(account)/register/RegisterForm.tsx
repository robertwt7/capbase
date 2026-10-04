'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { LogoMark } from '@/components/Logo';
import { Button, Card, Form, FormError, TextField, TurnstileField } from '@/components/ui';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import {
  registerFormDefaults,
  registerFormSchema,
  toRegisterInput,
  type RegisterFormValues,
} from '@/lib/validation/auth';

export function RegisterForm({
  next,
  turnstileSiteKey,
}: {
  next?: string;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after every attempt: a Turnstile token is single-use.
  const [challenge, setChallenge] = useState(0);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: registerFormDefaults,
    // onTouched, not onBlur: once a field is touched it revalidates on every
    // keystroke, so a fixed "passwords do not match" clears before the click.
    // Otherwise the click's own blur removes the message, the button jumps,
    // and the first click lands on empty space.
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...toRegisterInput(values), turnstileToken }),
    });
    setTurnstileToken(null);
    setChallenge((n) => n + 1);
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
    // nginx's 429 is an HTML page, so it has no message to show.
    setFormError(
      res.status === 429
        ? RATE_LIMITED_MESSAGE
        : (data.message ?? 'Registration failed. Please try again.'),
    );
  });

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
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

            <TurnstileField
              key={challenge}
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
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
    </div>
  );
}
