'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { MfaMethod } from '@repo/api';

import { SecondFactorStep } from '@/components/auth/SecondFactorStep';
import { LogoMark } from '@/components/Logo';
import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import {
  loginFormDefaults,
  loginFormSchema,
  toLoginInput,
  type LoginFormValues,
} from '@/lib/validation/auth';
import { isPasskeyCancel, passkeyErrorMessage } from '@/lib/webauthn';

type LoginStatus = { status?: 'ok' | 'mfa' | 'mfa_setup'; methods?: MfaMethod[]; message?: string };

/**
 * Run a passwordless passkey sign-in: options from the API (challenge kept in an httpOnly
 * cookie), the browser ceremony, then the assertion back. With `autofill`, the ceremony waits
 * for the user to pick a passkey from the email field's suggestions. Resolves to an error
 * message, or null once signed in; throws when the user cancels or the ceremony is aborted.
 */
async function passkeySignIn(autofill: boolean): Promise<string | null> {
  const optionsRes = await fetch('/api/auth/passkey/options', { method: 'POST' });
  if (!optionsRes.ok) {
    return optionsRes.status === 429 ? RATE_LIMITED_MESSAGE : 'Couldn’t start the passkey sign-in.';
  }
  const { options } = (await optionsRes.json()) as { options: PublicKeyCredentialRequestOptionsJSON };
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  const res = await fetch('/api/auth/passkey/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return res.status === 429 ? RATE_LIMITED_MESSAGE : (data.message ?? 'That passkey couldn’t be verified.');
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const [methods, setMethods] = useState<MfaMethod[] | null>(null);
  const [passkeys, setPasskeys] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: loginFormDefaults,
    mode: 'onBlur',
  });

  const done = useCallback(() => {
    router.replace(next || '/');
    router.refresh();
  }, [next, router]);

  // Passkey autofill: offer this site's passkeys in the email field's suggestions. Runs while
  // the password form is showing; leaving it (or unmounting) aborts the pending ceremony.
  useEffect(() => {
    setPasskeys(browserSupportsWebAuthn());
    if (methods) return;
    let active = true;
    void (async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !active) return;
      try {
        const error = await passkeySignIn(true);
        if (!active) return;
        if (error) setFormError(error);
        else done();
      } catch {
        // Aborted (another ceremony started, or the form went away) or nothing picked.
      }
    })();
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [methods, done]);

  const signInWithPasskey = async () => {
    setFormError(undefined);
    setPasskeyBusy(true);
    try {
      const error = await passkeySignIn(false);
      if (error) setFormError(error);
      else done();
    } catch (error) {
      if (!isPasskeyCancel(error)) setFormError(passkeyErrorMessage(error));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toLoginInput(values)),
    });
    const data = (await res.json().catch(() => ({}))) as LoginStatus;
    if (res.ok) {
      if (data.status === 'mfa') {
        setMethods(data.methods ?? []);
        return;
      }
      if (data.status === 'mfa_setup') {
        const query = next ? `?next=${encodeURIComponent(next)}` : '';
        router.replace(`/login/setup-2fa${query}`);
        return;
      }
      done();
      return;
    }
    if (res.status === 429) {
      setFormError(data.message ?? RATE_LIMITED_MESSAGE);
      return;
    }
    setFormError(data.message ?? 'Invalid email or password.');
  });

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        {methods ? (
          <div className="flex flex-col gap-3.5 p-8">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <SecondFactorStep
              methods={methods}
              onSuccess={done}
              onRestart={() => {
                setMethods(null);
                form.resetField('password');
              }}
            />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
              <LogoMark className="mb-1 h-7 self-start text-ink" />
              <h1 className="font-display text-[22px] font-bold text-ink">Sign in</h1>
              <p className="mb-2 font-sans text-[13px] text-graphite-500">
                Contribute company and funding data to unlock full profiles.
              </p>

              {passkeys ? (
                <>
                  <Button
                    variant="outline"
                    block
                    onClick={signInWithPasskey}
                    disabled={passkeyBusy}
                  >
                    {passkeyBusy ? 'Waiting for your device…' : 'Sign in with a passkey'}
                  </Button>
                  <p
                    aria-hidden
                    className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite-500 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
                  >
                    or
                  </p>
                </>
              ) : null}

              <TextField
                control={form.control}
                name="email"
                label="Email"
                type="email"
                autoComplete="username webauthn"
              />
              <TextField
                control={form.control}
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
              />
              <Link
                href="/forgot-password"
                className="-mt-1.5 self-end font-sans text-[13px] text-graphite-500 underline underline-offset-[3px] hover:text-ink"
              >
                Forgot password?
              </Link>

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
        )}
      </Card>
    </div>
  );
}
