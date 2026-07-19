import type { Metadata } from 'next';

import { JsonLd } from '@/components/JsonLd';
import { PageContainer, SectionHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description:
    'Is Capbase free? Where does the data come from? How do I contribute or fix company data? Answers to common questions about the open company database.',
  alternates: { canonical: '/faq' },
};

// Single source for the visible page AND the FAQPage JSON-LD — answers stay
// plain strings so the structured data needs no JSX stripping.
const FAQS: { q: string; a: string }[] = [
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
    a: 'Three places: automated ingestion of SEC EDGAR Form D filings (the official US disclosure for private placements), enrichment from Wikidata for notable companies, and community contributions. Every crowdsourced submission is reviewed by a moderator before it appears.',
  },
  {
    q: 'How accurate is the data?',
    a: 'Filed data reflects what companies disclosed to the SEC; Wikidata and community data are moderated but can lag or contain errors. Nothing on Capbase is financial, investment, or legal advice. If you spot an error, propose a change on the company page or email support@capbase.fyi.',
  },
  {
    q: 'How can I contribute or fix data?',
    a: 'Create a free account, then use Contribute to add a company, or the propose-change menu on any profile to correct fields or add rounds, people, and investors. Submissions land in a moderation queue and appear once approved.',
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
    a: 'The project is open source and the data comes from public sources and moderated community contributions. You are welcome to reference it with attribution — just do not scrape at abusive rates. The Terms of Service have the details.',
  },
  {
    q: 'Do you have an API?',
    a: 'Not a public one yet — it is on the roadmap. The site itself runs on an open REST API and the code is open source, so self-hosting is already an option.',
  },
];

export default function FaqPage() {
  return (
    <PageContainer as="main" className="pt-14 pb-20">
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
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
