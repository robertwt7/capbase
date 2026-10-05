import type { Metadata } from 'next';
import { Suspense } from 'react';

import { JsonLd } from '@/components/JsonLd';
import { canonical } from '@/lib/metadata';
import { siteOrganizationJsonLd, websiteJsonLd } from '@/lib/schema';

import {
  AccessNote,
  HomeHero,
  HowItWorks,
  PopularCompanies,
  PopularCompaniesSection,
  PopularCompaniesSkeleton,
  StatStrip,
  StatStripSkeleton,
  TopSectors,
  TopSectorsSection,
  TopSectorsSkeleton,
} from './sections';

export const metadata: Metadata = { ...canonical('/') };

/** The shell (hero, How it works, section headings) renders at once; each data
    section streams into its own boundary, so the slowest API call no longer
    holds the whole page. `loading.tsx` is this composition with every boundary
    showing its fallback. */
export default function Home() {
  return (
    <div>
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={siteOrganizationJsonLd()} />

      <HomeHero>
        <Suspense fallback={<StatStripSkeleton />}>
          <StatStrip />
        </Suspense>
      </HomeHero>

      <HowItWorks
        note={
          <Suspense fallback={null}>
            <AccessNote />
          </Suspense>
        }
      />

      <TopSectorsSection>
        <Suspense fallback={<TopSectorsSkeleton />}>
          <TopSectors />
        </Suspense>
      </TopSectorsSection>

      <PopularCompaniesSection>
        <Suspense fallback={<PopularCompaniesSkeleton />}>
          <PopularCompanies />
        </Suspense>
      </PopularCompaniesSection>
    </div>
  );
}
