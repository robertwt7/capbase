/**
 * The host classifier moved to `@repo/api` (`domain/domains.ts`) so the API's company-claim
 * flow shares it. Re-exported here so no ingestion call site changes.
 */
export {
  SOCIAL_HOSTS,
  PLATFORM_HOSTS,
  hostOf,
  isLinkedInHost,
  isSocialHost,
  isPlatformHost,
  identifyingDomain,
} from '@repo/api';
