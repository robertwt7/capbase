'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AUDIENCES,
  SECTION_LEVELS,
  crawlerView,
  directoryParamLabel,
  type AdminSectionPolicyRow,
  type SectionLevel,
} from '@repo/api';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Card, Form, FormError, SelectField, SelectItem, TextField } from '@/components/ui';
import {
  sectionPolicyFormSchema,
  toSectionPolicyFormValues,
  toSectionPolicyInput,
  type SectionPolicyFormValues,
} from '@/lib/validation/visibility';
import { applyServerErrors } from '@/lib/validation/utils';

import { resetSectionAction, updateSectionAction } from './actions';
import { AUDIENCE_LABELS, LEVEL_LABELS, OverrideMeta, RowActions } from './shared';

const TIERS = [
  { name: 'signedOut', label: 'Signed out' },
  { name: 'signedIn', label: 'Signed in' },
  { name: 'unlocked', label: 'Contributed' },
] as const;

/** One gated section: what each audience gets, how many preview rows, and who
 *  sees the partner's rows. Its own form; remounted (keyed) when saved. */
export function SectionPolicyRow({ row }: { row: AdminSectionPolicyRow }) {
  const form = useForm<SectionPolicyFormValues>({
    resolver: zodResolver(sectionPolicyFormSchema),
    defaultValues: toSectionPolicyFormValues(row.section, row.current),
    mode: 'onChange',
  });
  const [formError, setFormError] = useState<string>();
  const values = form.watch();
  // A block is shown whole or not at all: no preview option.
  const levels: readonly SectionLevel[] =
    row.kind === 'block' ? SECTION_LEVELS.filter((l) => l !== 'preview') : SECTION_LEVELS;
  const previewing = TIERS.some((t) => values[t.name] === 'preview');
  const rows = Number(values.previewRows);
  const crawler = crawlerView({
    ...toSectionPolicyInput(values),
    previewRows: Number.isFinite(rows) && rows > 0 ? rows : row.current.previewRows,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(undefined);
    const result = await updateSectionAction(v);
    if (result.ok) return;
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? (result.fieldErrors ? undefined : 'Could not save.'));
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">
          {row.label}
          <span className="ml-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-graphite-500 uppercase">
            {row.kind === 'block' ? 'Whole block' : 'Rows'}
          </span>
        </h3>
        <OverrideMeta override={row.override} />
      </div>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-5 gap-3 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            {TIERS.map((tier) => (
              <SelectField key={tier.name} control={form.control} name={tier.name} label={tier.label}>
                {levels.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectField>
            ))}
            <TextField
              control={form.control}
              name="previewRows"
              label="Preview rows"
              inputMode="numeric"
              disabled={!previewing}
              className="font-mono"
            />
            <SelectField control={form.control} name="partnerAudience" label="Partner rows">
              {AUDIENCES.map((a) => (
                <SelectItem key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </SelectItem>
              ))}
            </SelectField>
          </div>
          <p className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
            Search engines see: {crawler}
          </p>
          {row.filter && row.entity === 'company' ? (
            <p className="text-[13px] text-graphite-600">
              {`Also locks the ${directoryParamLabel('company', row.filter).toLowerCase()} filter on /companies (needs Full).`}
            </p>
          ) : null}
          {formError ? <FormError>{formError}</FormError> : null}
          <RowActions
            saving={form.formState.isSubmitting}
            overridden={row.override !== null}
            onReset={() => resetSectionAction(row.section)}
          />
        </form>
      </Form>
    </Card>
  );
}
