'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { Checkbox } from './checkbox';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form';

export const ATTESTATION_TEXT =
  "I have the right to share this and I'm not copying from a database whose terms forbid it.";

/**
 * The contribution attestation (Terms §4). Required on every contribution form,
 * rendered right after <SourceUrlField>; the API rejects a submission without it
 * (`@Equals(true)` on every contribution DTO).
 */
export function AttestationField<T extends FieldValues>({
  control,
  name = 'attested' as FieldPath<T>,
  label,
}: {
  control: Control<T>;
  name?: FieldPath<T>;
  /** Replaces the Terms §4 sentence for another must-tick box (the company-claim
   *  "I am authorised to represent this company"). */
  label?: ReactNode;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <div className="flex items-start gap-3">
            <FormControl>
              <Checkbox
                ref={field.ref}
                name={field.name}
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
                onBlur={field.onBlur}
                className="mt-0.5"
              />
            </FormControl>
            <FormLabel className="block font-sans text-sm leading-snug font-normal tracking-normal text-graphite-700 normal-case">
              {label ?? (
                <>
                  {ATTESTATION_TEXT}{' '}
                  <Link
                    href="/terms"
                    className="text-ink underline underline-offset-[3px]"
                  >
                    Terms §4
                  </Link>
                </>
              )}
            </FormLabel>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
