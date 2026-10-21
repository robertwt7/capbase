'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormSetError } from 'react-hook-form';
import { RECOVERY_CODE_COUNT, type MfaStatus, type PasskeySummary, type TotpSetup } from '@repo/api';

import { TotpEnrollStep } from '@/components/auth/TotpEnrollStep';
import { RecoveryCodesPanel } from '@/components/RecoveryCodesPanel';
import { Badge, Button, Card, Form, FormError, TextField } from '@/components/ui';
import { formatDate } from '@/lib/format';
import {
  passkeyFormDefaults,
  passkeyFormSchema,
  passwordConfirmDefaults,
  passwordConfirmSchema,
  type PasskeyFormValues,
  type PasswordConfirmValues,
} from '@/lib/validation/mfa';
import { applyServerErrors, type ActionResult } from '@/lib/validation/utils';
import { isPasskeyCancel, passkeyErrorMessage } from '@/lib/webauthn';

import {
  beginTotpAction,
  confirmTotpAction,
  disableTotpAction,
  passkeyOptionsAction,
  regenerateRecoveryCodesAction,
  registerPasskeyAction,
  removePasskeyAction,
} from './actions';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** Report a failed ActionResult into a form: field errors inline, the rest as a form error. */
function reportFailure<T extends FieldValues>(
  result: Extract<ActionResult, { ok: false }>,
  setError: UseFormSetError<T>,
  setFormError: (message: string) => void,
) {
  if (result.fieldErrors) applyServerErrors(setError, result.fieldErrors);
  if (result.formError || !result.fieldErrors) setFormError(result.formError ?? GENERIC_ERROR);
}

/** A card in the settings style: a heading, an optional state badge, a line of help. */
function SecurityCard({
  title,
  badge,
  description,
  children,
}: {
  title: string;
  badge?: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">{title}</h3>
        {badge}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-graphite-500">{description}</p>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </Card>
  );
}

const OnBadge = () => (
  <Badge variant="box" mono className="border-ink text-ink">
    On
  </Badge>
);

/**
 * The inline password step every security change starts with (no modal): one field, a
 * confirm button, and Cancel. `onConfirm` runs the server action.
 */
