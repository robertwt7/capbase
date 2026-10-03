import { NextResponse } from 'next/server';

import { API_URL } from '@/lib/api';

// Deep health check: web is serving AND the API answers AND the API can reach
// Postgres (its /health runs SELECT 1). Used by the container healthcheck and
// by the external uptime monitor, so one probe covers the whole request path.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, api: res.status }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, api: 'unreachable' }, { status: 503 });
  }
}
