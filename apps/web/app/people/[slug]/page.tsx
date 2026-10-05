import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { PersonRole } from '@repo/api';

import { Citation } from '@/components/Citation';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Identifiers } from '@/components/Identifiers';
import { JsonLd } from '@/components/JsonLd';
import { Badge, SectionHeader } from '@/components/ui';
import { getPerson } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { canonical } from '@/lib/metadata';
import { personBreadcrumbJsonLd, personJsonLd } from '@/lib/schema';

const DESCRIPTION_MAX = 160;

/** The organisation a role hangs off, as one shape whichever side it came from. */
function org(role: PersonRole): { name: string; href: string | null; domain: string } {
  if (role.company) {
    return {
      name: role.company.name,
      href: `/companies/${role.company.slug}`,
      domain: role.company.domain ?? '',
    };
  }
  if (role.investor) {
    return { name: role.investor.name, href: `/investors/${role.investor.slug}`, domain: '' };
  }
  return { name: 'Undisclosed', href: null, domain: '' };
}

/** The year range a source dated. A null `endYear` means "no end recorded",
 *  which is not the same as "still there" — so it renders as an open range
 *  rather than the word "present". */
function years(role: PersonRole): string {
  if (!role.since) return '—';
  return role.endYear ? `${role.since}–${role.endYear}` : `${role.since}–`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPerson(slug);
  if (!person) return {};

  const orgs = [...new Set(person.roles.map((r) => org(r).name))].slice(0, 3);
  const facts = [
    `${formatCount(person.roleCount)} ${person.roleCount === 1 ? 'role' : 'roles'}`,
    person.companyCount > 0
      ? `${formatCount(person.companyCount)} ${person.companyCount === 1 ? 'company' : 'companies'}`
      : null,
    orgs.join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');
  const description =
    facts.length > DESCRIPTION_MAX ? `${facts.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : facts;

  return {
    title: `${person.name} — Roles & Companies`,
    description,
    ...canonical(`/people/${slug}`),
    // Thin profiles stay public and crawlable but out of the index; the API
    // decides (the same rule drops them from the sitemap).
    ...(!person.indexable && { robots: { index: false, follow: true } }),
  };
}

export default async function PersonProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const person = await getPerson(slug);
  if (!person) notFound();

  // Roles arrive newest first; group them so one organisation reads as one
  // block even when a source published several roles there.
  const grouped = new Map<string, { org: ReturnType<typeof org>; roles: PersonRole[] }>();
  for (const role of person.roles) {
    const o = org(role);
    const key = o.href ?? o.name;
    const entry = grouped.get(key);
    if (entry) entry.roles.push(role);
    else grouped.set(key, { org: o, roles: [role] });
  }

  const firstYear = person.roles.reduce(
    (min, r) => (r.since && (min === 0 || r.since < min) ? r.since : min),
    0,
  );

  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8">
      {/* schema.org Person — `sameAs` carries the Wikidata QID, which is what
          tells a search engine WHICH person this is rather than leaving it to
          guess from the name. */}
      <JsonLd data={personJsonLd(person)} />
      <JsonLd data={personBreadcrumbJsonLd(person)} />
      <Link
        href="/people"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← All people
      </Link>

      <header className="border-b border-ink pt-7 pb-9">
        <h1 className="font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink">
          {person.name}
        </h1>
        <dl className="mt-5 flex flex-wrap gap-x-16 gap-y-3.5">
          <Metric
            label="Roles"
            value={formatCount(person.roleCount)}
          />
          <Metric
            label="Organisations"
            value={formatCount(grouped.size)}
          />
          {firstYear ? <Metric label="First recorded" value={String(firstYear)} /> : null}
        </dl>
        {/* A Wikidata QID, when a source published one. Renders nothing when we
            hold none. */}
        <Identifiers identifiers={person.identifiers} className="mt-5" />
      </header>

      <section className="border-t border-line py-8">
        <SectionHeader
          title="Roles"
          note={`${formatCount(person.roleCount)} across ${formatCount(grouped.size)} ${grouped.size === 1 ? 'organisation' : 'organisations'}`}
          size="md"
          className="mb-5 border-b-0 pb-0"
        />
        <ul className="overflow-hidden rounded-[10px] border border-line bg-surface">
          {[...grouped.values()].map(({ org: o, roles }) => (
            <li key={o.href ?? o.name} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-3 px-4 pt-3.5">
                <CompanyLogo name={o.name} domain={o.domain} size={28} />
                {o.href ? (
                  <Link
                    href={o.href}
                    className="font-display text-[15px] font-semibold tracking-tight text-ink transition-colors hover:text-graphite-700"
                  >
                    {o.name}
                  </Link>
                ) : (
                  <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
                    {o.name}
                  </span>
                )}
              </div>
              <ul className="px-4 pt-2 pb-3.5">
                {roles.map((role) => (
                  <li
                    key={role.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-5 py-1 max-[720px]:grid-cols-1 max-[720px]:gap-y-1"
                  >
                    <span className="min-w-0 text-[14px] text-graphite-700">
                      {role.title || role.role}
                      {/* An uncited role reads as an em dash, never as a bare
                          claim — the marker component draws that distinction. */}
                      <Citation citations={person.citations} entityId={role.id} />
                    </span>
                    {role.kind ? (
                      <Badge variant="pill" mono>
                        {role.kind}
                      </Badge>
                    ) : (
                      <span className="font-mono text-[13px] text-graphite-500">—</span>
                    )}
                    <span className="text-right font-mono text-[13px] text-graphite-700 max-[720px]:text-left">
                      {years(role)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-6 border-t border-line pt-7 pb-16 font-mono text-xs text-graphite-500">
        Is this about you, or is something wrong?{' '}
        <Link href={`/report/person/${person.slug}`} className="underline underline-offset-[3px] transition-colors hover:text-ink">
          Report an issue
        </Link>
        — including removal requests.
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-display text-[22px] font-semibold tracking-tight text-ink">
        {value}
      </dd>
    </div>
  );
}
