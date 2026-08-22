import { Prisma } from './generated/prisma/client';

/**
 * A value ready to store in a nullable Json column. Prisma distinguishes a
 * JSON `null` (a recorded null value) from SQL NULL ("nothing recorded"), so a
 * genuine null must be written as `Prisma.JsonNull`, not bare `null`.
 */
export type JsonColumnValue = Prisma.InputJsonValue | typeof Prisma.JsonNull;

/**
 * Convert an arbitrary column value into something a Json column accepts.
 *
 * `BigInt` (every money column) and `Date` both throw or serialise badly under
 * `JSON.stringify`, so they are converted the same way the API mappers already
 * do it — BigInt via `Number()`, Date via ISO string. Nested values inside
 * arrays and objects are converted too; only a top-level null becomes
 * `Prisma.JsonNull` (inside a structure, `null` is a perfectly good JSON value).
 */
export function toJsonValue(value: unknown): JsonColumnValue {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return toJsonSafe(value) as Prisma.InputJsonValue;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = toJsonSafe(v);
    return out;
  }
  return value;
}
