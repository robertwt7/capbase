'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
      <form className={styles.loginCard} onSubmit={onSubmit}>
        <h1 className={styles.loginTitle}>Admin sign in</h1>
        <p className={styles.loginSub}>Review and approve crowdsourced submissions.</p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Email</span>
          <input
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            required
          />
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
      </form>
    </main>
  );
}
