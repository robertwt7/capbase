'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AUDIENCES, audienceAtLeast, type AdminFieldPolicyRow } from '@repo/api';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Card, Form, FormError, SelectField, SelectItem } from '@/components/ui';
import { fieldPolicyFormSchema, type FieldPolicyFormValues } from '@/lib/validation/visibility';
import { applyServerErrors } from '@/lib/validation/utils';

import { resetFieldAction, updateFieldAction } from './actions';
import { AUDIENCE_LABELS, OverrideMeta, RowActions } from './shared';

/** One header fact: who sees it, and who sees the partner's value of it. */
export function FieldPolicyRow({ row }: { row: AdminFieldPolicyRow }) {
  const form = useForm<FieldPolicyFormValues>({
    resolver: zodResolver(fieldPolicyFormSchema),
    defaultValues: {
      entity: row.entity,
      field: row.field,
      audience: row.current.audience,
      partnerAudience: row.current.partnerAudience,
    },
    mode: 'onChange',
  });
  const [formError, setFormError] = useState<string>();
  const audience = form.watch('audience');
  const locks = [row.filter && 'filter', row.sort && 'sort'].filter(Boolean).join(' and ');

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(undefined);
    const result = await updateFieldAction(v);
    if (result.ok) return;
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? (result.fieldErrors ? undefined : 'Could not save.'));
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">
          {row.label}
          <span className="ml-2.5 font-mono text-[11px] font-normal tracking-[0.06em] text-graphite-500">
            {row.field}
          </span>
        </h3>
        <OverrideMeta override={row.override} />
      </div>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
            <SelectField control={form.control} name="audience" label="Who sees it">
              {AUDIENCES.map((a) => (
                <SelectItem key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </SelectItem>
              ))}
            </SelectField>
            <SelectField control={form.control} name="partnerAudience" label="When the partner wrote it">
              {/* The partner's value never reaches wider than the field itself. */}
              {AUDIENCES.map((a) => (
                <SelectItem key={a} value={a} disabled={!audienceAtLeast(a, audience)}>
                  {AUDIENCE_LABELS[a]}
                </SelectItem>
              ))}
            </SelectField>
          </div>
          {locks ? (
            <p className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
              Also locks the {row.label.toLowerCase()} {locks} in the directory
            </p>
          ) : null}
          {formError ? <FormError>{formError}</FormError> : null}
          <RowActions
            saving={form.formState.isSubmitting}
            overridden={row.override !== null}
            onReset={() => resetFieldAction(row.entity, row.field)}
          />
        </form>
      </Form>
    </Card>
  );
}
