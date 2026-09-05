// Server-side client for the Capbase NestJS API. All calls run on the server
// (React Server Components / route handlers), so the base URL is a server-only
// env var (not NEXT_PUBLIC_*). Defaults to the local API in dev.

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** The parsed error body, when the API sent one. A 301 carries the
     *  survivor's slug here rather than in a Location header — see apiFetch. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch JSON from the API. Public reads default to a 60s ISR window; callers
 * needing fresh/authed data pass `{ cache: 'no-store' }` (or their own `next`).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const hasCacheOverride = init?.cache !== undefined || 'next' in (init ?? {});
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...(hasCacheOverride ? {} : { next: { revalidate: 60 } }),
  });

  if (!res.ok) {
    // Guarded: an error body is not guaranteed to be JSON (a proxy's HTML 502
    // page, an empty response), and failing to parse it must not replace the
    // real status with a syntax error.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, `API ${path} responded ${res.status}`, body);
  }
  return (await res.json()) as T;
}
