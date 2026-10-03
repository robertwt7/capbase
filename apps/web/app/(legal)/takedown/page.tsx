import type { Metadata } from 'next';
import Link from 'next/link';

import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Takedown & removal policy',
  description:
    'How to report a problem with a Capbase profile, ask for personal data to be removed, or send a copyright notice — and how quickly we respond.',
  alternates: { canonical: '/takedown' },
};

const LAST_UPDATED = '3 October 2026';

export default function TakedownPage() {
  return (
    <>
      <h1>Takedown &amp; removal policy</h1>
      <div className="mt-2 font-mono text-xs text-graphite-500">
        Last updated: {LAST_UPDATED}
      </div>

      <h2>1. How to reach us</h2>
      <p>
        The fastest route is the <strong>Report an issue</strong> link at the
        foot of every company, investor and person profile. It needs no account,
        and it reaches the admin queue directly. You can also email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p>Either way, please include:</p>
      <ul>
        <li>
          the address of the page (for example, capbase.fyi/people/jane-smith);
        </li>
        <li>what is wrong, or what you want removed, and why;</li>
        <li>
          your relationship to it — the person described, someone acting for a
          company, a copyright owner or their agent;
        </li>
        <li>a way to reach you, if you want a reply.</li>
      </ul>

      <h2>2. What we remove</h2>
      <ul>
        <li>
          <strong>Personal data about you, on request.</strong> If a person
          profile describes you, we will hide that profile. The underlying
          public records it was built from — regulatory filings, for example —
          stay where they are; we stop republishing them about you.
        </li>
        <li>
          <strong>Material we are legally required to remove</strong>, including
          content that is the subject of a valid copyright notice (section 5).
        </li>
        <li>
          <strong>Contributions made in breach of our terms</strong> — for
          example, data copied from a proprietary database whose terms forbid
          sharing it (see <Link href="/terms">Terms of Service, section 4</Link>
          ).
        </li>
      </ul>

      <h2>3. What we keep</h2>
      <p>
        Capbase republishes facts drawn from public government records (SEC
        EDGAR, SBIR.gov) and openly licensed sources (Wikidata) about companies,
        funds, and people acting in a professional capacity. When one of those
        facts is wrong or out of date, we <strong>correct</strong> it rather
        than delete it — please tell us what it should say and, if you can, link
        a source that shows it. See <Link href="/data">Data &amp; sources</Link>{' '}
        for where our data comes from.
      </p>

      <h2>4. Response times</h2>
      <ul>
        <li>
          We acknowledge every report or notice that includes contact details
          within <strong>5 business days</strong>.
        </li>
        <li>
          Requests to remove personal data about you are actioned within{' '}
          <strong>30 days</strong> (see{' '}
          <Link href="/privacy">Privacy Policy, section 8</Link>).
        </li>
        <li>Legal and copyright notices are acted on expeditiously.</li>
      </ul>

      <h2>5. Copyright notices (DMCA)</h2>
      <p>
        If you believe material on Capbase infringes your copyright, send a
        written notice to our designated agent that includes:
      </p>
      <ul>
        <li>your physical or electronic signature;</li>
        <li>the copyrighted work you say is infringed;</li>
        <li>
          the material you say is infringing, and where it is on Capbase (the
          page address is enough);
        </li>
        <li>your name, postal address, telephone number and email address;</li>
        <li>
          a statement that you believe in good faith the use is not authorised
          by the copyright owner, its agent, or the law;
        </li>
        <li>
          a statement, under penalty of perjury, that the information in your
          notice is accurate and that you are the copyright owner or authorised
          to act for them.
        </li>
      </ul>
      <p>
        If material you contributed is removed after a notice and you believe
        that was a mistake, you may send a counter-notice to the same address.
        It must identify the removed material and where it appeared, include a
        statement under penalty of perjury that you believe it was removed by
        mistake or misidentification, your name, address and telephone number,
        your consent to the jurisdiction of the appropriate court, and your
        signature. We forward valid counter-notices to the person who sent the
        original notice.
      </p>
      {/* TODO(manual): register the DMCA designated agent with the US Copyright Office
          (copyright.gov/dmca-directory) and replace this paragraph with the agent's name,
          postal address, phone and email. */}
      <p>
        <strong>Designated agent:</strong> registration in progress — until it
        is complete, send notices to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>6. Contributions and attestation</h2>
      <p>
        Every community contribution passes through moderation, and every
        contributor confirms, on each submission, that they have the right to
        share it and are not copying it from a database whose terms forbid that.
        Contributions found to break that promise are removed. See{' '}
        <Link href="/terms">Terms of Service, section 4</Link>.
      </p>
    </>
  );
}
