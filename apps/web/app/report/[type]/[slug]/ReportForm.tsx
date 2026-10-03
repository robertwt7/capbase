'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { REPORT_REASONS, type ReportableType } from '@repo/api';

import {
  Button,
  Card,
  Form,
  FormError,
  SelectField,
  SelectItem,
  TextareaField,
  TextField,
  TurnstileField,
} from '@/components/ui';
import { applyServerErrors } from '@/lib/validation/utils';
import {
  reportFormDefaults,
  reportFormSchema,
  type ReportFormValues,
} from '@/lib/validation/report';

import { reportAction } from './actions';

export function ReportForm({
  type,
  slug,
  profileHref,
  name,
  turnstileSiteKey,
}: {
  type: ReportableType;
  slug: string;
  profileHref: string;
  name: string;
  /** Cloudflare Turnstile site key; unset → no challenge. */
  turnstileSiteKey?: string;
}) {
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: reportFormDefaults,
    mode: 'onBlur',
  });
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after every attempt: a Turnstile token is single-use.
  const [challenge, setChallenge] = useState(0);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await reportAction(type, slug, values, turnstileToken);
    setTurnstileToken(null);
    setChallenge((n) => n + 1);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    if (result.fieldErrors)
      applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? 'Something went wrong. Please try again.');
  });

  if (submitted) {
    return (
      <Card emphasis className="p-6">
        <p className="font-display text-lg font-bold tracking-tight text-ink">
          Report received
        </p>
        <p className="mt-2 text-sm text-graphite-500">
          Thanks — an admin will review it. Our{' '}
          <Link
            href="/takedown"
            className="text-ink underline underline-offset-[3px]"
          >
            takedown policy
          </Link>{' '}
          explains what happens next and how long it takes.
        </p>
        <div className="mt-5">
          <Button variant="primary" shape="pill" size="sm" href={profileHref}>
            Back to {name}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <SelectField
            control={form.control}
            name="reason"
            label="What's the problem?"
            placeholder="Choose a reason"
          >
            {REPORT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectField>
          <TextareaField
            control={form.control}
            name="message"
            label="Details"
            rows={6}
            placeholder="Which fact is wrong, what it should say, and a link that shows it if you have one."
          />
          <TextField
            control={form.control}
            name="email"
            label="Your email (optional)"
            type="email"
            autoComplete="email"
            description="Only used to follow up on this report."
          />

          <TurnstileField
            key={challenge}
            siteKey={turnstileSiteKey}
            onToken={setTurnstileToken}
          />

          {formError ? <FormError>{formError}</FormError> : null}

          <div>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
