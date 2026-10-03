// schema.org JSON-LD builders — pure functions kept out of JSX, rendered via
// <JsonLd>. URLs are absolute (search engines don't resolve relative JSON-LD).

import type { Company, PersonDetailResponse } from '@repo/api';

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
    ...(company.domain && { logo: `${SITE_URL}/api/logo/${encodeURIComponent(company.domain)}` }),
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

/**
 * The profiled human on /people/[slug].
 *
 * `sameAs` carries the Wikidata URL when we hold a QID — the single most useful
 * field here, because it tells a search engine *which* Jane Smith this is
 * rather than leaving it to guess from a name.
 *
 * `jobTitle`/`worksFor` describe only the newest role with NO recorded end
 * year. A role the source dated an end to is over, and a role that merely has
 * no end date is not evidence the person is still there — so where the data is
 * silent, so is the markup.
 */
export function personJsonLd(person: PersonDetailResponse) {
  const orgs = [
    ...new Map(
      person.roles
        .map((r) => r.company ?? r.investor)
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => [o.slug, o.name]),
    ).values(),
  ];

  const current = person.roles.find((r) => r.endYear === null);
  const sameAs = [
    ...person.identifiers.map((i) => i.url).filter((u): u is string => Boolean(u)),
    ...person.roles.map((r) => r.linkedinUrl).filter((u): u is string => Boolean(u)),
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: person.name,
    url: `${SITE_URL}/people/${person.slug}`,
    ...(current?.title || current?.role ? { jobTitle: current.title ?? current.role } : {}),
    ...(current && {
      worksFor: {
        '@type': 'Organization',
        name: current.company?.name ?? current.investor?.name,
      },
    }),
    ...(orgs.length > 0 && {
      affiliation: orgs.map((name) => ({ '@type': 'Organization', name })),
    }),
    ...(sameAs.length > 0 && { sameAs: [...new Set(sameAs)] }),
  };
}

export function personBreadcrumbJsonLd(person: PersonDetailResponse) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'People', item: `${SITE_URL}/people` },
      {
        '@type': 'ListItem',
        position: 3,
        name: person.name,
        item: `${SITE_URL}/people/${person.slug}`,
      },
    ],
  };
}
