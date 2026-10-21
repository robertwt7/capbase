'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MfaMethod } from '@repo/api';

import { SecondFactorStep } from '../../../components/auth/SecondFactorStep';
import { Button, Card, FormError, Input, Label } from '../../../components/ui';
import { RATE_LIMITED_MESSAGE } from '../../../lib/rate-limit';

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // After the password: the second step (`methods`), or forced setup for an account with none.
  const [methods, setMethods] = useState<MfaMethod[] | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const done = () => {
    router.replace('/admin');
    router.refresh();
  };

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
    const data = (await res.json().catch(() => ({}))) as {
      status?: 'ok' | 'mfa' | 'mfa_setup';
      methods?: MfaMethod[];
      message?: string;
    };

    if (res.ok && data.status === 'mfa') {
      setMethods(data.methods ?? []);
      setPending(false);
    } else if (res.ok && data.status === 'mfa_setup') {
      setNeedsSetup(true);
      setPending(false);
    } else if (res.ok) {
      done();
    } else {
      setError(res.status === 429 ? (data.message ?? RATE_LIMITED_MESSAGE) : (data.message ?? 'Sign in failed'));
      setPending(false);
    }
  }

  const restart = () => {
    setMethods(null);
    setNeedsSetup(false);
  };

  return (
    <div className="flex items-center justify-center px-(--page-pad) py-20">
      <Card className="w-full max-w-[360px]">
        {methods ? (
          <div className="flex flex-col gap-3.5 p-8">
            <SecondFactorStep methods={methods} admin onSuccess={done} onRestart={restart} />
          </div>
        ) : needsSetup ? (
          <div className="flex flex-col gap-3.5 p-8">
            <h1 className="font-display text-[22px] font-bold text-ink">Set up two-factor first</h1>
            <p className="text-[13px] leading-relaxed text-graphite-500">
              Admin accounts need a second step after the password. Add a passkey or an
              authenticator app to finish signing in.
            </p>
            <Button variant="primary" block href="/login/setup-2fa?next=/admin">
              Set up two-factor authentication
            </Button>
            <Link
              href="/admin/login"
              onClick={restart}
              className="self-start text-[13px] text-graphite-500 underline underline-offset-[3px] hover:text-ink"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-3.5 p-8" onSubmit={onSubmit}>
            <h1 className="font-display text-[22px] font-bold text-ink">Admin sign in</h1>
            <p className="mb-2 text-[13px] text-graphite-500">Review and approve crowdsourced submissions.</p>

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
        )}
      </Card>
    </div>
  );
}
