'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  SEARCH_MIN_CHARS,
  type SearchHit,
  type SearchResponse,
} from '@repo/api';

import { CompanyLogo } from '@/components/CompanyLogo';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { cn } from '@/lib/utils';

/** Wait for a pause in typing before searching. */
const DEBOUNCE_MS = 300;

const GROUPS = [
  { key: 'companies', label: 'Companies', base: '/companies' },
  { key: 'investors', label: 'Investors', base: '/investors' },
  { key: 'people', label: 'People', base: '/people' },
] as const;

/** One selectable row: a profile, or a group's "See all" link. */
interface Row {
  href: string;
  hit: SearchHit | null;
  label: string;
  index: number;
}

/** What the API answered, and for which query. `data: null` means rate limited. */
interface Answer {
  q: string;
  data: SearchResponse | null;
}

/**
 * The header search: a combobox that searches companies, investors and people
 * as you type (one `GET /api/search` call, after a short pause and 2+
 * characters), plus the `/` shortcut. Without JS it is the plain form it always
 * was — Enter lands on `/companies?q=`, and so does Enter with nothing highlighted.
 */
export function HeaderSearch() {
  const router = useRouter();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const needle = q.trim();
  const searchable = needle.length >= SEARCH_MIN_CHARS;
  // The list on screen answers an older query while a newer one is in flight.
  const pending = searchable && answer?.q !== needle;

  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          signal: ctrl.signal,
        });
        const data =
          res.status === 429 ? null : ((await res.json()) as SearchResponse);
        setAnswer({ q: needle, data });
        setActive(-1);
      } catch {
        // Aborted (superseded keystroke) or offline — keep the previous list.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [needle, searchable]);

  // `/` focuses the search from anywhere that isn't itself a text field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const data = answer?.data ?? null;
  const shown = answer?.q ?? needle;
  // Every selectable row in display order; `index` drives the arrow keys.
  let n = 0;
  const groups = GROUPS.flatMap((g) => {
    const hits = data?.[g.key] ?? [];
    if (hits.length === 0) return [];
    const groupRows: Row[] = [
      ...hits.map((hit) => ({
        href: `${g.base}/${hit.slug}`,
        hit,
        label: hit.name,
        index: n++,
      })),
      {
        href: `${g.base}?q=${encodeURIComponent(shown)}`,
        hit: null,
        label: `See all ${g.label.toLowerCase()} matching “${shown}” →`,
        index: n++,
      },
    ];
    return [{ ...g, hitCount: hits.length, rows: groupRows }];
  });
  const rows = groups.flatMap((g) => g.rows);
  const hitCount = groups.reduce((sum, g) => sum + g.hitCount, 0);
  const visible = open && searchable && answer !== null;

  useEffect(() => {
    if (active >= 0) {
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, id]);

  /** After a pick: clear and let go, so the next page starts with a quiet header. */
  const reset = () => {
    setQ('');
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
  };

  const onRowClick = (e: MouseEvent) => {
    // A modified click opens elsewhere; this page keeps its search.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    reset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (visible) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return;
      e.preventDefault();
      if (!visible) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) =>
        a < 0 && step < 0
          ? rows.length - 1
          : (a + step + rows.length) % rows.length,
      );
      return;
    }
    if (e.key === 'Enter' && visible && active >= 0 && rows[active]) {
      e.preventDefault();
      router.push(rows[active].href);
      reset();
    }
    // Otherwise Enter submits the form natively, to /companies?q=.
  };

  let status = '';
  if (visible && !pending) {
    if (data === null) status = RATE_LIMITED_MESSAGE;
    else
      status =
        hitCount === 0
          ? 'No matches'
          : `${hitCount} result${hitCount === 1 ? '' : 's'}`;
  }

  return (
    <form
      className="relative ml-auto flex h-[38px] w-80 max-w-[38vw] items-center gap-2 rounded-[9px] border border-line bg-surface px-3 transition-colors focus-within:border-graphite-500 max-md:w-auto max-md:max-w-none max-md:min-w-0 max-md:flex-1"
      role="search"
      action="/companies"
    >
      <span
        className="grid size-[18px] shrink-0 place-items-center rounded border border-line font-mono text-xs text-graphite-500"
        aria-hidden="true"
      >
        /
      </span>
      <input
        ref={inputRef}
        className="min-w-0 flex-1 border-none bg-transparent font-sans text-sm text-ink outline-none placeholder:text-graphite-400"
        type="search"
        name="q"
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
        placeholder="Search companies, investors, people"
        aria-label="Search Capbase"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          visible && active >= 0 ? optionId(active) : undefined
        }
        aria-keyshortcuts="/"
        autoComplete="off"
      />

      <div
        id={listboxId}
        role="listbox"
        aria-label="Search results"
        hidden={!visible}
        className={cn(
          'absolute inset-x-0 top-full z-30 mt-1.5 max-h-[70vh] overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-sm transition-opacity',
          'max-md:fixed max-md:top-15 max-md:mt-0 max-md:rounded-none max-md:border-x-0',
          pending && 'opacity-60',
        )}
      >
        {answer === null ? null : data === null ? (
          <p className="px-3 py-2.5 text-sm text-graphite-600">
            {RATE_LIMITED_MESSAGE}
          </p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-graphite-600">
            No matches for “{shown}”
          </p>
        ) : (
          groups.map((g) => (
            <ul
              key={g.key}
              role="group"
              aria-labelledby={`${id}-${g.key}`}
              className="border-t border-line first:border-t-0"
            >
              <li
                id={`${id}-${g.key}`}
                role="presentation"
                className="px-3 pt-2.5 pb-1 font-mono text-[11px] font-medium tracking-[0.14em] text-graphite-500 uppercase"
              >
                {g.label}
              </li>
              {g.rows.map((row) => (
                <li
                  key={row.href}
                  id={optionId(row.index)}
                  role="option"
                  aria-selected={row.index === active}
                >
                  <Link
                    href={row.href}
                    prefetch={false}
                    tabIndex={-1}
                    // Keep focus in the input through the click.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(row.index)}
                    onClick={onRowClick}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 text-sm',
                      row.hit ? 'text-ink' : 'text-graphite-600',
                      row.index === active && 'bg-paper',
                    )}
                  >
                    {row.hit ? (
                      <>
                        <CompanyLogo
                          name={row.hit.name}
                          domain={row.hit.domain ?? ''}
                          size={22}
                        />
                        <span className="min-w-0 truncate">{row.hit.name}</span>
                        {row.hit.meta ? (
                          <span className="ml-auto max-w-[40%] shrink-0 truncate font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
                            {row.hit.meta}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="truncate">{row.label}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ))
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </form>
  );
}
