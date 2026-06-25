'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
      <form className={styles.card} onSubmit={onSubmit}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.sub}>Contribute company and funding data to unlock full profiles.</p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Email</span>
          <input className={styles.input} type="email" name="email" autoComplete="username" required />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Password</span>
          <input
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p className={styles.error}>{error}</p> : null}

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

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
    </main>
  );
}
