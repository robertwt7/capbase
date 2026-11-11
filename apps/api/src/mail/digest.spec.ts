import {
  classifyDigestError,
  digestRetryDelay,
  DIGEST_RETRY_DELAYS,
  DIGEST_MAX_AGE_MS,
} from './digest-retry';
import { renderDigestRows, type SafeHtml } from './digest-rows';
import { fill, loadTemplate, render } from './templates';
import {
  digestUnsubscribeToken,
  validDigestUnsubscribe,
} from '../monitoring/digest-unsubscribe';
import type { MonitorUpdate } from '@repo/api';
describe('weekly digest logic', () => {
  it.each([429, 500, 503])('retries provider status %s', (statusCode) =>
    expect(classifyDigestError({ statusCode }).status).toBe('retry'),
  );
  it.each([400, 401, 403, 422])('fails provider status %s', (statusCode) =>
    expect(classifyDigestError({ statusCode }).status).toBe('failed'),
  );
  it('classifies network/timeouts and idempotency failures', () => {
    expect(classifyDigestError({}).status).toBe('retry');
    expect(
      classifyDigestError({ name: 'concurrent_idempotent_requests' }).status,
    ).toBe('retry');
    expect(
      classifyDigestError({
        name: 'invalid_idempotent_request',
        statusCode: 409,
      }).status,
    ).toBe('failed');
  });
  it('uses the selected backoffs and never schedules beyond six attempts or 23 hours', () => {
    const now = new Date();
    expect([1, 2, 3, 4, 5].map((n) => digestRetryDelay(n, now, now))).toEqual([
      ...DIGEST_RETRY_DELAYS,
    ]);
    expect(digestRetryDelay(6, now, now)).toBeNull();
    expect(
      digestRetryDelay(1, new Date(now.getTime() - DIGEST_MAX_AGE_MS), now),
    ).toBeNull();
  });
  it('requires a branded escaped renderer for markup', () => {
    // @ts-expect-error A string must never satisfy the SafeHtml type.
    const unsafe: SafeHtml = '<script>alert(1)</script>';
    void unsafe;
    const item = {
      id: 'fixture',
      kind: 'match',
      company: { slug: 'safe', name: '<script>"bad" & company' },
      round: null,
      search: { name: '<img src=x>', path: '/companies' },
      observedAt: new Date().toISOString(),
    } as MonitorUpdate;
    const output = render(
      'monitoring-digest',
      loadTemplate('monitoring-digest'),
      {
        ROWS: renderDigestRows([item], 'https://capbase.test'),
        FEED_URL: 'https://capbase.test/profile/updates',
        UNSUBSCRIBE_URL: 'https://capbase.test/unsubscribe?u=fixture&t=token',
      },
    );
    expect(output.html).not.toContain('<script>');
    expect(output.html).not.toContain('<img src=x>');
    expect(output.html).toContain('&#60;script&#62;');
    expect(output.text).toContain('<script>');
    expect(fill('{{{V}}}', { V: '<b>plain</b>' }, true)).toBe(
      '&#60;b&#62;plain&#60;/b&#62;',
    );
  });
  it('mints stable cancellation-only tokens, scoped to their user and secret', () => {
    const token = digestUnsubscribeToken('secret', 'user1');
    expect(validDigestUnsubscribe('secret', 'user1', token)).toBe(true);
    expect(validDigestUnsubscribe('secret', 'user2', token)).toBe(false);
    expect(validDigestUnsubscribe('other', 'user1', token)).toBe(false);
    expect(validDigestUnsubscribe('secret', 'user1', 'bad')).toBe(false);
  });
});
