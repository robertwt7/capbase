'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { EXIT_TYPES, INVESTOR_TYPES } from '@repo/api';

import {
  Button,
  Card,
  Form,
  FormError,
  SelectField,
  SelectItem,
  SourceUrlField,
  TextareaField,
  TextField,
} from '@/components/ui';
import {
  acquisitionFormDefaults,
  acquisitionFormSchema,
  type AcquisitionFormValues,
} from '@/lib/validation/acquisition';
import {
  diversityFormDefaults,
  diversityFormSchema,
  type DiversityFormValues,
} from '@/lib/validation/diversity';
import { exitFormDefaults, exitFormSchema, type ExitFormValues } from '@/lib/validation/exit';
import {
  investorFormDefaults,
  investorFormSchema,
  type InvestorFormValues,
} from '@/lib/validation/investor';
import {
  personFormDefaults,
  personFormSchema,
  type PersonFormValues,
} from '@/lib/validation/person';
import { roundFormDefaults, roundFormSchema, type RoundFormValues } from '@/lib/validation/round';
import { applyServerErrors, type ActionResult } from '@/lib/validation/utils';

import {
  addAcquisitionAction,
  addDiversityAction,
  addExitAction,
  addInvestorAction,
  addPersonAction,
  addRoundAction,
} from './actions';

export type ContributionFormProps = { slug: string; companyName: string };

/** Shared chrome for every contribution form: submit plumbing, form-level
    errors, and the post-submit success panel with an "Add another" reset.
    Also used by EditCompanyForm.tsx, which overrides the success copy. */
export function ContributionShell<T extends FieldValues>({
  form,
  action,
  slug,
  companyName,
  submitLabel,
  successTitle = 'Submitted for review',
  successBody = 'Thanks for contributing — it will appear on the profile once an admin approves it.',
  resetLabel = 'Add another',
  children,
}: {
  form: UseFormReturn<T>;
  action: (values: T) => Promise<ActionResult>;
  slug: string;
  companyName: string;
  submitLabel: string;
  successTitle?: string;
  successBody?: string;
  resetLabel?: string;
  children: ReactNode;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await action(values);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? 'Something went wrong. Please try again.');
  });

  if (submitted) {
    return (
      <Card emphasis className="p-6">
        <p className="font-display text-lg font-bold tracking-tight text-ink">{successTitle}</p>
        <p className="mt-2 text-sm text-graphite-500">{successBody}</p>
        <div className="mt-5 flex items-center gap-4">
          <Button variant="primary" shape="pill" size="sm" href={`/companies/${slug}`}>
            Back to {companyName}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              form.reset();
              setSubmitted(false);
            }}
          >
            {resetLabel}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {children}

          {formError ? <FormError>{formError}</FormError> : null}

          <div>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Submitting…' : submitLabel}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}

export function RoundForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<RoundFormValues>({
    resolver: zodResolver(roundFormSchema),
    defaultValues: roundFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addRoundAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit round"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Round" placeholder="Series A" />
        <TextField control={form.control} name="date" label="Date" type="date" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="amountUsd"
          label="Raise (USD)"
          inputMode="numeric"
        />
        <TextField
          control={form.control}
          name="postMoneyUsd"
          label="Post-money (USD, optional)"
          inputMode="numeric"
        />
      </div>
      <TextField
        control={form.control}
        name="lead"
        label="Lead investor (optional)"
        placeholder="Sequoia Capital"
      />
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}

export function InvestorForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<InvestorFormValues>({
    resolver: zodResolver(investorFormSchema),
    defaultValues: investorFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addInvestorAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit investor"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="name"
          label="Investor name"
          placeholder="Sequoia Capital"
        />
        <SelectField control={form.control} name="type" label="Type">
          {INVESTOR_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="firstRound"
          label="First round"
          placeholder="Series A"
        />
        <TextField
          control={form.control}
          name="rounds"
          label="Rounds participated"
          inputMode="numeric"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="websiteUrl"
          label="Website (optional)"
          placeholder="https://…"
        />
        <TextField
          control={form.control}
          name="linkedinUrl"
          label="LinkedIn (optional)"
          placeholder="https://…"
        />
      </div>
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}

export function PersonForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<PersonFormValues>({
    resolver: zodResolver(personFormSchema),
    defaultValues: personFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addPersonAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit team member"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Name" />
        <TextField control={form.control} name="role" label="Role" placeholder="CEO" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="title"
          label="Title (optional)"
          placeholder="Co-founder & CEO"
        />
        <TextField
          control={form.control}
          name="since"
          label="Since (year)"
          inputMode="numeric"
          placeholder="2019"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="prior"
          label="Prior affiliation (optional)"
          placeholder="Stripe"
        />
        <TextField
          control={form.control}
          name="linkedinUrl"
          label="LinkedIn (optional)"
          placeholder="https://…"
        />
      </div>
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}

export function AcquisitionForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<AcquisitionFormValues>({
    resolver: zodResolver(acquisitionFormSchema),
    defaultValues: acquisitionFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addAcquisitionAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit acquisition"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="target" label="Target company" />
        <TextField control={form.control} name="date" label="Date" type="date" />
      </div>
      <TextField
        control={form.control}
        name="amountUsd"
        label="Amount (USD, optional)"
        inputMode="numeric"
      />
      <TextareaField
        control={form.control}
        name="rationale"
        label="Rationale"
        rows={3}
        placeholder="Why the deal happened — one or two sentences."
      />
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}

export function ExitForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<ExitFormValues>({
    resolver: zodResolver(exitFormSchema),
    defaultValues: exitFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addExitAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit exit"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={form.control} name="type" label="Type">
          {EXIT_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectField>
        <TextField control={form.control} name="date" label="Date" type="date" />
      </div>
      <TextField
        control={form.control}
        name="valueUsd"
        label="Value (USD, optional)"
        inputMode="numeric"
      />
      <TextareaField
        control={form.control}
        name="detail"
        label="Detail"
        rows={3}
        placeholder="What happened — exchange, acquirer, terms."
      />
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}

export function DiversityForm({ slug, companyName }: ContributionFormProps) {
  const form = useForm<DiversityFormValues>({
    resolver: zodResolver(diversityFormSchema),
    defaultValues: diversityFormDefaults,
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => addDiversityAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Submit diversity data"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="label"
          label="Label"
          placeholder="Women in leadership"
        />
        <TextField control={form.control} name="value" label="Value" placeholder="38%" />
      </div>
      <TextareaField
        control={form.control}
        name="note"
        label="Note"
        rows={2}
        placeholder="One line of context — as-of date, methodology."
      />
      <SourceUrlField control={form.control} />
    </ContributionShell>
  );
}
