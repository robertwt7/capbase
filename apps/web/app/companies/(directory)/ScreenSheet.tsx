'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { ROUND_KINDS, type CompanyScreenQuery, type DirectoryPage } from '@repo/api';

import { LockedFilter } from '@/components/LockedFilter';
import {
  Button,
  Checkbox,
  Form,
  Label,
  SelectField,
  SelectItem,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  TextField,
} from '@/components/ui';
import { COMPANY_EXTRA_COLUMNS, type CompanyExtraColumn } from '@/lib/list-params';
import {
  screenFormDefaults,
  screenFormSchema,
  toScreenFormValues,
  toScreenQuery,
  type ScreenFormValues,
} from '@/lib/validation/screen';

import { InvestorPicker } from './InvestorPicker';

type Locked = DirectoryPage<never>['locked'];

const WINDOW_LABELS: Record<string, string> = {
  any: 'Any time',
  '3m': 'Past 3 months',
  '6m': 'Past 6 months',
  '12m': 'Past 12 months',
  '24m': 'Past 24 months',
  '36m': 'Past 36 months',
  custom: 'Custom dates',
};

const COLUMN_LABELS: Record<CompanyExtraColumn, string> = {
  country: 'Country',
  founded: 'Founded',
  headcount: 'Headcount',
};

const SCALE = [
  {
    key: 'raised',
    legend: 'Total raised (USD)',
    min: 'raisedMin',
    max: 'raisedMax',
    mode: 'decimal',
    hint: 'Companies without a recorded total are excluded.',
  },
  {
    key: 'valuation',
    legend: 'Last valuation (USD)',
    min: 'valuationMin',
    max: 'valuationMax',
    mode: 'decimal',
    hint: 'Companies without a recorded valuation are excluded.',
  },
  {
    key: 'founded',
    legend: 'Founded',
    min: 'foundedMin',
    max: 'foundedMax',
    mode: 'numeric',
    hint: 'Companies without a recorded founding year are excluded.',
  },
  {
    key: 'headcount',
    legend: 'Headcount',
    min: 'headcountMin',
    max: 'headcountMax',
    mode: 'numeric',
    hint: 'Companies without a recorded headcount are excluded.',
  },
] as const;

const hintClass = 'font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase';
const legendClass = 'font-display text-[15px] font-semibold tracking-tight text-ink';

/**
 * The directory's advanced criteria in a sheet (full width on a phone): scale
 * ranges, one matching financing, an investor, and the optional columns. Its
 * draft is a react-hook-form form seeded from the current query; Apply
 * validates, then hands back only the advanced params (the top-row filters are
 * kept by the caller). A group the API locks for this viewer renders the lock
 * instead; one switched off for everyone renders nothing.
 */
