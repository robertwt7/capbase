import type { UnlockBy } from '@repo/api';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Whether the API withheld `field` from this viewer (its value is blank). */
export const isMasked = (entity: { masked?: string[] } | null | undefined, field: string): boolean =>
  entity?.masked?.includes(field) ?? false;

/** What reveals a withheld field (`maskedUnlock`), signing in when unsaid. */
export const unlockOf = (
  entity: { maskedUnlock?: Record<string, UnlockBy> } | null | undefined,
  field: string,
): UnlockBy => entity?.maskedUnlock?.[field] ?? 'signIn';

/** The stronger unlock of several fields (a node showing more than one). */
export const unlockOfAny = (
  entity: { maskedUnlock?: Record<string, UnlockBy> } | null | undefined,
  fields: string[],
): UnlockBy => (fields.some((f) => isMasked(entity as { masked?: string[] }, f) && unlockOf(entity, f) === 'contribute') ? 'contribute' : 'signIn');

/**
 * A field value, or — when the API withheld it from this viewer — a mono chip
 * in its place: "Sign in", or "Contributors" when only an approved contribution
 * reveals it (`maskedUnlock`). The withheld value is blank in the payload (null,
 * '' or 0), so never render one without asking: a blank total would read as
 * "$0 raised". The chip is `data-nosnippet`: a search snippet must not quote it
 * as the fact.
 */
export function Masked({
  entity,
  field,
  next,
  link,
  children,
}: {
  entity: { masked?: string[]; maskedUnlock?: Record<string, UnlockBy> } | null | undefined;
  field: string;
  /** Where sign-in returns to. */
  next: string;
  /** False inside an element that is already a link (a directory row). */
  link?: boolean;
  children: ReactNode;
}) {
  if (!isMasked(entity, field)) return <>{children}</>;
  return <SignInChip next={next} link={link} unlockBy={unlockOf(entity, field)} />;
}

const chip =
  'inline-flex items-center rounded-full border border-line bg-paper px-2 py-0.5 align-middle font-mono text-[11px] tracking-[0.04em] text-graphite-700 uppercase';

/** The chip on its own, for a value that renders as more than one node. As a
 *  plain label (`link={false}`) inside a row that is itself a link — a link
 *  may not nest another. `contribute` reads "Contributors" and leads to
 *  `/contribute` (which sends a signed-out visitor through sign-in first). */
export function SignInChip({
  next,
  link = true,
  unlockBy = 'signIn',
}: {
  next: string;
  link?: boolean;
  unlockBy?: UnlockBy;
}) {
  const label = unlockBy === 'contribute' ? 'Contributors' : 'Sign in';
  if (!link) {
    return (
      <span data-nosnippet className={chip}>
        {label}
      </span>
    );
  }
  return (
    <Link
      href={unlockBy === 'contribute' ? '/contribute' : `/login?next=${encodeURIComponent(next)}`}
      data-nosnippet
      className={`${chip} transition-colors hover:border-ink hover:text-ink`}
    >
      {label}
    </Link>
  );
}
