'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { COMPANY_STATUSES, SECTORS, STAGES } from '@repo/api';

import {
  Button,
  Card,
  Eyebrow,
  Form,
  FormError,
  SelectField,
  SelectItem,
  TextareaField,
  TextField,
} from '@/components/ui';
import { CITIES } from '@/lib/cities';
import {
  companyFormDefaults,
  companyFormSchema,
  type CompanyFormValues,
} from '@/lib/validation/company';
import { applyServerErrors } from '@/lib/validation/utils';

import { createCompanyAction } from './actions';

export function CompanyForm() {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: companyFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await createCompanyAction(values);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? 'Something went wrong. Please try again.');
  });

  if (submitted) {
    return (
      <main className="mx-auto w-full max-w-2xl px-(--page-pad) pt-12 pb-20">
        <Card emphasis className="p-9">
          <Eyebrow>Submitted</Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
            Pending review
          </h1>
          <p className="mt-3 max-w-prose text-sm text-graphite-500">
            Thanks for contributing. Your company is now in the moderation queue — it goes live once
            an admin approves it. Contributing has unlocked full company profiles for you.
          </p>
          <div className="mt-6 flex items-center gap-4">
            <Button variant="primary" shape="pill" href="/profile">
              View your contributions
            </Button>
            <Button variant="ghost" href="/">
              Back to companies
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-(--page-pad) pt-12 pb-20">
      <header className="mb-8">
        <Eyebrow>Contribute</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
          Add a company
        </h1>
        <p className="mt-2 text-sm text-graphite-500">
          Submit a private company to the open database. Every submission is reviewed before it goes
          live.
        </p>
      </header>

      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <TextField control={form.control} name="name" label="Company name" autoComplete="off" />
          <TextField
            control={form.control}
            name="domain"
            label="Website domain"
            placeholder="acme.com"
            autoComplete="off"
          />
          <TextField control={form.control} name="oneLiner" label="One-liner" />
          <TextareaField control={form.control} name="description" label="Description" rows={4} />

          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="hq"
              label="Headquarters"
              list="hq-cities"
              placeholder="San Francisco, CA"
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="founded"
              label="Founded (year)"
              inputMode="numeric"
              placeholder="2019"
            />
          </div>
          <datalist id="hq-cities">
            {CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="headcount"
              label="Headcount"
              inputMode="numeric"
            />
            <TextField
              control={form.control}
              name="totalRaisedUsd"
              label="Total raised (USD)"
              inputMode="numeric"
            />
          </div>

          <SelectField
            control={form.control}
            name="primarySector"
            label="Primary sector"
            placeholder="Select a sector…"
          >
            {SECTORS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectField>

          <TextField
            control={form.control}
            name="industry"
            label="Industries"
            placeholder="Fintech, Payments, Infrastructure"
            description="Comma-separated tags."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="status" label="Status">
              {COMPANY_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectField>
            <SelectField control={form.control} name="stage" label="Stage">
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectField>
          </div>

          <TextField
            control={form.control}
            name="lastValuationUsd"
            label="Last valuation (USD, optional)"
            inputMode="numeric"
          />

          {formError ? <FormError>{formError}</FormError> : null}

          <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Submitting…' : 'Submit for review'}
          </Button>
        </form>
      </Form>
    </main>
  );
}
