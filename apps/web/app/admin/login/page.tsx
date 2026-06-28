'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, FormError, Input, Label } from '../../../components/ui';

import styles from '../admin.module.css';

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
      }),
    });

    if (res.ok) {
      router.replace('/admin');
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? 'Sign in failed');
      setPending(false);
    }
  }

  return (
    <main className={styles.loginMain}>
      <Card className={styles.loginCard}>
        <form className={styles.loginForm} onSubmit={onSubmit}>
          <h1 className={styles.loginTitle}>Admin sign in</h1>
          <p className={styles.loginSub}>Review and approve crowdsourced submissions.</p>

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
        </form>
      </Card>
    </main>
  );
}
