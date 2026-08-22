'use client';

import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { TextField } from './fields';

/**
 * The source-URL prompt every contribution form carries. Optional, but asked on
 * every submission: a fact with a citation renders with a link to the document
 * behind it, and one without renders as explicitly uncited.
 *
 * Always last in a form — optional fields go after required ones.
 */
export function SourceUrlField<T extends FieldValues>({
  control,
  name = 'sourceUrl' as FieldPath<T>,
}: {
  control: Control<T>;
  name?: FieldPath<T>;
}) {
  return (
    <TextField
      control={control}
      name={name}
      label="Source URL (optional)"
      placeholder="https://…"
      inputMode="url"
      description="Link the filing, press release, or page this comes from. Cited facts show a source link on the profile; uncited ones are marked as unsourced."
    />
  );
}
