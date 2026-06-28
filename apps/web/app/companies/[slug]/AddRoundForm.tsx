'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import { roundFormDefaults, roundFormSchema, type RoundFormValues } from '@/lib/validation/round';
import { applyServerErrors } from '@/lib/validation/utils';

import { addRoundAction } from './actions';

export function AddRoundForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();

  const form = useForm<RoundFormValues>({
    resolver: zodResolver(roundFormSchema),
    defaultValues: roundFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await addRoundAction(slug, values);
    if (result.ok) {
      setSubmitted(true);
      return;
    }
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    setFormError(result.formError ?? 'Something went wrong. Please try again.');
  });

  if (submitted) {
    return (
      <p className="text-sm text-graphite-500">
        Round submitted for review. It will appear here once an admin approves it.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" shape="pill" size="sm" onClick={() => setOpen(true)}>
        + Add a funding round
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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

          {formError ? <FormError>{formError}</FormError> : null}

          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Submitting…' : 'Submit round'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
