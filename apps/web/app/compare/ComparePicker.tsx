'use client';

import { useRouter } from 'next/navigation';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';

/** Adds a company to the comparison by pushing the extended ?companies= URL.
    Keyed on `current` upstream so it remounts (and clears) after navigation. */
export function ComparePicker({
  options,
  current,
}: {
  options: { slug: string; name: string }[];
  current: string[];
}) {
  const router = useRouter();

  return (
    <div className="max-w-xs">
      <Select
        onValueChange={(slug) => router.push(`/compare?companies=${[...current, slug].join(',')}`)}
      >
        <SelectTrigger aria-label="Add a company to compare">
          <SelectValue placeholder="Add a company…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.slug} value={o.slug}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
