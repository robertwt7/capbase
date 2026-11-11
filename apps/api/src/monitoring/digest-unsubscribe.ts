import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
export function digestUnsubscribeToken(secret: string, userId: string): string {
  const key = Buffer.from(
    hkdfSync('sha256', secret, 'capbase', 'digest-unsubscribe', 32),
  );
  return createHmac('sha256', key).update(userId).digest('hex');
}
export function validDigestUnsubscribe(
  secret: string,
  userId: unknown,
  token: unknown,
): userId is string {
  if (
    typeof userId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(userId) ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(token)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(digestUnsubscribeToken(secret, userId), 'hex'),
    Buffer.from(token, 'hex'),
  );
}
export function digestUnsubscribeUrl(
  siteUrl: string,
  secret: string,
  userId: string,
): string {
  const url = new URL('/unsubscribe', siteUrl);
  url.search = new URLSearchParams({
    u: userId,
    t: digestUnsubscribeToken(secret, userId),
  }).toString();
  return url.toString();
}
