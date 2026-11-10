'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { XIcon } from 'lucide-react';

import { SEARCH_MIN_CHARS, type SearchHit, type SearchResponse } from '@repo/api';

import { Input } from '@/components/ui';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { cn } from '@/lib/utils';

/** Wait for a pause in typing before searching (the header search's rhythm). */
const DEBOUNCE_MS = 300;

/**
 * Pick one investor firm by identity: a combobox over the same `/api/search`
 * proxy as the header search (investors group only), with its keyboard model —
 * 2+ characters, one call after a 300 ms pause, superseded requests aborted,
 * ↑/↓/Enter/Escape, `aria-activedescendant`. Each option shows the firm's type
 * beside its name so namesakes are told apart; the value kept is the slug.
 *
 * `onListOpenChange` lets the sheet keep Escape for the list while it is open
 * (Radix closes a dialog on Escape before the input sees the key).
 */
export function InvestorPicker({
  value,
  onChange,
  onListOpenChange,
  labelledBy,
}: {
  value: { slug: string; name: string } | null;
  onChange: (value: { slug: string; name: string } | null) => void;
  onListOpenChange?: (open: boolean) => void;
  labelledBy: string;
}) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ q: string; hits: SearchHit[] | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const needle = q.trim();
  const searchable = needle.length >= SEARCH_MIN_CHARS;
  const pending = searchable && answer?.q !== needle;
  const hits = answer?.hits ?? [];
  const visible = open && searchable && answer !== null;

  useEffect(() => onListOpenChange?.(visible), [visible, onListOpenChange]);

  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal });
        const data = res.status === 429 ? null : ((await res.json()) as SearchResponse);
        setAnswer({ q: needle, hits: data ? data.investors : null });
        setActive(-1);
      } catch {
        // Aborted (a newer keystroke) or offline: keep the previous list.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [needle, searchable]);

  const pick = (hit: SearchHit) => {
    onChange({ slug: hit.slug, name: hit.name });
    setQ('');
    setAnswer(null);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && visible) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      if (!visible) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? hits.length - 1 : (a + step + hits.length) % hits.length));
      return;
    }
    if (e.key === 'Enter') {
      // Never submit the sheet's form from here.
      e.preventDefault();
      if (visible && active >= 0 && hits[active]) pick(hits[active]);
    }
  };

  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
        <span className="min-w-0 truncate text-sm text-ink">{value.name}</span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label={`Remove investor: ${value.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-sm text-graphite-500 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  let status = '';
  if (visible && !pending) {
    status = answer?.hits === null ? RATE_LIMITED_MESSAGE : hits.length === 0 ? 'No investors match' : `${hits.length} investors`;
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search investor firms"
        aria-labelledby={labelledBy}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        className="h-11"
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Investor firms"
        hidden={!visible}
        className={cn(
          'absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-sm',
          pending && 'opacity-60',
        )}
      >
        {answer?.hits === null ? (
          <li role="presentation" className="px-3 py-2.5 text-sm text-graphite-600">
            {RATE_LIMITED_MESSAGE}
          </li>
        ) : hits.length === 0 ? (
          <li role="presentation" className="px-3 py-2.5 text-sm text-graphite-600">
            No investors match “{answer?.q}”
          </li>
        ) : (
          hits.map((hit, i) => (
            <li
              key={hit.slug}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input through the click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(hit)}
              className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink', i === active && 'bg-paper')}
            >
              <span className="min-w-0 truncate">{hit.name}</span>
              {hit.meta ? (
                <span className="ml-auto max-w-[45%] shrink-0 truncate font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
                  {hit.meta}
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
