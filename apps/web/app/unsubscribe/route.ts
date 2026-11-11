import { apiFetch } from '@/lib/api';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex,nofollow',
  'Content-Security-Policy':
    "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8',
};
const valid = (u: string | null, t: string | null) =>
  !!u && !!t && /^[A-Za-z0-9_-]{1,100}$/.test(u) && /^[a-f0-9]{64}$/i.test(t);
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const u = params.get('u');
  const t = params.get('t');
  const fields = valid(u, t)
    ? `<input type="hidden" name="u" value="${u}"><input type="hidden" name="t" value="${t}">`
    : '';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Stop weekly Capbase email</title></head><body><main><h1>Stop weekly email</h1><p>Confirm to stop weekly Capbase email.</p><form method="post" action="/unsubscribe">${fields}<button type="submit">Unsubscribe</button></form></main></body></html>`,
    { headers },
  );
}
const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Weekly email</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`,
    { status, headers },
  );
/**
 * One-click (RFC 8058: the mail client POSTs `List-Unsubscribe=One-Click` to the URL, token in
 * the query) or the GET page's button (token in the form body). The API answers the same for a
 * valid and an invalid token, so the only outcomes shown here are "done", "this link is
 * incomplete" (a format check, revealing nothing) and "it failed" — never a false "done":
 * a 503 also tells a mail client's one-click that the request did not land.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  let u = params.get('u');
  let t = params.get('t');
  if (!valid(u, t) && Number(request.headers.get('content-length') ?? 0) <= 512) {
    const body = await request.formData().catch(() => null);
    u = String(body?.get('u') ?? '');
    t = String(body?.get('t') ?? '');
  }
  if (!valid(u, t))
    return page(
      'This link is incomplete',
      'Use the unsubscribe link in your latest Capbase email, or turn weekly email off in your account settings.',
      400,
    );
  try {
    await apiFetch('/monitoring/unsubscribe', {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ u, t }),
    });
  } catch {
    return page(
      'Something went wrong',
      'Your request did not go through. Please try the link again in a minute, or turn weekly email off in your account settings.',
      503,
    );
  }
  return page(
    'You won’t get these emails any more',
    'You can enable weekly email again from your account settings.',
  );
}
