import type { Metadata } from 'next';

import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms that govern your use of Capbase, the free, crowdsourced company and funding database.',
  alternates: { canonical: '/terms' },
};

const LAST_UPDATED = '19 July 2026';

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <div className="mt-2 font-mono text-xs text-graphite-500">Last updated: {LAST_UPDATED}</div>

      <h2>1. Who we are and your acceptance of these terms</h2>
      {/* If the operator's full legal name should be published, swap it into the
          sentence below at review. */}
      <p>
        Capbase (capbase.fyi, the &ldquo;Service&rdquo;) is operated by an individual proprietor
        based in Australia (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By accessing or
        using the Service you agree to these Terms of Service. If you do not agree, do not use the
        Service.
      </p>

      <h2>2. The service</h2>
      <p>
        Capbase is an open, crowdsourced database of company and funding information — funding
        rounds, investors, people, acquisitions, and exits — aggregated from public sources and
        community contributions. The Service is free to browse.
      </p>

      <h2>3. Accounts</h2>
      <p>
        You may create an account to contribute data and access additional features. You agree to
        provide accurate registration information, to keep your credentials secure, and to accept
        responsibility for activity under your account. We may suspend or terminate accounts used
        to abuse the Service, submit false data, or breach these terms.
      </p>

      <h2>4. User contributions</h2>
      <p>
        When you submit content to Capbase — a company, a funding round, a person, a correction, or
        anything else — you grant us a perpetual, worldwide, royalty-free licence to host, display,
        adapt, and redistribute that contribution as part of the database. You warrant that you
        have the right to submit the information and that it does not, to your knowledge, infringe
        anyone else&apos;s rights or any confidentiality obligation.
      </p>
      <p>
        All contributions pass through moderation. We may edit, reject, or remove any contribution
        at any time, for any reason, without notice.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>scrape or bulk-download the Service at rates that degrade it for others;</li>
        <li>submit false, misleading, or defamatory data;</li>
        <li>impersonate any person or organisation;</li>
        <li>use the Service for any unlawful purpose or in breach of any applicable law.</li>
      </ul>

      <h2>6. Data disclaimer</h2>
      <p>
        Information on Capbase is aggregated from public sources (including SEC EDGAR filings and
        Wikidata) and community submissions, and is provided &ldquo;as is&rdquo; for general
        information only. It is <strong>not</strong> financial, investment, or legal advice, and we
        make no warranty that it is accurate, complete, or current. Verify anything important
        against primary sources before relying on it. Corrections are welcome at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>7. Third-party content and links</h2>
      <p>
        The Service links out to third-party websites and displays company logos served by
        third-party providers (such as Clearbit) and attributions to original data sources. We do
        not control and are not responsible for third-party sites or content.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We aim to keep the Service available but give no uptime guarantee. Features may change,
        be suspended, or be withdrawn at any time.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the maximum extent permitted by law, we exclude all liability for any loss or damage
        arising from your use of, or inability to use, the Service or its data. Nothing in these
        terms excludes, restricts, or modifies any consumer guarantee, right, or remedy under the
        Australian Consumer Law or other legislation that cannot lawfully be excluded; to the
        extent such a guarantee applies and liability may be limited, our liability is limited, at
        our option, to resupplying the Service or paying the cost of having it resupplied.
      </p>

      <h2>10. Termination, changes to these terms, severability</h2>
      <p>
        We may suspend or terminate your access for breach of these terms. We may update these
        terms from time to time; the current version is always published on this page with its
        &ldquo;last updated&rdquo; date, and continued use after a change constitutes acceptance.
        If any provision is found unenforceable, the remainder continues in force.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of Australia, and you submit to the non-exclusive
        jurisdiction of the courts of Australia.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </>
  );
}
