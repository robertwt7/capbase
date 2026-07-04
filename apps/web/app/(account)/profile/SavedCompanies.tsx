'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import type { SavedCompanyItem } from '@repo/api';

import { setSavedAction } from '@/app/companies/[slug]/actions';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Badge, Button, SectionHeader } from '@/components/ui';
import { formatUsd } from '@/lib/format';

function SavedRow({ item }: { item: SavedCompanyItem }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3.5 border-b border-line py-3 last:border-b-0">
      <CompanyLogo name={item.name} domain={item.domain} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <Link
            href={`/companies/${item.slug}`}
            className="font-display text-[15px] font-semibold text-ink underline-offset-[3px] hover:underline"
          >
            {item.name}
          </Link>
          <Badge variant="box" mono>
            {item.stage}
          </Badge>
        </div>
        <p className="truncate text-[13px] text-graphite-500">{item.oneLiner}</p>
      </div>
      <span className="shrink-0 font-mono text-sm text-ink">{formatUsd(item.totalRaisedUsd)}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setSavedAction(item.slug, false);
          })
        }
      >
        Remove
      </Button>
    </div>
  );
}

/** Watchlist section on the profile page — Tailwind only, no CSS modules. */
export function SavedCompanies({ items }: { items: SavedCompanyItem[] }) {
  return (
    <section className="mt-10">
      <SectionHeader
        title="Saved companies"
        size="md"
        note={items.length > 0 ? `${items.length} saved` : undefined}
      />
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-graphite-500">
          Nothing saved yet — hit Save on any company page to keep it here.
        </p>
      ) : (
        <div className="mt-2">
          {items.map((item) => (
            <SavedRow key={item.slug} item={item} />
          ))}
        </div>
      )}
      {items.length >= 2 ? (
        <div className="mt-4">
          <Button
            variant="outline"
            shape="pill"
            size="sm"
            href={`/compare?companies=${items
              .slice(0, 4)
              .map((i) => i.slug)
              .join(',')}`}
          >
            Compare saved
          </Button>
        </div>
      ) : null}
    </section>
  );
}
