// Data access for the Capbase frontend.
//
// Getters fetch live data from the NestJS API (see ./api). The arrays below are
// kept only as an offline FALLBACK so the UI still renders if the API is
// unreachable in local dev; they are illustrative demo figures, not verified.
//
// Domain types are the single source of truth in @repo/api and are shared with
// the NestJS backend. They are re-exported here so existing component imports
// (e.g. `import type { FundingRound } from '../lib/data'`) keep working.

import { cache } from 'react';

import {
  DEFAULT_PAGE_SIZE,
  PREVIEW_LIMIT,
  type Company,
  type CompanyDetailResponse,
  type CompanyListQuery,
  type CompanySlugEntry,
  type InvestorDetailResponse,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type MarketStat,
  type MarketTotals,
  type Paginated,
} from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

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
  Investor,
  InvestorSummary,
  InvestorDetailResponse,
  MarketStat,
  MarketTotals,
} from '@repo/api';

const fallbackCompanies: Company[] = [
  {
    slug: 'helia',
    name: 'Helia',
    domain: 'stripe.com',
    websiteUrl: 'https://stripe.com',
    linkedinUrl: 'https://www.linkedin.com/company/helia',
    primarySector: 'Fintech',
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
    primarySector: 'Enterprise SaaS',
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
    primarySector: 'Artificial intelligence',
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
    primarySector: 'Artificial intelligence',
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
    primarySector: 'Fintech',
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
    primarySector: 'Enterprise SaaS',
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
    primarySector: 'Enterprise SaaS',
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
    primarySector: 'Enterprise SaaS',
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

const fallbackMarketStats: MarketStat[] = [
  { sector: 'Artificial intelligence', companyCount: 2, dealCount: 1284, totalRaisedUsd: 48_200_000_000, medianValuationUsd: 240_000_000, trendPct: 31 },
  { sector: 'Fintech', companyCount: 2, dealCount: 962, totalRaisedUsd: 19_400_000_000, medianValuationUsd: 95_000_000, trendPct: -6 },
  { sector: 'Healthcare', companyCount: 0, dealCount: 741, totalRaisedUsd: 14_800_000_000, medianValuationUsd: 78_000_000, trendPct: 4 },
  { sector: 'Climate', companyCount: 0, dealCount: 523, totalRaisedUsd: 11_900_000_000, medianValuationUsd: 64_000_000, trendPct: 12 },
  { sector: 'Enterprise SaaS', companyCount: 4, dealCount: 1105, totalRaisedUsd: 16_300_000_000, medianValuationUsd: 70_000_000, trendPct: -2 },
];

const fallbackMarketTotals: MarketTotals = {
  totalRaisedUsd: 110_600_000_000,
  dealCount: 4615,
  newUnicorns: 38,
  quarter: 'Q2 2026',
};

// Illustrative offline fallback for the investor directory (mirrors the shape the
// API's /investors aggregate returns). Not verified — demo figures only.
const fallbackInvestors: InvestorSummary[] = [
  {
    slug: 'sequoia-capital',
    name: 'Sequoia Capital',
    type: 'Venture',
    websiteUrl: 'https://www.sequoiacap.com',
    domain: 'sequoiacap.com',
    portfolioCount: 2,
    sectors: ['Artificial intelligence', 'Fintech'],
    companies: [
      { slug: 'helia', name: 'Helia', domain: 'stripe.com' },
      { slug: 'sable-labs', name: 'Sable Labs', domain: 'anthropic.com' },
    ],
  },
  {
    slug: 'founders-fund',
    name: 'Founders Fund',
    type: 'Venture',
    portfolioCount: 1,
    sectors: ['Fintech'],
    companies: [{ slug: 'helia', name: 'Helia', domain: 'stripe.com' }],
  },
  {
    slug: 'tiger-global',
    name: 'Tiger Global',
    type: 'Growth',
    portfolioCount: 1,
    sectors: ['Fintech'],
    companies: [{ slug: 'helia', name: 'Helia', domain: 'stripe.com' }],
  },
];

/** Build a query string from defined params only. */
function toSearchParams(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Offline fallback: apply the list query to the mock array client-side. */
function paginateFallbackCompanies(query: CompanyListQuery): Paginated<Company> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const needle = (query.q ?? '').trim().toLowerCase();
  const slugs = query.slugs?.split(',').filter(Boolean);
  const list = fallbackCompanies.filter((c) => {
    if (slugs && !slugs.includes(c.slug)) return false;
    if (
      needle &&
      !c.name.toLowerCase().includes(needle) &&
      !c.oneLiner.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (query.sector && c.primarySector !== query.sector) return false;
    if (query.stage && c.stage !== query.stage) return false;
    if (query.status && c.status !== query.status) return false;
    return true;
  });
  if (query.sort === 'raised') list.sort((a, b) => b.totalRaisedUsd - a.totalRaisedUsd);
  else if (query.sort === 'valuation')
    list.sort((a, b) => (b.lastValuationUsd ?? 0) - (a.lastValuationUsd ?? 0));
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return {
    items: list.slice((page - 1) * pageSize, page * pageSize),
    total: list.length,
    page,
    pageSize,
  };
}

export async function getCompanies(query: CompanyListQuery = {}): Promise<Paginated<Company>> {
  try {
    return await apiFetch<Paginated<Company>>(`/companies${toSearchParams(query)}`);
  } catch (err) {
    console.warn('[data] getCompanies fell back to mock data:', err);
    return paginateFallbackCompanies(query);
  }
}

// Wrapped in React cache() so generateMetadata, the page, and the OG image
// route share one fetch per request.
export const getCompanyDetail = cache(async function getCompanyDetail(
  slug: string,
): Promise<CompanyDetailResponse | undefined> {
  // The detail endpoint is gated per-viewer, so it is authenticated (when a
  // session exists) and never cached.
  const token = await getToken();
  try {
    return await apiFetch<CompanyDetailResponse>(`/companies/${slug}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    console.warn(`[data] getCompanyDetail(${slug}) fell back to mock data:`, err);
    const company = fallbackCompanies.find((c) => c.slug === slug);
    if (!company) return undefined;
    // Offline fallback renders the full mock profile (unlocked).
    return {
      company,
      access: {
        unlocked: true,
        previewLimit: PREVIEW_LIMIT,
        unlockedUntil: null,
        totals: {
          rounds: company.rounds?.length ?? 0,
          people: company.people?.length ?? 0,
          investors: company.investors?.length ?? 0,
          acquisitions: company.acquisitions?.length ?? 0,
          exits: company.exits?.length ?? 0,
          diversity: company.diversity?.length ?? 0,
        },
      },
    };
  }
});

/** Every approved company's slug + last update, for the sitemap. */
export async function getCompanySlugs(): Promise<CompanySlugEntry[]> {
  try {
    return await apiFetch<CompanySlugEntry[]>('/companies/sitemap');
  } catch (err) {
    // Never emit mock slugs into a production sitemap — an empty list is safer.
    console.warn('[data] getCompanySlugs failed; sitemap gets no company URLs:', err);
    return [];
  }
}

/** Offline fallback: apply the list query to the mock array client-side. */
function paginateFallbackInvestors(query: InvestorListQuery): Paginated<InvestorSummary> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const needle = (query.q ?? '').trim().toLowerCase();
  const list = fallbackInvestors.filter((inv) => {
    if (needle && !inv.name.toLowerCase().includes(needle)) return false;
    if (query.type && inv.type !== query.type) return false;
    return true;
  });
  if (query.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else
    list.sort((a, b) => b.portfolioCount - a.portfolioCount || a.name.localeCompare(b.name));
  return {
    items: list.slice((page - 1) * pageSize, page * pageSize),
    total: list.length,
    page,
    pageSize,
  };
}

export async function getInvestors(
  query: InvestorListQuery = {},
): Promise<Paginated<InvestorSummary>> {
  try {
    return await apiFetch<Paginated<InvestorSummary>>(`/investors${toSearchParams(query)}`);
  } catch (err) {
    console.warn('[data] getInvestors fell back to mock data:', err);
    return paginateFallbackInvestors(query);
  }
}

/** One investor profile, or null when the slug is unknown (renders notFound). */
export async function getInvestor(slug: string): Promise<InvestorDetailResponse | null> {
  try {
    return await apiFetch<InvestorDetailResponse>(`/investors/${encodeURIComponent(slug)}`);
  } catch (err) {
    console.warn(`[data] getInvestor(${slug}) fell back to mock data:`, err);
    return fallbackInvestors.find((i) => i.slug === slug) ?? null;
  }
}

export async function getInvestorSlugs(): Promise<InvestorSlugEntry[]> {
  try {
    return await apiFetch<InvestorSlugEntry[]>('/investors/sitemap');
  } catch (err) {
    // Never emit mock slugs into a production sitemap — an empty list is safer.
    console.warn('[data] getInvestorSlugs failed; sitemap gets no investor URLs:', err);
    return [];
  }
}

export async function getMarketStats(): Promise<MarketStat[]> {
  try {
    return await apiFetch<MarketStat[]>('/market/stats');
  } catch (err) {
    console.warn('[data] getMarketStats fell back to mock data:', err);
    return fallbackMarketStats;
  }
}

export async function getMarketTotals(): Promise<MarketTotals> {
  try {
    return await apiFetch<MarketTotals>('/market/totals');
  } catch (err) {
    console.warn('[data] getMarketTotals fell back to mock data:', err);
    return fallbackMarketTotals;
  }
}
