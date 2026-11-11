'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import type { SavedCompanyItem } from '@repo/api';

import { MonitoringToggle } from './MonitoringToggle';
import { Masked } from '@/components/Masked';
import { setSavedAction } from '@/app/companies/[slug]/actions';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Badge, Button, SectionHeader } from '@/components/ui';
import { formatUsd } from '@/lib/format';

function SavedRow({
  item,
  canMonitor,
}: {
  item: SavedCompanyItem;
  canMonitor: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3.5 border-b border-line py-3 last:border-b-0">
      <CompanyLogo name={item.name} domain={item.domain} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <Link
            href={`/companies/${item.slug}`}
            prefetch={false}
            className="font-display text-[15px] font-semibold text-ink underline-offset-[3px] hover:underline"
          >
            {item.name}
          </Link>
          <Badge variant="box" mono>
            <Masked entity={item} field="stage" next="/profile">
              {item.stage}
            </Masked>
          </Badge>
        </div>
        <p className="truncate text-[13px] text-graphite-500">
          <Masked entity={item} field="oneLiner" next="/profile">
            {item.oneLiner}
          </Masked>
        </p>
        {canMonitor && item.monitor ? (
          <MonitoringToggle
            kind="company"
            id={item.slug}
            monitor={item.monitor}
          />
        ) : null}
      </div>
      <span className="shrink-0 font-mono text-sm text-ink">
        <Masked entity={item} field="totalRaisedUsd" next="/profile">
          {formatUsd(item.totalRaisedUsd)}
        </Masked>
      </span>
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
export function SavedCompanies({
  items,
  canMonitor = false,
}: {
  items: SavedCompanyItem[];
  canMonitor?: boolean;
}) {
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
            <SavedRow key={item.slug} item={item} canMonitor={canMonitor} />
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
