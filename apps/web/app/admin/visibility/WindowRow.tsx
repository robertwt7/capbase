'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminVisibilityResponse } from '@repo/api';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Card, Form, FormError, TextField } from '@/components/ui';
import { windowFormSchema, type WindowFormValues } from '@/lib/validation/visibility';
import { applyServerErrors } from '@/lib/validation/utils';

import { resetWindowAction, updateWindowAction } from './actions';
import { OverrideMeta, RowActions } from './shared';

/** The contribution window: how long one approved contribution keeps a user
 *  unlocked. A change applies to every user at once. */
export function WindowRow({ setting }: { setting: AdminVisibilityResponse['contributionWindowDays'] }) {
  const form = useForm<WindowFormValues>({
    resolver: zodResolver(windowFormSchema),
    defaultValues: { days: String(setting.current) },
    mode: 'onChange',
  });
  const [formError, setFormError] = useState<string>();

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(undefined);
    const result = await updateWindowAction(v);
    if (result.ok) return;
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? (result.fieldErrors ? undefined : 'Could not save.'));
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">Contribution window</h3>
        <OverrideMeta override={setting.override} />
      </div>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <div className="max-w-[220px]">
            <TextField
              control={form.control}
              name="days"
              label="Days"
              inputMode="numeric"
              className="font-mono"
              description={`Default ${setting.default}. Applies to every user's access at once, including lapsed access.`}
            />
          </div>
          {formError ? <FormError>{formError}</FormError> : null}
          <RowActions
            saving={form.formState.isSubmitting}
            overridden={setting.override !== null}
            onReset={() => resetWindowAction()}
          />
        </form>
      </Form>
    </Card>
  );
}
