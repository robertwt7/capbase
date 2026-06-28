'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, FormError, Input, Label } from '../../../components/ui';

import styles from '../account.module.css';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });

    if (res.ok) {
      router.replace(next || '/');
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? 'Sign in failed');
      setPending(false);
    }
  }

  return (
    <main className={styles.main}>
      <Card className={styles.card}>
        <form className={styles.cardForm} onSubmit={onSubmit}>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.sub}>Contribute company and funding data to unlock full profiles.</p>

          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" name="email" autoComplete="username" required />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? <FormError>{error}</FormError> : null}

          <Button variant="primary" block type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className={styles.altLine}>
            New here?{' '}
            <Link
              className={styles.altLink}
              href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
            >
              Create an account
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
