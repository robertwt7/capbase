import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { canonical } from '@/lib/metadata';
import { DATA_LICENSE_URL, SOURCE_URL, SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Data & Sources',
  description:
    'Where Capbase data comes from — SEC EDGAR, SBIR.gov, Wikidata and community contributions — the terms each source carries, the CC BY-NC 4.0 data licence, and how to cite Capbase.',
  ...canonical('/data'),
};

const LAST_UPDATED = '3 October 2026';

// One entry per ingested source. Keep in step with apps/jobs/src/sources/ —
// a new source is not live until it is listed here with its terms.
const SOURCES: { name: string; tag: string; covers: string; terms: ReactNode }[] = [
  {
    name: 'SEC EDGAR — Form D',
    tag: 'SEC',
    covers:
      'Private placements: issuers, offering sizes, amounts sold, executives and directors, and pooled-fund vintages and sizes.',
    terms: <SecTerms />,
  },
  {
    name: 'SEC EDGAR — Form C (Regulation Crowdfunding)',
    tag: 'SEC',
    covers:
      'Crowdfunding issuers, their offerings, signing officers, and amounts raised read from progress updates.',
    terms: <SecTerms />,
  },
  {
    name: 'SEC EDGAR — Form S-1',
    tag: 'SEC',
    covers: 'Principal-stockholder tables naming the firms that own a company about to go public.',
    terms: <SecTerms />,
  },
  {
    name: 'SEC — Form ADV and Schedule D',
    tag: 'SEC',
    covers:
      'Registered investment advisers (the investor directory) and the private funds they manage, with strategy and gross asset value.',
    terms: <SecTerms />,
  },
  {
    name: 'SBIR.gov',
    tag: 'GOV',
    covers: 'Federal SBIR/STTR research awards and the companies that won them.',
    terms: (
      <>
        Published by the US Small Business Administration. A work of the US federal government,
        in the public domain in the United States.
      </>
    ),
  },
  {
    name: 'Wikidata',
    tag: 'WD',
    covers:
      'Websites, headquarters, sectors, investors, founders, chief executives, acquisitions and exits for notable companies and investment firms.',
    terms: (
      <>
        Structured data in Wikidata is dedicated to the public domain under{' '}
        <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>.
      </>
    ),
  },
];

function SecTerms() {
  return (
    <>
      Filed with the US Securities and Exchange Commission. Works of the US federal government
      and the filings it publishes are not subject to copyright restriction; we fetch them under
      the SEC&apos;s{' '}
      <a href="https://www.sec.gov/os/accessing-edgar-data">fair-access policy</a> (a declared
      user agent, at most 10 requests a second).
    </>
  );
}

export default function DataPage() {
  return (
    <>
      <h1>Data &amp; sources</h1>
      <div className="mt-2 font-mono text-xs text-graphite-500">Last updated: {LAST_UPDATED}</div>

      <p>
        Capbase combines public filings, open datasets and moderated community contributions. Every
        published fact carries a bracketed marker naming its source — <code>[SEC]</code>,{' '}
        <code>[GOV]</code>, <code>[WD]</code> and so on — that links to the primary document. A
        fact with no source shows a muted em dash instead, so a filing and an unsourced
        contribution never look alike.
      </p>

      <h2>Ingested sources</h2>
      <p>
        These are loaded automatically from official or open sources and published without manual
        review.
      </p>
      {SOURCES.map((source) => (
        <section key={source.name} className="mt-6 border-t border-line pt-4">
          <h3 className="flex items-baseline justify-between gap-4 font-display text-base font-semibold tracking-tight text-ink">
            {source.name}
            <span className="shrink-0 font-mono text-[11px] font-normal tracking-[0.08em] text-graphite-500">
              [{source.tag}]
            </span>
          </h3>
          <p>{source.covers}</p>
          <p>
            <span className="font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
              Terms{' '}
            </span>
            {source.terms}
          </p>
        </section>
      ))}

      <h2>Community contributions</h2>
      <p>
        Companies, funding rounds, people, investors, acquisitions, exits and corrections submitted
        by Capbase users. Every submission is reviewed by a moderator before it appears.
        Contributors grant Capbase a broad licence to what they submit and confirm they are not
        copying from a database whose terms forbid it — see section 4 of the{' '}
        <Link href="/terms">Terms of Service</Link>.
      </p>

      <h2>Licence</h2>
      <p>
        The Capbase database — the compilation, and the community-contributed records in it — is
        licensed under{' '}
        <a href={DATA_LICENSE_URL} rel="license">
          Creative Commons Attribution-NonCommercial 4.0
        </a>{' '}
        (CC BY-NC 4.0). You may copy, share and adapt it for non-commercial purposes with
        attribution.
      </p>
      <p>
        That licence cannot take away rights you already have. Facts from SEC filings and SBIR.gov
        are public-domain government records, and Wikidata is CC0: taken from the original source,
        they are yours to use however you like. For commercial use of the Capbase database itself,
        write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p>
        The software that runs Capbase is open source under the{' '}
        <a href={SOURCE_URL}>GNU Affero General Public License v3.0</a>.
      </p>

      <h2>Company logos</h2>
      <p>
        Logos are fetched from each company&apos;s website through DuckDuckGo&apos;s public icon
        service and are not part of the Capbase database or its licence. Company names and logos
        are trademarks of their respective owners, shown only to identify the company; their use
        implies no affiliation or endorsement. To have a logo removed, write to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>How to cite Capbase</h2>
      <p>Credit Capbase, link to the licence, and say if you changed the data. For example:</p>
      <div className="mt-3 rounded-md border border-line bg-surface px-4 py-3 font-mono text-xs leading-[1.7] text-graphite-900">
        Data: Capbase (capbase.fyi), licensed under CC BY-NC 4.0.
      </div>
      <p>
        Where you can, link to the profile the data came from — for example{' '}
        <code>https://capbase.fyi/companies/&lt;slug&gt;</code> — and to the primary source its
        marker cites.
      </p>
    </>
  );
}
