'use client';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CursorPage, SavedSearchItem } from '@repo/api';
import {
  Button,
  Form,
  FormError,
  TextField,
  SectionHeader,
} from '@/components/ui';
import {
  savedSearchFormSchema,
  type SavedSearchFormValues,
} from '@/lib/validation/saved-search';
import { applyServerErrors } from '@/lib/validation/utils';
import { MonitoringToggle } from './MonitoringToggle';
import { renameSearchAction, deleteSearchAction } from './saved-search-actions';
function SearchRow({ item }: { item: SavedSearchItem }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const form = useForm<SavedSearchFormValues>({
    resolver: zodResolver(savedSearchFormSchema),
    defaultValues: { name: item.name },
  });
  return (
    <div className="border-b border-line py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display font-semibold">{item.name}</span>
        {item.runnable ? (
          <Button
            variant="outline"
            size="sm"
            href={item.params ? `/companies?${item.params}` : '/companies'}
          >
            Run search
          </Button>
        ) : (
          <span className="text-sm">Unsupported search version</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          Rename
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deleteSearchAction(item.id);
              if (!r.ok) setError(r.formError);
            })
          }
        >
          Delete
        </Button>
      </div>
      {editing ? (
        <Form {...form}>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              const r = await renameSearchAction(item.id, values);
              if (r.ok) setEditing(false);
              else {
                if (r.fieldErrors)
                  applyServerErrors(form.setError, r.fieldErrors);
                setError(r.formError);
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
              Save name
            </Button>
          </form>
        </Form>
      ) : null}
      {item.runnable ? (
        <MonitoringToggle kind="search" id={item.id} monitor={item.monitor} />
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
export function SavedSearches({ page }: { page: CursorPage<SavedSearchItem> }) {
  return (
    <section className="mt-10">
      <SectionHeader title="Saved searches" size="md" />
      {page.items.length ? (
        page.items.map((item) => <SearchRow key={item.id} item={item} />)
      ) : (
        <p className="mt-4 text-sm text-graphite-500">
          Save a search from the company directory to find it here.
        </p>
      )}
      {page.nextCursor ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          href={`/profile?searchCursor=${encodeURIComponent(page.nextCursor)}`}
        >
          More searches
        </Button>
      ) : null}
    </section>
  );
}
