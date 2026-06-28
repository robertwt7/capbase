'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, Field, FormError, Input } from '../../../components/ui';

import styles from '../account.module.css';

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
      }),
    });

    if (res.ok) {
      router.replace(next || '/');
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? 'Registration failed');
      setPending(false);
    }
  }

  return (
    <main className={styles.main}>
      <Card className={styles.card}>
        <form className={styles.cardForm} onSubmit={onSubmit}>
          <h1 className={styles.title}>Create your account</h1>
          <p className={styles.sub}>Join the open company database and start contributing.</p>

          <Field label="Name">
            <Input type="text" name="name" autoComplete="name" required />
          </Field>

          <Field label="Email">
            <Input type="email" name="email" autoComplete="username" required />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>

          {error ? <FormError>{error}</FormError> : null}

          <Button variant="primary" block type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </Button>

          <p className={styles.altLine}>
            Already have an account?{' '}
            <Link
              className={styles.altLink}
              href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            >
              Sign in
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
