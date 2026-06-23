// Server-side client for the Capbase NestJS API. All calls run on the server
// (React Server Components / route handlers), so the base URL is a server-only
// env var (not NEXT_PUBLIC_*). Defaults to the local API in dev.

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
    throw new ApiError(res.status, `API ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}
