import { headers } from 'next/headers';

/** An IPv4/IPv6 literal, and nothing that could smuggle anything else into a header. */
const IP = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The visitor's IP as an `X-Forwarded-For` header for the API, so its throttler
 * (apps/api/src/throttle) limits this visitor rather than the web container.
 *
 * Read from `X-Real-IP`, which nginx sets from `$remote_addr` and overwrites on
 * every request, so a client can't choose it. Behind Cloudflare, nginx's realip
 * config (infra/nginx/conf.d/cloudflare-realip.conf) has already swapped the
 * Cloudflare edge address for the visitor's. Without nginx (local dev) there is
 * no header and nothing is forwarded.
 *
 * Only for uncached requests: the value is part of Next's fetch-cache key, and
 * reading request headers opts a render out of static caching.
 */
export async function forwardedForHeaders(): Promise<Record<string, string>> {
  let ip: string | null = null;
  try {
    ip = (await headers()).get('x-real-ip');
  } catch {
    // Outside a request (a build-time render): there is no visitor.
    return {};
  }
  return ip && IP.test(ip) ? { 'x-forwarded-for': ip } : {};
}
