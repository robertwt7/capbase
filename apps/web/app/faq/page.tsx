import type { Metadata } from 'next';
import Link from 'next/link';
import { MAX_PENDING_SUBMISSIONS } from '@repo/api';

import { JsonLd } from '@/components/JsonLd';
import { PageContainer, SectionHeader } from '@/components/ui';
import { canonical } from '@/lib/metadata';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description:
    'Is Capbase free? Where does the data come from? How do I contribute or fix company data? Answers to common questions about the open company database.',
  ...canonical('/faq'),
};

// Single source for the visible page AND the FAQPage JSON-LD — answers stay
// plain strings so the structured data needs no JSX stripping. An optional
// `link` renders after the visible answer only.
const FAQS: { q: string; a: string; link?: { href: string; label: string } }[] = [
  {
    q: 'What is Capbase?',
    a: 'Capbase is a free, open-source database of private companies: funding rounds, investors, people, acquisitions, and exits. It is a crowdsourced alternative to closed deal databases like Crunchbase and PitchBook, built on public sources and community contributions.',
  },
  {
    q: 'Is Capbase really free?',
    a: 'Yes. Browsing companies, funding data, and market stats is free and requires no account. Deeper profile sections show a preview until you contribute — any approved contribution unlocks every full profile for 30 days, and that costs nothing either.',
  },
  {
    q: 'Is Capbase an alternative to Crunchbase or PitchBook?',
    a: 'For the core questions — who raised, from whom, and when — yes, without paywalls or seat licences. If you need institutional research features like bulk exports, valuations analysis, or CRM integrations, a paid platform may still fit better. See our comparisons at /alternatives/crunchbase and /alternatives/pitchbook.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Three places: automated ingestion of public US government records (SEC EDGAR Form D, Form C, Form S-1 and Form ADV filings, and SBIR.gov research awards), enrichment from Wikidata for notable companies, and community contributions. Every crowdsourced submission is reviewed by a moderator before it appears, and every published fact links to its source.',
    link: { href: '/data', label: 'Every source and its terms' },
  },
  {
    q: 'How accurate is the data?',
    a: 'Filed data reflects what companies disclosed to the SEC; Wikidata and community data are moderated but can lag or contain errors. Nothing on Capbase is financial, investment, or legal advice. If you spot an error, propose a change on the company page or email support@capbase.fyi.',
  },
  {
    q: 'How can I contribute or fix data?',
    a: `Create a free account, then use Contribute to add a company, or the propose-change menu on any profile to correct fields or add rounds, people, and investors. Submissions land in a moderation queue and appear once approved; we email you when a moderator approves or declines one. You can have up to ${MAX_PENDING_SUBMISSIONS} awaiting review at a time.`,
  },
  {
    q: 'What does "contribute to unlock" mean?',
    a: 'Visitors who have not contributed recently see a preview of each profile section rather than the full lists. Making any contribution — a company, a funding round, a correction — unlocks complete profiles for 30 days. It keeps the database growing without charging anyone.',
  },
  {
    q: "How do I correct or remove my company's information?",
    a: 'Email support@capbase.fyi, ideally from a company address, and we will review corrections or removal requests. Profiles describe companies and public figures using public sources; we take accuracy requests seriously.',
  },
  {
    q: 'Can I use Capbase data in my own project?',
    a: 'Yes, for non-commercial use. The Capbase database is licensed under Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0): credit "Capbase (capbase.fyi)", link to the licence, and say if you changed anything. Facts taken directly from SEC filings and SBIR.gov are public domain, and Wikidata is CC0, so those are yours to use from the original source. For commercial use of the database, email support@capbase.fyi. The code is open source under the AGPL-3.0. Please do not scrape at abusive rates.',
    link: { href: '/data', label: 'Data licence and how to cite' },
  },
  {
    q: 'Do you have an API?',
    a: 'Not a public one yet — it is on the roadmap. The site itself runs on an open REST API and the code is open source, so self-hosting is already an option.',
  },
];

export default function FaqPage() {
  return (
    <PageContainer className="pt-14 pb-20">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        }}
      />

      <SectionHeader as="h1" title="Frequently asked questions" note={`${FAQS.length} answers`} />

      <div className="mt-7 grid max-w-[70ch] gap-4">
        {FAQS.map((faq) => (
          <section
            key={faq.q}
            className="rounded-[10px] border border-line bg-surface px-[18px] py-5"
          >
            <h2 className="font-display text-base font-semibold tracking-tight text-ink">
              {faq.q}
            </h2>
            <p className="mt-2 text-sm leading-[1.65] text-graphite-700">{faq.a}</p>
            {faq.link ? (
              <Link
                href={faq.link.href}
                className="mt-3 inline-block font-mono text-xs text-graphite-500 underline underline-offset-[3px] transition-colors hover:text-ink"
              >
                {faq.link.label} →
              </Link>
            ) : null}
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