export function ScreenSheet({
  query,
  investorName,
  locked,
  count,
  columns,
  onApply,
}: {
  query: CompanyScreenQuery;
  investorName: string;
  locked: Locked;
  /** Active advanced criteria, for the button label. */
  count: number;
  columns: CompanyExtraColumn[];
  onApply: (screen: CompanyScreenQuery, columns: CompanyExtraColumn[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" shape="box">
          {count > 0 ? `Filters · ${count}` : 'Filters'}
        </Button>
      </SheetTrigger>
      {open ? (
        <ScreenSheetBody
          query={query}
          investorName={investorName}
          locked={locked}
          columns={columns}
          onApply={(screen, cols) => {
            onApply(screen, cols);
            setOpen(false);
          }}
        />
      ) : null}
    </Sheet>
  );
}

function ScreenSheetBody({
  query,
  investorName,
  locked,
  columns,
  onApply,
}: {
  query: CompanyScreenQuery;
  investorName: string;
  locked: Locked;
  columns: CompanyExtraColumn[];
  onApply: (screen: CompanyScreenQuery, columns: CompanyExtraColumn[]) => void;
}) {
  const ids = useId();
  const form = useForm<ScreenFormValues>({
    resolver: zodResolver(screenFormSchema),
    defaultValues: toScreenFormValues(query, investorName),
  });
  const [cols, setCols] = useState<CompanyExtraColumn[]>(columns);
  const listOpen = useRef(false);
  const onListOpenChange = useCallback((o: boolean) => {
    listOpen.current = o;
  }, []);

  const off = (param: string) => locked.disabled.includes(param);
  const lockedFilter = (param: string): ReactNode =>
    locked.filters.includes(param) ? (
      <LockedFilter entity="company" param={param} unlockBy={locked.unlockBy[param]} next="/companies" />
    ) : null;

  const window = form.watch('window');
  const investor = form.watch('investor');
  const name = form.watch('investorName');
  const investorOn = form.watch('investorOn');
  const roundLocked = locked.filters.includes('round') || off('round');

  const submit = form.handleSubmit((v) => onApply(toScreenQuery(v), cols));
  const reset = () => form.reset(screenFormDefaults);

  return (
    <SheetContent
      side="right"
      className="w-full max-w-[460px] gap-0 overflow-y-auto sm:max-w-[460px] max-[700px]:max-w-none"
      // Escape closes the investor list first, the sheet only when it is shut.
      onEscapeKeyDown={(e) => {
        if (listOpen.current) e.preventDefault();
      }}
    >
      <SheetHeader className="border-b border-line px-5 py-4">
        <SheetTitle className="text-lg">Filter companies</SheetTitle>
        <SheetDescription>Every criterion must hold. Only recorded values match.</SheetDescription>
      </SheetHeader>
      <Form {...form}>
        <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
          <div className="flex flex-col gap-6 px-5 py-5">
            {SCALE.map((g) =>
              off(g.key) ? null : (
                <fieldset key={g.key} className="flex flex-col gap-2">
                  <legend className={legendClass}>{g.legend}</legend>
                  {lockedFilter(g.key) ?? (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <TextField
                          control={form.control}
                          name={g.min}
                          label="Min"
                          inputMode={g.mode}
                          placeholder={g.mode === 'decimal' ? 'e.g. 5M' : undefined}
                          className="h-11 font-mono"
                        />
                        <TextField
                          control={form.control}
                          name={g.max}
                          label="Max"
                          inputMode={g.mode}
                          placeholder={g.mode === 'decimal' ? 'e.g. 50M' : undefined}
                          className="h-11 font-mono"
                        />
                      </div>
                      <p className={hintClass}>{g.hint}</p>
                    </>
                  )}
                </fieldset>
              ),
            )}

            {off('round') ? null : (
              <fieldset className="flex flex-col gap-2 border-t border-line pt-5">
                <legend className={legendClass}>Had a financing…</legend>
                {lockedFilter('round') ?? (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
                      <SelectField control={form.control} name="window" label="When">
                        {Object.entries(WINDOW_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectField>
                      <SelectField control={form.control} name="roundKind" label="Kind">
                        <SelectItem value="any">Any kind</SelectItem>
                        {ROUND_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectField>
                    </div>
                    {window === 'custom' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <TextField control={form.control} name="roundFrom" label="From" type="date" className="h-11" />
                        <TextField control={form.control} name="roundTo" label="To" type="date" className="h-11" />
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <TextField
                        control={form.control}
                        name="roundMin"
                        label="Round size min"
                        inputMode="decimal"
                        placeholder="e.g. 1M"
                        className="h-11 font-mono"
                      />
                      <TextField
                        control={form.control}
                        name="roundMax"
                        label="Round size max"
                        inputMode="decimal"
                        placeholder="e.g. 20M"
                        className="h-11 font-mono"
                      />
                    </div>
                    <p className={hintClass}>
                      Matches a single recorded round that meets every condition. Undisclosed amounts never match a
                      size.
                    </p>
                  </>
                )}
              </fieldset>
            )}

            {off('investor') ? null : (
              <fieldset className="flex flex-col gap-2 border-t border-line pt-5">
                <legend id={`${ids}-investor`} className={legendClass}>
                  Investor
                </legend>
                {lockedFilter('investor') ?? (
                  <>
                    <div className="mt-2">
                      <InvestorPicker
                        labelledBy={`${ids}-investor`}
                        value={investor ? { slug: investor, name: name || investor } : null}
                        onChange={(v) => {
                          form.setValue('investor', v?.slug ?? '');
                          form.setValue('investorName', v?.name ?? '');
                          if (!v) form.setValue('investorOn', 'any');
                        }}
                        onListOpenChange={onListOpenChange}
                      />
                    </div>
                    <div role="radiogroup" aria-label="How the investor is linked" className="flex flex-col">
                      {(
                        [
                          ['any', 'Any recorded link (holding or named on a round)'],
                          ['round', 'On the matching financing'],
                        ] as const
                      ).map(([value, label]) => {
                        // "On the matching financing" needs the financing filter.
                        if (value === 'round' && off('round')) return null;
                        const disabled = !investor || (value === 'round' && roundLocked);
                        return (
                          <label
                            key={value}
                            className={`flex min-h-11 items-center gap-3 text-sm ${disabled ? 'text-graphite-400' : 'text-ink'}`}
                          >
                            <input
                              type="radio"
                              name="investorOn"
                              value={value}
                              checked={investorOn === value}
                              disabled={disabled}
                              onChange={() => form.setValue('investorOn', value)}
                              className="size-4 accent-ink"
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </fieldset>
            )}

            <fieldset className="flex flex-col gap-1 border-t border-line pt-5">
              <legend className={legendClass}>Columns</legend>
              {COMPANY_EXTRA_COLUMNS.map((c) => (
                <div key={c} className="flex items-center gap-3">
                  <Checkbox
                    id={`${ids}-col-${c}`}
                    checked={cols.includes(c)}
                    onCheckedChange={(checked) =>
                      setCols((prev) =>
                        checked === true ? COMPANY_EXTRA_COLUMNS.filter((x) => x === c || prev.includes(x)) : prev.filter((x) => x !== c),
                      )
                    }
                  />
                  <Label htmlFor={`${ids}-col-${c}`} className="flex min-h-11 flex-1 items-center text-sm font-normal">
                    {COLUMN_LABELS[c]}
                  </Label>
                </div>
              ))}
            </fieldset>
          </div>
          <SheetFooter className="sticky bottom-0 flex-row gap-3 border-t border-line bg-surface px-5 py-4">
            <Button type="submit" variant="primary" className="flex-1">
              Apply
            </Button>
            <Button type="button" variant="outline" shape="box" onClick={reset}>
              Reset
            </Button>
          </SheetFooter>
        </form>
      </Form>
    </SheetContent>
  );
}
