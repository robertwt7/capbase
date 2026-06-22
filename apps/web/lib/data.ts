// Mock dataset for the Capbase frontend prototype.
// Figures here are illustrative demo data, not verified financials. They exist
// to exercise the layout for funding rounds, investors, people, exits, and
// market data. Swap this module for the NestJS API once endpoints are ready.
//
// Domain types are the single source of truth in @repo/api and are shared with
// the NestJS backend. They are re-exported here so existing component imports
// (e.g. `import type { FundingRound } from '../lib/data'`) keep working.

import type { Company, MarketStat, MarketTotals } from '@repo/api';

export type {
  Stage,
  CompanyStatus,
  InvestorType,
  ExitType,
  RoundInvestor,
  FundingRound,
  Person,
  InvestorHolding,
  AcquisitionDeal,
  ExitEvent,
  DiversitySignal,
  CompanyFinancials,
  Company,
  MarketStat,
  MarketTotals,
} from '@repo/api';

const companies: Company[] = [
  {
    slug: 'helia',
    name: 'Helia',
    domain: 'stripe.com',
    oneLiner: 'Settlement infrastructure for cross-border payouts.',
    description:
      'Helia runs the ledger and compliance rails that let marketplaces pay out to contractors in 40 currencies. It sells to platforms that have outgrown a single payment processor and need real-time reconciliation across banking partners.',
    hq: 'San Francisco, CA',
    founded: 2016,
    headcount: 1840,
    industry: ['Fintech', 'Payments', 'Infrastructure'],
    status: 'Private',
    stage: 'Series E',
    totalRaisedUsd: 1_350_000_000,
    lastValuationUsd: 24_000_000_000,
    financials: {
      revenueUsd: 410_000_000,
      revenueGrowthPct: 62,
      grossMarginPct: 74,
      burnMonths: 38,
    },
    rounds: [
      {
        name: 'Seed',
        date: '2016-09-01',
        amountUsd: 3_200_000,
        postMoneyUsd: 14_000_000,
        lead: 'Founders Collective',
        investors: [
          { name: 'Founders Collective', lead: true },
          { name: 'Liquid 2 Ventures', lead: false },
        ],
      },
      {
        name: 'Series A',
        date: '2018-03-12',
        amountUsd: 22_000_000,
        postMoneyUsd: 120_000_000,
        lead: 'Index Ventures',
        investors: [
          { name: 'Index Ventures', lead: true },
          { name: 'Founders Collective', lead: false },
        ],
      },
      {
        name: 'Series B',
        date: '2019-11-04',
        amountUsd: 75_000_000,
        postMoneyUsd: 600_000_000,
        lead: 'Sequoia Capital',
        investors: [
          { name: 'Sequoia Capital', lead: true },
          { name: 'Index Ventures', lead: false },
          { name: 'Stripe', lead: false },
        ],
      },
      {
        name: 'Series C',
        date: '2021-05-20',
        amountUsd: 230_000_000,
        postMoneyUsd: 4_100_000_000,
        lead: 'Tiger Global',
        investors: [
          { name: 'Tiger Global', lead: true },
          { name: 'Sequoia Capital', lead: false },
          { name: 'Coatue', lead: false },
        ],
      },
      {
        name: 'Series D',
        date: '2022-10-18',
        amountUsd: 420_000_000,
        postMoneyUsd: 12_500_000_000,
        lead: 'Founders Fund',
        investors: [
          { name: 'Founders Fund', lead: true },
          { name: 'Tiger Global', lead: false },
          { name: 'GIC', lead: false },
        ],
      },
      {
        name: 'Series E',
        date: '2024-06-11',
        amountUsd: 600_000_000,
        postMoneyUsd: 24_000_000_000,
        lead: 'Thrive Capital',
        investors: [
          { name: 'Thrive Capital', lead: true },
          { name: 'Founders Fund', lead: false },
          { name: 'GIC', lead: false },
          { name: 'Sequoia Capital', lead: false },
        ],
      },
    ],
    people: [
      { name: 'Mara Okonkwo', role: 'Co-founder & CEO', since: 2016, prior: 'Square' },
      { name: 'Devin Aluko', role: 'Co-founder & CTO', since: 2016, prior: 'Stripe' },
      { name: 'Priya Raman', role: 'Chief Financial Officer', since: 2021, prior: 'Adyen' },
      { name: 'Tomas Vega', role: 'VP Engineering', since: 2019, prior: 'Plaid' },
      { name: 'Hannah Cole', role: 'Chief Compliance Officer', since: 2020, prior: 'Wise' },
    ],
    investors: [
      { name: 'Sequoia Capital', type: 'Venture', firstRound: 'Series B', rounds: 3 },
      { name: 'Index Ventures', type: 'Venture', firstRound: 'Series A', rounds: 2 },
      { name: 'Tiger Global', type: 'Growth', firstRound: 'Series C', rounds: 2 },
      { name: 'Founders Fund', type: 'Venture', firstRound: 'Series D', rounds: 2 },
      { name: 'Thrive Capital', type: 'Growth', firstRound: 'Series E', rounds: 1 },
      { name: 'GIC', type: 'Private equity', firstRound: 'Series D', rounds: 2 },
    ],
    acquisitions: [
      {
        target: 'Ledgerline',
        date: '2022-02-09',
        amountUsd: 48_000_000,
        rationale: 'Double-entry reconciliation engine, folded into core ledger.',
      },
      {
        target: 'Cardinal KYC',
        date: '2023-08-22',
        amountUsd: null,
        rationale: 'Identity verification team and model, undisclosed terms.',
      },
    ],
    exits: [],
    diversity: [
      { label: 'Founder representation', value: 'Woman-led', note: 'CEO and 2 of 5 execs are women.' },
      { label: 'Cap table', value: '11%', note: 'Capital from diversity-focused funds.' },
      { label: 'Board', value: '3 of 7', note: 'Independent directors from underrepresented groups.' },
    ],
  },
  {
    slug: 'vellum',
    name: 'Vellum',
    domain: 'figma.com',
    oneLiner: 'Design surface for collaborative product teams.',
    description:
      'Vellum is a multiplayer canvas where product, design, and engineering iterate on the same file. It replaced a stack of single-player tools for teams that needed everyone editing live.',
    hq: 'New York, NY',
    founded: 2014,
    headcount: 1200,
    industry: ['Design', 'Productivity', 'SaaS'],
    status: 'Acquired',
    stage: 'Acquired',
    totalRaisedUsd: 333_000_000,
    lastValuationUsd: 20_000_000_000,
    exits: [
      {
        type: 'Acquisition',
        date: '2023-09-15',
        valueUsd: 20_000_000_000,
        detail: 'Acquired by Northwind Software (deal later terminated by regulators).',
      },
    ],
    diversity: [
      { label: 'Founder representation', value: 'Mixed', note: 'Two-person founding team.' },
    ],
  },
  {
    slug: 'sable-labs',
    name: 'Sable Labs',
    domain: 'anthropic.com',
    oneLiner: 'Frontier models for regulated industries.',
    description:
      'Sable Labs trains and serves large language models tuned for finance, healthcare, and legal work, with deployment options that keep data inside the customer perimeter.',
    hq: 'San Francisco, CA',
    founded: 2021,
    headcount: 900,
    industry: ['Artificial intelligence', 'Enterprise', 'Infrastructure'],
    status: 'Private',
    stage: 'Series D',
    totalRaisedUsd: 7_300_000_000,
    lastValuationUsd: 60_000_000_000,
  },
  {
    slug: 'gridpoint',
    name: 'GridPoint',
    domain: 'databricks.com',
    oneLiner: 'Lakehouse analytics for operational data.',
    description:
      'GridPoint unifies data warehousing and machine learning on one platform, aimed at enterprises consolidating fragmented analytics stacks.',
    hq: 'San Francisco, CA',
    founded: 2013,
    headcount: 7000,
    industry: ['Data', 'Analytics', 'Enterprise'],
    status: 'Private',
    stage: 'Late stage',
    totalRaisedUsd: 10_000_000_000,
    lastValuationUsd: 62_000_000_000,
  },
  {
    slug: 'meridian',
    name: 'Meridian',
    domain: 'ramp.com',
    oneLiner: 'Spend management that pays for itself.',
    description:
      'Meridian issues corporate cards and automates expense, bill pay, and accounting close for finance teams that want controls without slowing the company down.',
    hq: 'New York, NY',
    founded: 2019,
    headcount: 1000,
    industry: ['Fintech', 'SaaS'],
    status: 'Private',
    stage: 'Series D',
    totalRaisedUsd: 1_200_000_000,
    lastValuationUsd: 13_000_000_000,
  },
  {
    slug: 'quill',
    name: 'Quill',
    domain: 'notion.so',
    oneLiner: 'Connected workspace for docs, wikis, and projects.',
    description:
      'Quill blends documents, databases, and task tracking into one workspace teams can shape to their own process.',
    hq: 'San Francisco, CA',
    founded: 2016,
    headcount: 800,
    industry: ['Productivity', 'SaaS'],
    status: 'Private',
    stage: 'Series C',
    totalRaisedUsd: 343_000_000,
    lastValuationUsd: 10_000_000_000,
  },
  {
    slug: 'palette',
    name: 'Palette',
    domain: 'canva.com',
    oneLiner: 'Design tools for everyone, not just designers.',
    description:
      'Palette makes graphic design approachable with templates and drag-and-drop editing for marketers, educators, and small businesses.',
    hq: 'Sydney, AU',
    founded: 2013,
    headcount: 4500,
    industry: ['Design', 'Consumer', 'SaaS'],
    status: 'Private',
    stage: 'Late stage',
    totalRaisedUsd: 580_000_000,
    lastValuationUsd: 26_000_000_000,
  },
  {
    slug: 'beacon-hr',
    name: 'Beacon HR',
    domain: 'rippling.com',
    oneLiner: 'One system for payroll, devices, and access.',
    description:
      'Beacon HR ties employee data to payroll, IT provisioning, and app access so onboarding and offboarding happen in one workflow.',
    hq: 'San Francisco, CA',
    founded: 2016,
    headcount: 3000,
    industry: ['HR tech', 'IT', 'SaaS'],
    status: 'Private',
    stage: 'Series F',
    totalRaisedUsd: 1_400_000_000,
    lastValuationUsd: 16_800_000_000,
  },
];

export const marketStats: MarketStat[] = [
  { sector: 'Artificial intelligence', dealCount: 1284, totalRaisedUsd: 48_200_000_000, medianValuationUsd: 240_000_000, trendPct: 31 },
  { sector: 'Fintech', dealCount: 962, totalRaisedUsd: 19_400_000_000, medianValuationUsd: 95_000_000, trendPct: -6 },
  { sector: 'Healthcare', dealCount: 741, totalRaisedUsd: 14_800_000_000, medianValuationUsd: 78_000_000, trendPct: 4 },
  { sector: 'Climate', dealCount: 523, totalRaisedUsd: 11_900_000_000, medianValuationUsd: 64_000_000, trendPct: 12 },
  { sector: 'Enterprise SaaS', dealCount: 1105, totalRaisedUsd: 16_300_000_000, medianValuationUsd: 70_000_000, trendPct: -2 },
];

export const marketTotals: MarketTotals = {
  totalRaisedUsd: 110_600_000_000,
  dealCount: 4615,
  newUnicorns: 38,
  quarter: 'Q2 2026',
};

export function getCompanies(): Company[] {
  return companies;
}

export function getCompany(slug: string): Company | undefined {
  return companies.find((c) => c.slug === slug);
}
