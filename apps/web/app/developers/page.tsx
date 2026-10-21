import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  API_KEY_DAILY_LIMITS,
  API_KEY_LIMITS,
  API_KEY_PREFIX,
  EMAIL_UNVERIFIED,
  MAX_ACTIVE_API_KEYS,
  MAX_API_KEY_CIDRS,
  MAX_PAGE_SIZE,
  MAX_PENDING_API_SUBMISSIONS,
  MAX_V1_LIST_DEPTH,
  MFA_REQUIRED,
} from '@repo/api';

import { Button, buttonVariants, PageContainer, SectionHeader } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { canonical } from '@/lib/metadata';
import { SITE_URL, SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Developers — The Capbase API',
  description:
    'Read Capbase and contribute companies, funding rounds, people and edits through a key-authenticated REST API with OpenAPI docs.',
  ...canonical('/developers'),
};

const H2 = 'font-display text-xl font-bold tracking-tight text-ink';
const P = 'mt-3 text-base leading-[1.65] text-graphite-900';
const LINK = 'text-ink underline underline-offset-[3px]';
const TH =
  'px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.06em] text-graphite-500 uppercase';
const TD = 'px-4 py-2.5 align-top text-[14px] text-graphite-900';

/** A code sample: mono on the surface, no syntax colour. */
function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-sm border border-line bg-surface px-4 py-3 font-mono text-[13px] leading-[1.6] text-ink">
      {children}
    </pre>
  );
}

