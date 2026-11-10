'use client';

import { XIcon } from 'lucide-react';

import {
  hasRoundCriteria,
  type CompanyListQuery,
  type CompanyScreenContext,
  type DirectoryPage,
} from '@repo/api';

import { Badge, Button } from '@/components/ui';
import { countryName, formatDay, formatUsd } from '@/lib/format';

export interface Chip {
  key: string;
  label: string;
  /** The params this chip's × clears. */
  remove: Partial<Record<keyof CompanyListQuery, undefined>>;
}

type Locked = DirectoryPage<never>['locked'];

const ROUND_WINDOW_LABEL: Record<string, string> = {
  '3m': 'past 3 months',
  '6m': 'past 6 months',
  '12m': 'past 12 months',
  '24m': 'past 24 months',
  '36m': 'past 36 months',
};

const moneyRange = (lo?: number, hi?: number): string | null =>
  lo !== undefined && hi !== undefined
    ? `${formatUsd(lo)}–${formatUsd(hi)}`
    : lo !== undefined
      ? `≥ ${formatUsd(lo)}`
      : hi !== undefined
        ? `≤ ${formatUsd(hi)}`
        : null;

const countRange = (lo?: number, hi?: number): string | null =>
  lo !== undefined && hi !== undefined
    ? lo === hi
      ? String(lo)
      : `${lo}–${hi}`
    : lo !== undefined
      ? `≥ ${lo}`
      : hi !== undefined
        ? `≤ ${hi}`
        : null;

const yearRange = (lo?: number, hi?: number): string | null =>
  lo !== undefined && hi !== undefined
    ? lo === hi
      ? `in ${lo}`
      : `${lo}–${hi}`
    : lo !== undefined
      ? `${lo} or later`
      : hi !== undefined
        ? `${hi} or earlier`
        : null;

/**
 * One chip per applied criterion, in the URL's order. A param the API ignored
 * for this viewer (in `locked.filters` or `locked.disabled`) gets no chip: it
 * was not applied, and a chip would imply that it was.
 */
export function screenChips(query: CompanyListQuery, screen: CompanyScreenContext | null, locked: Locked): Chip[] {
  const off = (param: string) => locked.filters.includes(param) || locked.disabled.includes(param);
  const chips: Chip[] = [];
  if (query.q) chips.push({ key: 'q', label: `Search · “${query.q}”`, remove: { q: undefined } });
  if (query.sector && !off('sector')) chips.push({ key: 'sector', label: `Sector · ${query.sector}`, remove: { sector: undefined } });
  if (query.stage && !off('stage')) chips.push({ key: 'stage', label: `Stage · ${query.stage}`, remove: { stage: undefined } });
  if (query.status && !off('status')) chips.push({ key: 'status', label: `Status · ${query.status}`, remove: { status: undefined } });
  if (query.country && !off('country')) {
    chips.push({ key: 'country', label: `Country · ${countryName(query.country) ?? query.country}`, remove: { country: undefined } });
  }

  const raised = moneyRange(query.raisedMin, query.raisedMax);
  if (raised && !off('raised')) chips.push({ key: 'raised', label: `Total raised ${raised}`, remove: { raisedMin: undefined, raisedMax: undefined } });
  const valuation = moneyRange(query.valuationMin, query.valuationMax);
  if (valuation && !off('valuation')) {
    chips.push({ key: 'valuation', label: `Last valuation ${valuation}`, remove: { valuationMin: undefined, valuationMax: undefined } });
  }
  const founded = yearRange(query.foundedMin, query.foundedMax);
  if (founded && !off('founded')) chips.push({ key: 'founded', label: `Founded ${founded}`, remove: { foundedMin: undefined, foundedMax: undefined } });
  const headcount = countRange(query.headcountMin, query.headcountMax);
  if (headcount && !off('headcount')) {
    chips.push({ key: 'headcount', label: `Headcount ${headcount}`, remove: { headcountMin: undefined, headcountMax: undefined } });
  }

  if (!off('round') && hasRoundCriteria(query)) {
    const window = screen?.window;
    const when = query.roundWithin
      ? `${ROUND_WINDOW_LABEL[query.roundWithin]}${window?.from ? ` (since ${formatDay(window.from)})` : ''}`
      : query.roundFrom && query.roundTo
        ? `${formatDay(query.roundFrom)} – ${formatDay(query.roundTo)}`
        : query.roundFrom
          ? `since ${formatDay(query.roundFrom)}`
          : query.roundTo
            ? `until ${formatDay(query.roundTo)}`
            : null;
    const parts = [query.roundKind, when].filter(Boolean);
    if (parts.length) {
      chips.push({
        key: 'round',
        label: `Financing · ${parts.join(' · ')}`,
        remove: { roundWithin: undefined, roundFrom: undefined, roundTo: undefined, roundKind: undefined },
      });
    }
    const size = moneyRange(query.roundMin, query.roundMax);
    if (size) chips.push({ key: 'roundSize', label: `Round size ${size}`, remove: { roundMin: undefined, roundMax: undefined } });
  }

  if (query.investor && !off('investor') && screen) {
    const scope = screen.investor?.scope;
    const label = screen.investorNotFound
      ? 'Investor not found'
      : screen.investor
        ? `Investor · ${screen.investor.name} · ${
            scope === 'round' ? 'on the matching financing' : scope === 'holdings' ? 'recorded holdings' : 'any recorded link'
          }`
        : null;
    if (label) chips.push({ key: 'investor', label, remove: { investor: undefined, investorOn: undefined } });
  }
  return chips;
}

/** The applied criteria as removable chips, plus "Clear filters". */
export function ActiveFilters({
  chips,
  onRemove,
  onClear,
  showClear,
}: {
  chips: Chip[];
  onRemove: (chip: Chip) => void;
  onClear: () => void;
  showClear: boolean;
}) {
  if (chips.length === 0 && !showClear) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {chips.length ? (
        <ul role="list" aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Badge variant="box" mono className="gap-1 py-0.5 pr-0.5 normal-case">
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={() => onRemove(chip)}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="grid size-6 place-items-center rounded-sm text-graphite-500 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
                >
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {showClear ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
