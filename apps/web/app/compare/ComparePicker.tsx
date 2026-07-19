'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CompanyLogo } from '@/components/CompanyLogo';
import { Input } from '@/components/ui';

import type { CompanySearchHit } from '../api/companies/search/route';

/** Adds a company to the comparison by pushing the extended ?companies= URL.
    Searches the directory server-side (debounced) instead of shipping every
    company as an option. Keyed on `current` upstream so it remounts (and
    clears) after navigation. */
export function ComparePicker({ current }: { current: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<CompanySearchHit[]>([]);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(needle)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const hits = (await res.json()) as CompanySearchHit[];
        setOptions(hits.filter((hit) => !current.includes(hit.slug)));
      } catch {
        // Aborted (superseded keystroke) or offline — keep the previous list.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, current]);

  return (
    <div className="relative max-w-xs">
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Add a company…"
        aria-label="Add a company to compare"
      />
      {options.length > 0 ? (
        <ul className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          {options.map((o) => (
            <li key={o.slug} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => router.push(`/compare?companies=${[...current, o.slug].join(',')}`)}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-paper"
              >
                <CompanyLogo name={o.name} domain={o.domain} size={22} />
                <span className="truncate">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
