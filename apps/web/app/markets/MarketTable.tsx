'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { MarketStat } from '@repo/api';

import { formatCount, formatUsd, signedPct } from '@/lib/format';
import { sectorSlug } from '@/lib/markets';

export type MarketRow = MarketStat & { companyCount: number };

type Key = 'sector' | 'capital' | 'deals' | 'median' | 'trend' | 'companies';
type Dir = 'asc' | 'desc';

const value = (row: MarketRow, key: Key): string | number => {
  switch (key) {
    case 'sector':
      return row.sector;
    case 'capital':
      return row.totalRaisedUsd;
    case 'deals':
      return row.dealCount;
    case 'median':
      return row.medianValuationUsd;
    case 'trend':
      return row.trendPct;
    case 'companies':
      return row.companyCount;
  }
};

const columns: { key: Key; label: string; numeric: boolean }[] = [
  { key: 'sector', label: 'Sector', numeric: false },
  { key: 'capital', label: 'Capital', numeric: true },
  { key: 'deals', label: 'Deals', numeric: true },
  { key: 'median', label: 'Median valuation', numeric: true },
  { key: 'trend', label: 'Trend', numeric: true },
  { key: 'companies', label: 'Companies', numeric: true },
];

const GRID =
  'grid grid-cols-[minmax(0,1.6fr)_1fr_0.8fr_1.2fr_0.8fr_0.9fr] items-center gap-5 px-[22px]';

export function MarketTable({ rows }: { rows: MarketRow[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: Dir }>({ key: 'capital', dir: 'desc' });

  const toggle = (key: Key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'sector' ? 'asc' : 'desc' },
    );
  };

  const sorted = [...rows].sort((a, b) => {
    const av = value(a, sort.key);
    const bv = value(b, sort.key);
    const cmp =
      typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-line" role="table" aria-label="Sector markets">
      <div
        className={`${GRID} bg-paper py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase`}
        role="row"
      >
        {columns.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => toggle(col.key)}
            aria-sort={sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-ink ${
              col.numeric ? 'justify-end text-right' : 'justify-start text-left'
            }`}
            role="columnheader"
          >
            {col.label}
            <span aria-hidden="true" className="text-[9px]">
              {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
            </span>
          </button>
        ))}
      </div>

      {sorted.map((row) => (
        <Link
          key={row.sector}
          href={`/markets/${sectorSlug(row.sector)}`}
          className={`${GRID} border-t border-line py-4 transition-colors hover:bg-paper`}
          role="row"
        >
          <span className="font-display text-base font-semibold tracking-tight text-ink" role="cell">
            {row.sector}
          </span>
          <span className="text-right font-mono text-[15px] font-medium text-ink" role="cell">
            {formatUsd(row.totalRaisedUsd)}
          </span>
          <span className="text-right font-mono text-[15px] text-graphite-700" role="cell">
            {formatCount(row.dealCount)}
          </span>
          <span className="text-right font-mono text-[15px] text-graphite-700" role="cell">
            {formatUsd(row.medianValuationUsd)}
          </span>
          <span
            className={`text-right font-mono text-[15px] ${row.trendPct >= 0 ? 'text-ink' : 'text-graphite-400'}`}
            role="cell"
          >
            {signedPct(row.trendPct)}
          </span>
          <span className="text-right font-mono text-[15px] text-graphite-700" role="cell">
            {formatCount(row.companyCount)}
          </span>
        </Link>
      ))}
    </div>
  );
}