function PasswordConfirmForm({
  submitLabel,
  pendingLabel,
  onConfirm,
  onCancel,
  extra,
}: {
  submitLabel: string;
  pendingLabel: string;
  onConfirm: (values: PasswordConfirmValues) => Promise<ActionResult>;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const form = useForm<PasswordConfirmValues>({
    resolver: zodResolver(passwordConfirmSchema),
    defaultValues: passwordConfirmDefaults,
  });
  const [formError, setFormError] = useState<string>();

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await onConfirm(values);
    if (!result.ok) reportFailure(result, form.setError, setFormError);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          control={form.control}
          name="password"
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
          autoFocus
        />
        {extra}
        {formError ? <FormError>{formError}</FormError> : null}
        <div className="flex items-center gap-4">
          <Button variant="primary" size="sm" type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? pendingLabel : submitLabel}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** Shown after a change that produced recovery codes, until the user says they saved them. */
function CodesReveal({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <RecoveryCodesPanel codes={codes} />
      <div>
        <Button variant="primary" size="sm" onClick={onDone}>
          I’ve saved them
        </Button>
      </div>
    </div>
  );
}

function AuthenticatorCard({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'remove' | 'codes'>('idle');
  const [setup, setSetup] = useState<TotpSetup>();
  const [codes, setCodes] = useState<string[]>([]);
  const lastFactor = status.required && status.passkeys.length === 0;

  const finish = () => {
    setStep('idle');
    setSetup(undefined);
    setCodes([]);
    router.refresh();
  };

  return (
    <SecurityCard
      title="Authenticator app"
      badge={status.totpEnabled ? <OnBadge /> : null}
      description="A 6-digit code from an app on your phone, asked for after your password."
    >
      {step === 'codes' ? (
        <CodesReveal codes={codes} onDone={finish} />
      ) : step === 'password' ? (
        <PasswordConfirmForm
          submitLabel="Continue"
          pendingLabel="Checking…"
          onCancel={() => setStep('idle')}
          onConfirm={async (values) => {
            const result = await beginTotpAction(values);
            if (result.ok) {
              setSetup(result.setup);
              setStep('scan');
            }
            return result;
          }}
        />
      ) : step === 'scan' && setup ? (
        <TotpEnrollStep
          setup={setup}
          onCancel={() => setStep('idle')}
          onConfirm={async (values) => {
            const result = await confirmTotpAction(setup.challenge, values);
            if (result.ok) {
              if (result.recoveryCodes.length > 0) {
                setCodes(result.recoveryCodes);
                setStep('codes');
              } else {
                finish();
              }
            }
            return result;
          }}
        />
      ) : step === 'remove' ? (
        <PasswordConfirmForm
          submitLabel="Remove authenticator app"
          pendingLabel="Removing…"
          onCancel={() => setStep('idle')}
          onConfirm={async (values) => {
            const result = await disableTotpAction(values);
            if (result.ok) finish();
            return result;
          }}
        />
      ) : status.totpEnabled ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep('remove')}
              disabled={lastFactor}
            >
              Remove
            </Button>
          </div>
          {lastFactor ? (
            <p className="text-[13px] text-graphite-500">
              Your role requires two-factor authentication. Add a passkey before removing this.
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <Button variant="primary" size="sm" onClick={() => setStep('password')}>
            Set up
          </Button>
        </div>
      )}
    </SecurityCard>
  );
}

function PasskeyRow({
  passkey,
  isLastFactor,
  onRemoved,
}: {
  passkey: PasskeySummary;
  isLastFactor: boolean;
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <li className="flex flex-col gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink">{passkey.name}</span>
            <Badge variant="box" mono>
              {passkey.deviceType === 'multiDevice' ? 'Synced' : 'This device'}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-[12px] text-graphite-500">
            Added {formatDate(passkey.createdAt)} ·{' '}
            {passkey.lastUsedAt ? `last used ${formatDate(passkey.lastUsedAt)}` : 'never used'}
          </p>
        </div>
        {!removing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRemoving(true)}
            disabled={isLastFactor}
            title={isLastFactor ? 'Your role requires a second factor. Add another first.' : undefined}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {removing ? (
        <PasswordConfirmForm
          submitLabel={`Remove “${passkey.name}”`}
          pendingLabel="Removing…"
          onCancel={() => setRemoving(false)}
          onConfirm={async (values) => {
            const result = await removePasskeyAction(passkey.id, values);
            if (result.ok) onRemoved();
            return result;
          }}
        />
      ) : null}
    </li>
  );
}

function AddPasskeyForm({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: (codes: string[]) => void;
}) {
  const form = useForm<PasskeyFormValues>({
    resolver: zodResolver(passkeyFormSchema),
    defaultValues: passkeyFormDefaults,
  });
  const [formError, setFormError] = useState<string>();

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const options = await passkeyOptionsAction(values);
    if (!options.ok) {
      reportFailure(options, form.setError, setFormError);
      return;
    }
    let response;
    try {
      response = await startRegistration({
        optionsJSON: options.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
    } catch (error) {
      // Cancelling the browser sheet is a choice, not a failure: say so quietly.
      setFormError(isPasskeyCancel(error) ? 'Passkey not added.' : passkeyErrorMessage(error));
      return;
    }
    const result = await registerPasskeyAction({
      challenge: options.challenge,
      response: response as unknown as Record<string, unknown>,
      name: options.name,
    });
    if (!result.ok) {
      reportFailure(result, form.setError, setFormError);
      return;
    }
    onAdded(result.recoveryCodes);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          control={form.control}
          name="name"
          label="Name"
          description="To tell your passkeys apart, like “Work laptop” or “iPhone”."
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="password"
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
        />
        {formError ? <FormError>{formError}</FormError> : null}
        <div className="flex items-center gap-4">
          <Button variant="primary" size="sm" type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Waiting for your device…' : 'Add passkey'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}

function PasskeysCard({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [step, setStep] = useState<'idle' | 'add' | 'codes'>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  // Read after mount: the server render can't know the browser.
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  const onlyFactor = status.required && !status.totpEnabled && status.passkeys.length === 1;
  const finish = () => {
    setStep('idle');
    setCodes([]);
    router.refresh();
  };

  return (
    <SecurityCard
      title="Passkeys"
      badge={status.passkeys.length > 0 ? <OnBadge /> : null}
      description="Sign in with your fingerprint, face or device PIN — no password needed. A passkey also works as your second step after a password."
    >
      {status.passkeys.length > 0 ? (
        <ul className="flex flex-col">
          {status.passkeys.map((p) => (
            <PasskeyRow key={p.id} passkey={p} isLastFactor={onlyFactor} onRemoved={finish} />
          ))}
        </ul>
      ) : null}
      {step === 'codes' ? (
        <CodesReveal codes={codes} onDone={finish} />
      ) : step === 'add' ? (
        <AddPasskeyForm
          onCancel={() => setStep('idle')}
          onAdded={(fresh) => {
            if (fresh.length > 0) {
              setCodes(fresh);
              setStep('codes');
            } else {
              finish();
            }
          }}
        />
      ) : supported === false ? (
        <p className="text-[13px] text-graphite-500">
          This browser doesn’t support passkeys. Try a recent Chrome, Safari, Edge or Firefox.
        </p>
      ) : (
        <div>
          <Button
            variant={status.passkeys.length > 0 ? 'outline' : 'primary'}
            size="sm"
            onClick={() => setStep('add')}
            disabled={supported === null}
          >
            Add a passkey
          </Button>
        </div>
      )}
    </SecurityCard>
  );
}

function RecoveryCodesCard({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'password' | 'codes'>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  const remaining = status.recoveryCodesRemaining;

  return (
    <SecurityCard
      title="Recovery codes"
      description="One-time codes for when you can’t use your phone or passkey. Each works once."
    >
      <p className="font-mono text-[13px] text-ink">
        {remaining} of {RECOVERY_CODE_COUNT} remaining
      </p>
      {step === 'codes' ? (
        <CodesReveal
          codes={codes}
          onDone={() => {
            setStep('idle');
            setCodes([]);
            router.refresh();
          }}
        />
      ) : step === 'password' ? (
        <PasswordConfirmForm
          submitLabel="Generate new codes"
          pendingLabel="Generating…"
          onCancel={() => setStep('idle')}
          extra={
            <p className="text-[13px] text-graphite-500">Your current codes will stop working.</p>
          }
          onConfirm={async (values) => {
            const result = await regenerateRecoveryCodesAction(values);
            if (result.ok) {
              setCodes(result.recoveryCodes);
              setStep('codes');
            }
            return result;
          }}
        />
      ) : (
        <div>
          <Button
            variant={remaining <= 3 ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setStep('password')}
          >
            Generate new codes
          </Button>
        </div>
      )}
    </SecurityCard>
  );
}

/** Account settings → Security: authenticator app, passkeys, recovery codes. */
export function SecuritySection({ status }: { status: MfaStatus }) {
  const enabled = status.totpEnabled || status.passkeys.length > 0;
  return (
    <section aria-labelledby="security-heading" className="flex flex-col gap-6">
      <div>
        <h2
          id="security-heading"
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          Security
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-graphite-500">
          {status.required && !enabled
            ? 'Your account can publish data, so it needs two-factor authentication.'
            : 'Two-factor authentication asks for a second step after your password. Every change here is emailed to you.'}
        </p>
      </div>
      <PasskeysCard status={status} />
      <AuthenticatorCard status={status} />
      {enabled ? <RecoveryCodesCard status={status} /> : null}
    </section>
  );
}
