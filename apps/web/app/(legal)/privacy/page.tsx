import type { Metadata } from 'next';

import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Capbase collects, uses, and protects personal information, framed around the Australian Privacy Principles.',
  alternates: { canonical: '/privacy' },
};

const LAST_UPDATED = '19 July 2026';

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <div className="mt-2 font-mono text-xs text-graphite-500">Last updated: {LAST_UPDATED}</div>

      <h2>1. Who we are</h2>
      <p>
        Capbase (capbase.fyi) is operated by an individual proprietor based in Australia. This
        policy explains how we handle personal information, framed around the Australian Privacy
        Principles (APPs). Contact for anything privacy-related:{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — your name, email address, and password (stored only as a
          bcrypt hash; we never see the plain text).
        </li>
        <li>
          <strong>Contributions</strong> — data you submit to the database and its moderation
          history, linked to your account.
        </li>
        <li>
          <strong>Watchlist</strong> — companies you save to your profile.
        </li>
        <li>
          <strong>Server logs</strong> — IP address, user agent, and request metadata, kept for
          security and debugging.
        </li>
        <li>
          <strong>Analytics data</strong> — aggregate usage statistics via Google Analytics (see
          sections 3–4).
        </li>
      </ul>

      <h2>3. Cookies</h2>
      <ul>
        <li>
          <strong>capbase_token</strong> — an httpOnly authentication cookie set when you sign in.
          Essential for the Service to work; it is not used for tracking.
        </li>
        <li>
          <strong>_ga, _ga_*</strong> — Google Analytics 4 cookies used to measure how the site is
          used (pages visited, approximate location, device type).
        </li>
      </ul>

      <h2>4. Third-party processors</h2>
      <ul>
        <li>
          <strong>Google Analytics 4</strong> — usage analytics. Google processes usage data on our
          behalf; see{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            Google&apos;s privacy policy
          </a>{' '}
          and the{' '}
          <a
            href="https://tools.google.com/dlpage/gaoptout"
            target="_blank"
            rel="noopener noreferrer"
          >
            GA opt-out browser add-on
          </a>
          .
        </li>
        <li>
          <strong>Resend</strong> — sends our transactional email (such as the welcome email) and
          processes your email address to do so.
        </li>
        <li>
          <strong>Clearbit</strong> — company logos are fetched by <em>your browser</em> directly
          from Clearbit&apos;s logo service, which therefore sees your IP address. Requests are
          based on company domains, not on anything identifying you.
        </li>
      </ul>

      <h2>5. How we use personal information</h2>
      <p>
        We use it to operate the Service, moderate contributions, send transactional email, keep
        the Service secure, and understand aggregate usage. We do not sell personal information.
      </p>

      <h2>6. Company data vs personal data</h2>
      <p>
        Capbase profiles describe companies and people in their public, professional capacity —
        founders, executives, investors — using public sources such as regulatory filings and
        Wikidata. If a profile describes you and you want it corrected or removed, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will review the request.
      </p>

      <h2>7. Storage and overseas disclosure</h2>
      <p>
        Our hosting providers and the processors above may store or process data outside Australia
        (including in the United States). Where that happens, we take reasonable steps to ensure it
        is handled consistently with the APPs.
      </p>

      <h2>8. Retention, access, correction, and deletion</h2>
      <p>
        We keep personal information only as long as needed for the purposes above. You can request
        access to, correction of, or deletion of your personal information by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Deleting your account removes your
        personal data; contributions already merged into the database may persist in de-identified
        form.
      </p>

      <h2>9. Complaints</h2>
      <p>
        If you believe we have mishandled your personal information, contact us first at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will respond within a
        reasonable time. If you are not satisfied with our response, you may complain to the Office
        of the Australian Information Commissioner (OAIC) at{' '}
        <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">
          oaic.gov.au
        </a>
        .
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The current version is always published on
        this page with its &ldquo;last updated&rdquo; date.
      </p>
    </>
  );
}
