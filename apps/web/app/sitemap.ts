import type { MetadataRoute } from 'next';

import { SECTORS } from '@repo/api';

import { getCompanySlugs, getInvestorSlugs } from '@/lib/data';
import { sectorSlug } from '@/lib/markets';
import { SITE_URL } from '@/lib/site';

const STATIC_PATHS = [
  '',
  '/companies',
  '/investors',
  '/funds',
  '/markets',
  '/about',
  '/faq',
  '/alternatives/crunchbase',
  '/alternatives/pitchbook',
  '/terms',
  '/privacy',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [companies, investors] = await Promise.all([getCompanySlugs(), getInvestorSlugs()]);
  return [
    ...STATIC_PATHS.map((p) => ({ url: `${SITE_URL}${p}` })),
    ...SECTORS.map((s) => ({ url: `${SITE_URL}/markets/${sectorSlug(s)}` })),
    ...companies.map((c) => ({
      url: `${SITE_URL}/companies/${c.slug}`,
      lastModified: c.updatedAt,
    })),
    ...investors.map((i) => ({
      url: `${SITE_URL}/investors/${i.slug}`,
      lastModified: i.updatedAt,
    })),
  ];
}
