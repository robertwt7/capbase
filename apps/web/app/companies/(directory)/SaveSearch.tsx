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
/**
 * The toolbar's Save search button, sized like Filters. Rendered as siblings inside the
 * toolbar's wrapping flex row: the name form opens on its own full-width line below, and
 * the status line takes no space until it has something to say.
 */
export function SaveSearch({ params }: { params: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const form = useForm<SavedSearchFormValues>({
    resolver: zodResolver(savedSearchFormSchema),
    defaultValues: savedSearchFormDefaults,
  });
  return (
    <>
      <Button
        variant="outline"
        shape="box"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Save search
      </Button>
      {open ? (
        <Form {...form}>
          <form
            className="flex basis-full flex-wrap items-end gap-3"
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
            <div className="w-full max-w-xs">
              <TextField control={form.control} name="name" label="Search name" autoFocus className="h-11" />
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              Save
            </Button>
            {error ? <FormError>{error}</FormError> : null}
          </form>
        </Form>
      ) : null}
      {/* Always mounted (a live region must exist before it changes); out of flow while empty. */}
      <p role="status" className="basis-full text-xs text-graphite-500 empty:sr-only">
        {message}
      </p>
    </>
  );
}