/** Inline code. */
function C({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">{children}</code>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[520px] text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? `${TD} font-mono text-[13px] text-ink` : TD}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DevelopersPage() {
  const docs = `${SITE_URL}/v1/docs`;
  const limits = API_KEY_LIMITS;
  const daily = API_KEY_DAILY_LIMITS;

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader as="h1" title="The Capbase API" note="Version 1" />

      {/* minmax(0,1fr): a long code sample scrolls inside its <pre> instead of widening the page. */}
      <div className="mt-7 grid max-w-[74ch] grid-cols-[minmax(0,1fr)] gap-10">
        <p className="text-base leading-[1.65] text-graphite-900">
          A small REST API at <C>{SITE_URL}/v1</C> for reading Capbase and adding data to it through
          the same moderation and citation rules as the website. Every endpoint, with its parameters
          and request bodies, is in the{' '}
          <a href={docs} className={LINK}>
            interactive reference
          </a>
          ; this page explains how it behaves.
        </p>

        <section>
          <h2 className={H2}>Getting a key</h2>
          <p className={P}>
            API access is granted by Capbase admins: ask at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK}>
              {SUPPORT_EMAIL}
            </a>{' '}
            and say what you plan to add. Once your account is a contributor, create keys on{' '}
            <Link href="/profile/api-keys" className={LINK}>
              your API keys page
            </Link>
            . A key belongs to you — everything it submits is attributed to your account — and you
            can hold up to {MAX_ACTIVE_API_KEYS} at once. Its secret is shown once, when you create
            it; Capbase stores only a hash. Keys start with <C>{API_KEY_PREFIX}</C>, so a leaked one
            is easy to search for. Revoke it on the same page.
          </p>
        </section>

        <section>
          <h2 className={H2}>Authentication</h2>
          <p className={P}>Send the key as a bearer token on every request:</p>
          <Code>{`curl ${SITE_URL}/v1/me \\\n  -H "Authorization: Bearer ${API_KEY_PREFIX}…"`}</Code>
          <p className={P}>
            <C>GET /v1/me</C>{' '}answers with the key&apos;s owner, its scope and how many of your
            submissions are waiting for review. A key works only on <C>/v1</C>; the website&apos;s
            own routes don&apos;t accept it.
          </p>
        </section>

        <section>
          <h2 className={H2}>Scopes</h2>
          <p className={P}>
            A key&apos;s scope is a ceiling on your account&apos;s role. If an admin changes your
            role, keys the new role doesn&apos;t allow stop working at once.
          </p>
          <Table
            head={['Scope', 'Who can create it', 'What it can do']}
            rows={[
              [
                'contributor',
                'Contributors and admins',
                'Read everything. Add companies, rounds, people, investors, acquisitions, exits and diversity signals; propose edits to companies and investor firms. Every write waits in the moderation queue.',
              ],
              [
                'admin',
                'Admins',
                'The same writes, published immediately — exactly as if approved in the queue. Plus list, approve and reject submissions.',
              ],
            ]}
          />
          <p className={P}>
            No key can delete, merge, ban or change roles. Those stay on the website.
          </p>
        </section>

        <section>
          <h2 className={H2}>Rate limits</h2>
          <p className={P}>
            Limits are per account: every key you hold, and every route, share one budget — one
            for reads, one for writes, and a daily total for both. Every address also has its own
            limit at the edge, so one busy script doesn&apos;t slow anyone else&apos;s.
          </p>
          <Table
            head={['Scope', 'Reads / min', 'Writes / min', 'Requests / day']}
            rows={[
              [
                'contributor',
                formatCount(limits.contributor.read),
                formatCount(limits.contributor.write),
                formatCount(daily.contributor),
              ],
              [
                'admin',
                formatCount(limits.admin.read),
                formatCount(limits.admin.write),
                formatCount(daily.admin),
              ],
            ]}
          />
          <p className={P}>
            The daily total is a rolling 24 hours: each request stops counting a day after you made
            it, so a spent quota frees up gradually rather than at midnight. Every response carries
            the per-minute budget in <C>X-RateLimit-Limit</C> / <C>X-RateLimit-Remaining</C> and
            the daily one in <C>X-RateLimit-Limit-daily</C> /{' '}
            <C>X-RateLimit-Remaining-daily</C>.
          </p>
          <p className={P}>
            Over either limit you get <C>429</C> with a <C>Retry-After</C> header (seconds). Wait
            that long, then carry on; there is no penalty beyond the wait.
          </p>
        </section>

        <section>
          <h2 className={H2}>Lists</h2>
          <p className={P}>
            <C>/v1/companies</C>, <C>/v1/investors</C>, <C>/v1/people</C> and <C>/v1/funds</C>{' '}
            take <C>page</C> and <C>pageSize</C> (up to {formatCount(MAX_PAGE_SIZE)} rows a page),
            and stop at row {formatCount(MAX_V1_LIST_DEPTH)}: a page past it (<C>page × pageSize</C>)
            is a <C>400</C>. The API is for finding and adding specific records, not for copying a
            directory — use <C>q</C>, a filter, or <C>domain</C> to find what you need.
          </p>
        </section>

        <section>
          <h2 className={H2}>IP allowlist</h2>
          <p className={P}>
            When you create a key you can list up to {MAX_API_KEY_CIDRS} addresses or CIDR ranges (
            <C>203.0.113.7</C>, <C>198.51.100.0/24</C>, IPv6 too). A request from anywhere else gets{' '}
            <C>403</C>, even with the right secret. Leave the list empty to allow any address. For a
            key that runs on a server, an allowlist turns a leak into a non-event.
          </p>
        </section>

        <section>
          <h2 className={H2}>Writing data</h2>
          <p className={P}>
            Writes take the same JSON as the website&apos;s forms; the reference shows every field.
            Three rules apply to all of them:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-[1.65] text-graphite-900">
            <li>
              <C>&quot;attested&quot;: true</C>{' '}is required — your confirmation that you have the
              right to share the data (
              <Link href="/terms" className={LINK}>
                Terms §4
              </Link>
              ). Without it the request is a <C>400</C>.
            </li>
            <li>
              Send <C>sourceUrl</C> whenever you can: the filing, press release or page the fact
              comes from. It becomes the citation readers see, and moderators check it first.
            </li>
            <li>
              Check before creating. <C>GET /v1/companies?domain=example.com</C> matches a
              company&apos;s website host exactly (a scheme, <C>www.</C> or path is ignored), so you
              can skip companies that already exist and add to them instead.
            </li>
          </ul>
          <Code>{`curl -X POST ${SITE_URL}/v1/companies/helia/rounds \\
  -H "Authorization: Bearer ${API_KEY_PREFIX}…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Series B",
    "date": "2025-06-01",
    "amountUsd": 40000000,
    "investors": [{ "name": "Example Ventures", "lead": true }],
    "sourceUrl": "https://example.com/press/series-b",
    "attested": true
  }'`}</Code>
          <p className={P}>
            With a contributor key the response says{' '}
            <C>&quot;moderationStatus&quot;: &quot;PENDING&quot;</C>: the row is in the moderation
            queue and appears publicly once approved, and you get the usual email when it is
            decided. You can have up to {formatCount(MAX_PENDING_API_SUBMISSIONS)} submissions
            waiting at once; past that, writes answer <C>429</C> until some are reviewed. With an
            admin key the response says <C>APPROVED</C> and the row is live.
          </p>
          <p className={P}>
            Edits to an investor firm (<C>POST /v1/investors/:slug/proposals</C>) send only the
            fields to change. A firm that comes from SEC Form ADV or Wikidata may have some fields
            re-set by the next import from that source.
          </p>
        </section>

        <section>
          <h2 className={H2}>Errors</h2>
          <p className={P}>
            Errors are JSON with a <C>statusCode</C> and a <C>message</C> (a list, for validation
            errors, with one entry per problem).
          </p>
          <Table
            head={['Status', 'Meaning']}
            rows={[
              [
                '400',
                'The body or query failed validation, including a missing attestation, an edit that changes nothing, or a list page past the depth limit.',
              ],
              [
                '401',
                'No key, an unknown or revoked key, or a key your account can no longer hold.',
              ],
              [
                '403',
                <>
                  The address is outside the key&apos;s allowlist, the route needs an admin key,
                  your email is unverified (<C>code: &quot;{EMAIL_UNVERIFIED}&quot;</C>), or your
                  account has no two-factor authentication (<C>code: &quot;{MFA_REQUIRED}&quot;</C>
                  — turn it on in your account settings and the key works again).
                </>,
              ],
              ['404', 'No public company, investor or person has that slug.'],
              [
                '301',
                <>
                  The profile was merged into another. The body&apos;s <C>slug</C> names the
                  survivor; read and write there instead.
                </>,
              ],
              ['409', 'A conflict, such as creating a key past the limit.'],
              [
                '429',
                <>
                  Over a rate limit, the daily quota or the pending cap. Honour{' '}
                  <C>Retry-After</C>.
                </>,
              ],
            ]}
          />
        </section>

        <section className="flex flex-wrap items-center gap-3 rounded-[10px] border border-ink bg-surface px-[18px] py-5">
          <p className="min-w-[24ch] flex-1 text-sm leading-[1.6] text-graphite-700">
            Every endpoint, parameter and body is in the reference, and you can try calls there with
            your key.
          </p>
          <span className="flex flex-wrap gap-3">
            {/* A plain link: /v1/docs is served by the API, not a Next route. */}
            <a
              href={docs}
              className={buttonVariants({ variant: 'primary', shape: 'pill', size: 'sm' })}
            >
              API reference
            </a>
            <Button variant="outline" shape="pill" size="sm" href="/profile/api-keys">
              Your API keys
            </Button>
          </span>
        </section>
      </div>
    </PageContainer>
  );
}
