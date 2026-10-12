import { NextResponse, type NextRequest } from 'next/server';

import {
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  type SearchResponse,
} from '@repo/api';

import { ApiError, apiFetch } from '@/lib/api';
import { forwardedForHeaders } from '@/lib/client-ip';

const EMPTY: SearchResponse = { companies: [], investors: [], people: [] };

// Client-side search proxy (the API base URL is a server-only env var). Powers
// the header typeahead: one call answers companies, investors and people.
export async function GET(
  req: NextRequest,
): Promise<NextResponse<SearchResponse>> {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < SEARCH_MIN_CHARS) return NextResponse.json(EMPTY);
  try {
    const result = await apiFetch<SearchResponse>(
      `/search?q=${encodeURIComponent(q.slice(0, SEARCH_MAX_CHARS))}`,
      // Uncached and typed into, so it counts against the visitor's search limit.
      { cache: 'no-store', headers: await forwardedForHeaders() },
    );
    return NextResponse.json(result);
  } catch (err) {
    // Pass a 429 through so the dropdown can say so; anything else is just "no results".
    if (err instanceof ApiError && err.status === 429) {
      return NextResponse.json(EMPTY, { status: 429 });
    }
    return NextResponse.json(EMPTY);
  }
}
