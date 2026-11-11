'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CLAIM_NOTE_MIN } from '@repo/api';
import { useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';

import {
  AttestationField,
  Button,
  Card,
  Form,
  FormError,
  TextareaField,
  TextField,
  TurnstileField,
} from '@/components/ui';
import {
  claimEmailFormDefaults,
  claimEmailFormSchema,
  claimRequestFormDefaults,
  claimRequestFormSchema,
  type ClaimEmailFormValues,
  type ClaimRequestFormValues,
} from '@/lib/validation/claim';
import { applyServerErrors, type ActionResult } from '@/lib/validation/utils';

import { sendClaimRequestAction, startEmailClaimAction } from './actions';

type ClaimFormProps = {
  slug: string;
  companyName: string;
  /** Cloudflare Turnstile site key; unset → no challenge. */
  turnstileSiteKey?: string;
};

const AUTHORISED_LABEL = 'I am authorised to represent this company.';

/** Submit plumbing shared by both claim forms: Turnstile (remounted after every attempt —
 *  a token is single-use), the form-level error, and the success panel. */
function ClaimShell<T extends FieldValues>({
  form,
  action,
  submitLabel,
  success,
  turnstileSiteKey,
  children,
}: {
  form: UseFormReturn<T>;
  action: (values: T, turnstileToken: string | null) => Promise<ActionResult>;
  submitLabel: string;
  success: (values: T) => ReactNode;
  turnstileSiteKey?: string;
  children: ReactNode;
}) {
  const [done, setDone] = useState<T | null>(null);
  const [formError, setFormError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await action(values, turnstileToken);
    setTurnstileToken(null);
    setChallenge((n) => n + 1);
    if (result.ok) {
      setDone(values);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? 'Something went wrong. Please try again.');
  });

  if (done) {
    return (
      <Card emphasis className="p-6" role="status">
        {success(done)}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {children}
          <TurnstileField key={challenge} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
          {formError ? <FormError>{formError}</FormError> : null}
          <div>
            <Button variant="primary" size="sm" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending…' : submitLabel}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}

/** Prove a work address at the company's domain: we mail it a single-use link. */
export function ClaimEmailForm({ slug, companyName, turnstileSiteKey }: ClaimFormProps) {
  const form = useForm<ClaimEmailFormValues>({
    resolver: zodResolver(claimEmailFormSchema),
    defaultValues: claimEmailFormDefaults,
    mode: 'onBlur',
  });
  return (
    <ClaimShell
      form={form}
      action={(values, token) => startEmailClaimAction(slug, values, token)}
      turnstileSiteKey={turnstileSiteKey}
      submitLabel="Send the link"
      success={(values) => (
        <>
          <p className="font-display text-lg font-bold tracking-tight text-ink">Check that inbox</p>
          <p className="mt-2 text-sm text-graphite-500">
            We sent a link to <span className="font-semibold text-ink">{values.email}</span>. Open
            it and press the button on the page to finish claiming {companyName}. It works once and
            expires in 24 hours.
          </p>
        </>
      )}
    >
      <TextField
        control={form.control}
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        placeholder="you@yourcompany.com"
        description="An address at the company's own domain. We never show it on the profile."
      />
      <AttestationField control={form.control} name="authorised" label={AUTHORISED_LABEL} />
    </ClaimShell>
  );
}

/** No address at the company's domain: a note and an evidence link a moderator reviews. */
export function ClaimRequestForm({ slug, companyName, turnstileSiteKey }: ClaimFormProps) {
  const form = useForm<ClaimRequestFormValues>({
    resolver: zodResolver(claimRequestFormSchema),
    defaultValues: claimRequestFormDefaults,
    mode: 'onBlur',
  });
  return (
    <ClaimShell
      form={form}
      action={(values, token) => sendClaimRequestAction(slug, values, token)}
      turnstileSiteKey={turnstileSiteKey}
      submitLabel="Send for review"
      success={() => (
        <>
          <p className="font-display text-lg font-bold tracking-tight text-ink">
            Request sent for review
          </p>
          <p className="mt-2 text-sm text-graphite-500">
            A moderator will look at your request to represent {companyName}. We&apos;ll email you
            when it&apos;s decided; until then it shows as awaiting review on your profile.
          </p>
        </>
      )}
    >
      <TextareaField
        control={form.control}
        name="note"
        label="How are you connected to the company?"
        rows={5}
        description={`Your role, and anything that helps a moderator check it (at least ${CLAIM_NOTE_MIN} characters). Never published.`}
      />
      <TextField
        control={form.control}
        name="evidenceUrl"
        label="Evidence link (optional)"
        type="url"
        inputMode="url"
        placeholder="https://"
        description="A page that names you at the company — a team page, a filing, a press release."
      />
      <AttestationField control={form.control} name="authorised" label={AUTHORISED_LABEL} />
    </ClaimShell>
  );
}
