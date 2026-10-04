import { NextResponse, type NextRequest } from 'next/server';

import type { Company, Paginated } from '@repo/api';

import { apiFetch } from '@/lib/api';
import { forwardedForHeaders } from '@/lib/client-ip';

/** Companies the search matched, trimmed to picker-sized facts. */
export interface CompanySearchHit {
  slug: string;
  name: string;
  domain: string;
}

const LIMIT = 10;

// Client-side search proxy (the API base URL is a server-only env var). Powers
// the compare-page picker; returns a small name-matched sample, never a page
// of the full directory.
export async function GET(req: NextRequest): Promise<NextResponse<CompanySearchHit[]>> {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json([]);
  try {
    const result = await apiFetch<Paginated<Company>>(
      `/companies?q=${encodeURIComponent(q)}&pageSize=${LIMIT}`,
      // Uncached and typed into, so it counts against the visitor's search limit.
      { cache: 'no-store', headers: await forwardedForHeaders() },
    );
    return NextResponse.json(
      result.items.map(({ slug, name, domain }) => ({ slug, name, domain })),
    );
  } catch {
    return NextResponse.json([]);
  }
}
