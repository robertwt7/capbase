'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  COMPANY_STATUSES,
  COMPANY_TYPES,
  OPERATING_STATUSES,
  SECTORS,
  STAGES,
  type Company,
} from '@repo/api';

import {
  SelectField,
  SelectItem,
  SourceUrlField,
  TextareaField,
  TextField,
} from '@/components/ui';
import {
  editDefaultsFromCompany,
  editFormSchema,
  type EditFormValues,
} from '@/lib/validation/proposal';

import { proposeEditAction } from './actions';
import { ContributionShell } from './forms';

/** Quiet mono divider between field groups — keeps the long form scannable. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 border-b border-line pb-1.5 font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase first:mt-0">
      {children}
    </p>
  );
}

/** The full company form pre-filled from live data. The server action diffs the
    submitted values against current values and stores only the changed fields. */
export function EditCompanyForm({ slug, companyName, company }: {
  slug: string;
  companyName: string;
  company: Company;
}) {
  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: editDefaultsFromCompany(company),
    mode: 'onBlur',
  });

  return (
    <ContributionShell
      form={form}
      action={(values) => proposeEditAction(slug, values)}
      slug={slug}
      companyName={companyName}
      submitLabel="Propose changes"
      successTitle="Proposal submitted"
      successBody="An admin will review the changes before they appear on the profile."
      resetLabel="Propose another change"
    >
      <GroupLabel>Identity</GroupLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Company name" />
        <TextField control={form.control} name="domain" label="Domain" placeholder="acme.com" />
      </div>
      <TextField
        control={form.control}
        name="legalName"
        label="Legal name (optional)"
        placeholder="Acme, Inc."
      />

      <GroupLabel>Profile</GroupLabel>
      <TextField control={form.control} name="oneLiner" label="One-liner" />
      <TextareaField control={form.control} name="description" label="Description" rows={4} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="hq" label="Headquarters" />
        <TextField control={form.control} name="founded" label="Founded" inputMode="numeric" />
        <TextField control={form.control} name="headcount" label="Headcount" inputMode="numeric" />
      </div>
      <TextField
        control={form.control}
        name="industry"
        label="Industry tags"
        description="Comma-separated."
      />

      <GroupLabel>Classification</GroupLabel>
      <div className="grid gap-4 sm:grid-cols-2">
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
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          control={form.control}
          name="primarySector"
          label="Sector"
          placeholder="Not set"
        >
          {SECTORS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectField>
        <SelectField
          control={form.control}
          name="operatingStatus"
          label="Operating status"
          placeholder="Not set"
        >
          {OPERATING_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectField>
        <SelectField
          control={form.control}
          name="companyType"
          label="Company type"
          placeholder="Not set"
        >
          {COMPANY_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectField>
      </div>

      <GroupLabel>Capital</GroupLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="totalRaisedUsd"
          label="Total raised (USD)"
          inputMode="numeric"
        />
        <TextField
          control={form.control}
          name="lastValuationUsd"
          label="Last valuation (USD, optional)"
          inputMode="numeric"
        />
      </div>

      <GroupLabel>Links</GroupLabel>
      <TextField
        control={form.control}
        name="websiteUrl"
        label="Website (optional)"
        placeholder="https://…"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="linkedinUrl"
          label="LinkedIn (optional)"
          placeholder="https://…"
        />
        <TextField
          control={form.control}
          name="twitterUrl"
          label="Twitter (optional)"
          placeholder="https://…"
        />
      </div>

      <GroupLabel>Source</GroupLabel>
      {/* One URL, cited against every field this proposal changes. */}
      <SourceUrlField control={form.control} />
      <TextareaField
        control={form.control}
        name="note"
        label="Note for the reviewer (optional)"
        rows={2}
        placeholder="One line on why this change is right."
      />
    </ContributionShell>
  );
}
