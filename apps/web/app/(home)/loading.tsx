import { LoadingStatus } from '@/components/ui';

import {
  HomeHero,
  HowItWorks,
  PopularCompaniesSection,
  PopularCompaniesSkeleton,
  StatStripSkeleton,
  TopSectorsSection,
  TopSectorsSkeleton,
} from './sections';

/** The prefetched shell for client navigation to `/`: page.tsx with every
    Suspense boundary showing its fallback, so it is pixel-identical to the
    streamed first paint. Lives in (home) — an app/loading.tsx would wrap
    every route. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <LoadingStatus label="Loading…" />
      <HomeHero>
        <StatStripSkeleton />
      </HomeHero>
      <HowItWorks />
      <TopSectorsSection>
        <TopSectorsSkeleton />
      </TopSectorsSection>
      <PopularCompaniesSection>
        <PopularCompaniesSkeleton />
      </PopularCompaniesSection>
    </div>
  );
}
