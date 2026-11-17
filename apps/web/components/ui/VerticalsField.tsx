'use client';

import { useState } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { MAX_COMPANY_VERTICALS, SECTORS, verticalsOf, type Sector } from '@repo/api';

import { Checkbox } from './checkbox';
import { FormField, FormItem, FormMessage } from './form';
import { Label } from './label';

const listOf = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The company's verticals as checkboxes, one group per sector. The form value stays a
 * comma-joined string (the string-only form rule; `lib/validation/proposal.ts` checks it). The
 * company's own sector — and any group already holding a pick — starts open; the rest are
 * disclosures. At `MAX_COMPANY_VERTICALS` the unpicked boxes are disabled.
 */
export function VerticalsField<T extends FieldValues>({
  control,
  name,
  sector,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  /** The company's primary sector, whose group starts open. */
  sector?: Sector | null;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <VerticalGroups
          value={listOf(field.value)}
          onChange={(next) => field.onChange(next.join(', '))}
          onBlur={field.onBlur}
          sector={sector ?? null}
          name={field.name}
        />
      )}
    />
  );
}

function VerticalGroups({
  value,
  onChange,
  onBlur,
  sector,
  name,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onBlur: () => void;
  sector: Sector | null;
  name: string;
}) {
  const groups = SECTORS.map((s) => ({ sector: s, verticals: verticalsOf(s) })).filter(
    (g) => g.verticals.length > 0,
  );
  // Fixed at mount: the groups a reader starts from. Toggling a disclosure afterwards is theirs.
  const [initiallyOpen] = useState(
    () =>
      new Set(
        groups
          .filter((g) => g.sector === sector || g.verticals.some((v) => value.includes(v)))
          .map((g) => g.sector),
      ),
  );
  const full = value.length >= MAX_COMPANY_VERTICALS;
  const toggle = (v: string, on: boolean) =>
    onChange(on ? [...value.filter((x) => x !== v), v] : value.filter((x) => x !== v));

  return (
    <FormItem>
      <fieldset className="flex flex-col gap-2" onBlur={onBlur}>
        <legend className="mb-2 flex w-full items-baseline justify-between gap-3 font-mono text-[11px] font-medium tracking-[0.08em] text-graphite-700 uppercase">
          <span>Verticals (optional)</span>
          <span className="text-graphite-500" aria-live="polite">
            {value.length} of {MAX_COMPANY_VERTICALS}
          </span>
        </legend>
        {groups.map((g) => (
          <details
            key={g.sector}
            open={initiallyOpen.has(g.sector) || undefined}
            className="rounded-sm border border-line bg-surface px-3 py-2"
          >
            <summary className="cursor-pointer font-sans text-sm text-ink">
              {g.sector}
              {g.verticals.some((v) => value.includes(v)) ? (
                <span className="ml-2 font-mono text-[11px] text-graphite-500">
                  {g.verticals.filter((v) => value.includes(v)).length} picked
                </span>
              ) : null}
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {g.verticals.map((v) => {
                const id = `${name}-${v.replace(/[^a-z0-9]+/gi, '-')}`;
                const checked = value.includes(v);
                return (
                  <div key={v} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={!checked && full}
                      onCheckedChange={(on) => toggle(v, on === true)}
                    />
                    <Label
                      htmlFor={id}
                      className="font-sans text-sm font-normal tracking-normal text-graphite-700 normal-case"
                    >
                      {v}
                    </Label>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </fieldset>
      <FormMessage />
    </FormItem>
  );
}
