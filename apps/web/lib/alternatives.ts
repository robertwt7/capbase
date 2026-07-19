// Content config for the /alternatives/[competitor] comparison landing pages.
// Config-driven so more competitors (zoominfo, dealroom, …) can be added later.
// Wording stays generic and non-stale on purpose — no specific competitor
// prices — and competitor names are plain nominative use, no logos.

export type Competitor = {
  slug: 'crunchbase' | 'pitchbook';
  name: string;
  title: string; // metadata <title>
  description: string; // meta description
  h1: string;
  intro: string[];
  rows: Array<{ label: string; capbase: string; them: string }>;
  whenToUseThem: string; // honesty section — good E-E-A-T
  faqs: Array<{ q: string; a: string }>;
};

const SHARED_ROWS: Array<{ label: string; capbase: string }> = [
  { label: 'Price', capbase: 'Free' },
  { label: 'Open source', capbase: 'Yes' },
  { label: 'Data sources', capbase: 'SEC EDGAR + Wikidata + community' },
  { label: 'Community contributions', capbase: 'Yes, moderated' },
  { label: 'Funding rounds & investors', capbase: 'Yes' },
  { label: 'Account required to browse', capbase: 'No' },
  { label: 'Data export', capbase: 'Roadmap' },
];

function rows(them: string[]): Competitor['rows'] {
  return SHARED_ROWS.map((row, i) => ({ ...row, them: them[i] ?? '—' }));
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'crunchbase',
    name: 'Crunchbase',
    title: 'Free Crunchbase Alternative',
    description:
      'Looking for a free Crunchbase alternative? Capbase has company funding rounds, investors, and startup data — open source, crowdsourced, and free to browse with no account.',
    h1: 'The free, open Crunchbase alternative',
    intro: [
      'Capbase covers the ground most people open Crunchbase for — who raised, from whom, and when — without paywalls, seat licences, or an account wall. Funding rounds, investors, people, and market data for private companies, free to read.',
      'Every row is traceable: automated ingestion of SEC EDGAR Form D filings supplies the official record, Wikidata enrichment fills in company facts, and moderated community contributions cover what filings never capture.',
    ],
    rows: rows([
      'Paid subscription',
      'No',
      'Proprietary',
      'No',
      'Yes',
      'Yes',
      'Paid tiers',
    ]),
    whenToUseThem:
      'Crunchbase is still the right tool if you need its paid workflow features — large-scale exports, CRM integrations, sales prospecting tools, and a bigger historical archive. Capbase is for everyone who just needs open, verifiable funding data without a subscription.',
    faqs: [
      {
        q: 'Is Crunchbase free?',
        a: 'Crunchbase offers limited free browsing with an account; full search, filters, and exports sit behind paid subscription tiers. Capbase is free to browse with no account at all.',
      },
      {
        q: 'Is Capbase really a Crunchbase alternative?',
        a: 'For core company and funding research, yes: funding rounds, investors, people, acquisitions, and exits, sourced from SEC filings, Wikidata, and a moderated community. For sales prospecting or CRM workflows, Crunchbase remains the more complete paid product.',
      },
      {
        q: 'Where does Capbase data come from?',
        a: 'SEC EDGAR Form D filings (official US private-placement disclosures), Wikidata enrichment for notable companies, and community contributions reviewed by moderators before publishing.',
      },
      {
        q: 'Can I export data from Capbase?',
        a: 'Not yet — exports and a public API are on the roadmap. The project is open source, so self-hosting the database is already possible today.',
      },
    ],
  },
  {
    slug: 'pitchbook',
    name: 'PitchBook',
    title: 'Free PitchBook Alternative',
    description:
      'Need a free PitchBook alternative? Capbase offers startup funding rounds, investors, and market data — open source and crowdsourced, with no enterprise contract.',
    h1: 'The free, open PitchBook alternative',
    intro: [
      'PitchBook is an institutional research platform priced for institutions. Capbase answers the everyday questions — which companies raised, who invested, how sectors are moving — in the open, free to read, with no enterprise contract or sales call.',
      'The data is built from official SEC EDGAR Form D filings, Wikidata enrichment, and moderated community contributions, so what you see is traceable to a public source.',
    ],
    rows: rows([
      'Enterprise subscription',
      'No',
      'Proprietary',
      'No',
      'Yes',
      'Yes',
      'Paid tiers',
    ]),
    whenToUseThem:
      'PitchBook is still the right tool for institutional-grade diligence: valuations analysis, comps, fund performance, LP data, Excel plugins, and analyst support. Capbase does not attempt any of that — it covers open funding data, for free.',
    faqs: [
      {
        q: 'How much does PitchBook cost?',
        a: 'PitchBook is sold as an enterprise subscription with pricing set per contract; there is no meaningful free tier. Capbase is free for everyone.',
      },
      {
        q: 'Does Capbase have valuations and fund data like PitchBook?',
        a: 'No. Capbase records disclosed funding rounds, post-money valuations when public, investors, and people. PitchBook-style estimated valuations, comps, and fund performance analytics are out of scope.',
      },
      {
        q: 'Who is Capbase for?',
        a: 'Founders, job seekers, journalists, researchers, and developers who need to know who raised what, from whom, and when — without paying for an institutional research seat.',
      },
      {
        q: 'How current is Capbase data?',
        a: 'SEC EDGAR filings are ingested on a daily schedule, and community contributions appear as soon as a moderator approves them.',
      },
    ],
  },
];

export const competitorBySlug = (slug: string): Competitor | undefined =>
  COMPETITORS.find((c) => c.slug === slug);
