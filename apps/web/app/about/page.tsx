import type { Metadata } from 'next';
import Link from 'next/link';

import { Button, PageContainer, SectionHeader } from '@/components/ui';
import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About — Open, Crowdsourced Company Data',
  description:
    'Capbase is an open company database: free startup funding data aggregated from SEC EDGAR filings, Wikidata, and moderated community contributions.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader as="h1" title="About Capbase" note="Open source" />

      <div className="mt-7 grid max-w-[70ch] gap-10">
        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            An open alternative to closed deal databases
          </h2>
          <p className="mt-3 text-base leading-[1.65] text-graphite-900">
            Who funds the private economy shouldn&apos;t be a trade secret. Capbase is a free,
            crowdsourced company database — funding rounds, investors, people, acquisitions, and
            exits for the companies shaping each sector. The incumbents lock this information
            behind subscriptions and seat licences; Capbase publishes it in the open, free to
            read and free to build on.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Where the data comes from
          </h2>
          <p className="mt-3 text-base leading-[1.65] text-graphite-900">
            Three streams feed the database. First, automated ingestion of{' '}
            <span className="font-medium text-ink">SEC EDGAR Form D filings</span> — the official
            disclosure US companies file when they raise a private placement — which gives every
            round a verifiable, on-the-record source. Second,{' '}
            <span className="font-medium text-ink">Wikidata enrichment</span> for notable
            companies: websites, headquarters, sectors, investors, founders, and exits. Third,{' '}
            <span className="font-medium text-ink">community contributions</span> — the
            crowdsourced layer that fills in what filings never capture.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Moderation keeps it trustworthy
          </h2>
          <p className="mt-3 text-base leading-[1.65] text-graphite-900">
            Crowdsourced doesn&apos;t mean unchecked. Every community submission — a new company, a
            funding round, a correction — enters a moderation queue and is reviewed before it
            appears publicly. Automated ingestion from official sources is keyed to the original
            filings, so re-runs update records instead of duplicating them. Spotted something
            wrong anyway? Every profile has a propose-change flow, and{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-ink underline underline-offset-[3px]"
            >
              {SUPPORT_EMAIL}
            </a>{' '}
            reaches a human.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Contribute to unlock
          </h2>
          <p className="mt-3 text-base leading-[1.65] text-graphite-900">
            Browsing is free and needs no account. Deep profile sections show a preview until you
            give something back: any approved contribution unlocks every full profile for 30
            days. No paywall, no credit card — the currency is data. It&apos;s how an open company
            database stays both free and alive.
          </p>
        </section>

        <section className="flex flex-wrap items-center gap-3 rounded-[10px] border border-ink bg-surface px-[18px] py-5">
          <p className="min-w-[24ch] flex-1 text-sm leading-[1.6] text-graphite-700">
            Know a company, a round, or a correction that belongs here? The database is built by
            people like you.
          </p>
          <span className="flex flex-wrap gap-3">
            <Button variant="primary" shape="pill" size="sm" href="/contribute">
              Contribute
            </Button>
            <Button variant="outline" shape="pill" size="sm" href="/companies">
              Browse companies
            </Button>
          </span>
        </section>

        <p className="font-mono text-xs text-graphite-500">
          Questions? See the{' '}
          <Link href="/faq" className="underline underline-offset-[3px] hover:text-ink">
            FAQ
          </Link>{' '}
          or write to {SUPPORT_EMAIL}.
        </p>
      </div>
    </PageContainer>
  );
}
