'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Form, FormError, TextField } from '@/components/ui';
import {
  savedSearchFormSchema,
  savedSearchFormDefaults,
  type SavedSearchFormValues,
} from '@/lib/validation/saved-search';
import { applyServerErrors } from '@/lib/validation/utils';
import { saveSearchAction } from '@/app/(account)/profile/saved-search-actions';
export function SaveSearch({ params }: { params: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const form = useForm<SavedSearchFormValues>({
    resolver: zodResolver(savedSearchFormSchema),
    defaultValues: savedSearchFormDefaults,
  });
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Save search
      </Button>
      {open ? (
        <Form {...form}>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              setError(undefined);
              setMessage('');
              const result = await saveSearchAction({ ...values, params });
              if (result.ok) {
                setMessage('Search saved. You can manage it on your profile.');
                setOpen(false);
                form.reset();
              } else {
                if (result.fieldErrors)
                  applyServerErrors(form.setError, result.fieldErrors);
                setError(result.formError);
              }
            })}
          >
            <TextField control={form.control} name="name" label="Search name" />
            <Button
              variant="primary"
              type="submit"
              size="sm"
              disabled={form.formState.isSubmitting}
            >
              Save
            </Button>
            {error ? <FormError>{error}</FormError> : null}
          </form>
        </Form>
      ) : null}
      <p role="status" className="mt-1 text-xs text-graphite-500">
        {message}
      </p>
    </div>
  );
}
