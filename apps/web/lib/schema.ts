// schema.org JSON-LD builders — pure functions kept out of JSX, rendered via
// <JsonLd>. URLs are absolute (search engines don't resolve relative JSON-LD).

import type { Company } from '@repo/api';

import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from './site';

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        // Matches the header search form (action="/companies", input name="q").
        urlTemplate: `${SITE_URL}/companies?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Capbase itself, as publisher of the site. */
export function siteOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    email: SUPPORT_EMAIL,
  };
}

/** The profiled company on /companies/[slug]. */
export function companyJsonLd(company: Company) {
  const sameAs = [company.linkedinUrl, company.twitterUrl].filter((u): u is string => Boolean(u));
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
    description: company.oneLiner,
    ...(company.websiteUrl && { url: company.websiteUrl }),
    foundingDate: String(company.founded),
    address: { '@type': 'PostalAddress', addressLocality: company.hq },
    ...(sameAs.length > 0 && { sameAs }),
    // Same logo source CompanyLogo uses.
    ...(company.domain && { logo: `https://logo.clearbit.com/${company.domain}` }),
  };
}

export function companyBreadcrumbJsonLd(company: Company) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Companies', item: `${SITE_URL}/companies` },
      {
        '@type': 'ListItem',
        position: 3,
        name: company.name,
        item: `${SITE_URL}/companies/${company.slug}`,
      },
    ],
  };
}
