import {
  IDENTIFIER_SCHEMES,
  identifierUrl,
  type EntityIdentifierRef,
  type IdentifierScheme,
} from '@repo/api';
import type { EntityIdentifier as DbEntityIdentifier } from '@repo/db';

/** DOMAIN is stored — it is a real match key — but never rendered: the profile
 *  already links the website, and repeating the host as an "identifier" is
 *  noise on the page. */
const HIDDEN_SCHEMES = new Set<IdentifierScheme>(['DOMAIN']);

/** Vocabulary order, so the block reads the same on every profile rather than
 *  in whatever order the rows happened to be written. */
const SCHEME_ORDER = new Map(IDENTIFIER_SCHEMES.map((s, i) => [s, i]));

/** Maps one EntityIdentifier row to the shared type, attaching the issuer's
 *  page. The URL is derived, not stored — one definition, in @repo/api. */
export function toEntityIdentifier(row: DbEntityIdentifier): EntityIdentifierRef {
  const scheme = row.scheme as IdentifierScheme;
  return { scheme, value: row.value, url: identifierUrl(scheme, row.value) };
}

/** The public identifier block for one entity: renderable schemes only, in
 *  vocabulary order. */
export function toEntityIdentifiers(rows: DbEntityIdentifier[]): EntityIdentifierRef[] {
  return rows
    .filter((r) => !HIDDEN_SCHEMES.has(r.scheme as IdentifierScheme))
    .map(toEntityIdentifier)
    .sort(
      (a, b) =>
        (SCHEME_ORDER.get(a.scheme) ?? Number.MAX_SAFE_INTEGER) -
          (SCHEME_ORDER.get(b.scheme) ?? Number.MAX_SAFE_INTEGER) || a.value.localeCompare(b.value),
    );
}
