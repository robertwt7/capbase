import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { Button, PageContainer, SectionHeader } from '@/components/ui';
import { COMPETITORS, competitorBySlug } from '@/lib/alternatives';

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ competitor: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const competitor = competitorBySlug((await params).competitor);
  if (!competitor) return {};
  return {
    title: competitor.title,
    description: competitor.description,
    alternates: { canonical: `/alternatives/${competitor.slug}` },
  };
}

export default async function AlternativePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const competitor = competitorBySlug((await params).competitor);
  if (!competitor) notFound();

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: competitor.faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a },
          })),
        }}
      />

      <div className="max-w-3xl">
        <h1 className="font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">
          {competitor.h1}
        </h1>
        {competitor.intro.map((paragraph) => (
          <p key={paragraph} className="mt-4 max-w-[62ch] text-base leading-[1.65] text-graphite-700">
            {paragraph}
          </p>
        ))}
        <div className="mt-7 flex flex-wrap gap-3">
          <Button variant="primary" shape="pill" href="/companies">
            Browse companies
          </Button>
          <Button variant="outline" shape="pill" href="/register">
            Create a free account
          </Button>
        </div>
      </div>

      <section className="mt-14">
        <SectionHeader title={`Capbase vs ${competitor.name}`} note="At a glance" />
        <div className="mt-6 overflow-x-auto rounded-[10px] border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse bg-surface">
            <thead>
              <tr>
                <th className="w-56 p-4" />
                <th className="border-l border-line px-4 py-3 text-left font-display text-[15px] font-semibold text-ink">
                  Capbase
                </th>
                <th className="border-l border-line px-4 py-3 text-left font-display text-[15px] font-semibold text-ink">
                  {competitor.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {competitor.rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="border-t border-line px-4 py-3 text-left font-mono text-[11px] font-medium tracking-[0.14em] text-graphite-500 uppercase"
                  >
                    {row.label}
                  </th>
                  <td className="border-t border-l border-line px-4 py-3 font-mono text-sm text-ink">
                    {row.capbase}
                  </td>
                  <td className="border-t border-l border-line px-4 py-3 font-mono text-sm text-graphite-700">
                    {row.them}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 max-w-[70ch]">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">
          When {competitor.name} is still the right tool
        </h2>
        <p className="mt-3 text-base leading-[1.65] text-graphite-900">
          {competitor.whenToUseThem}
        </p>
      </section>

      <section className="mt-14">
        <SectionHeader title="Common questions" note={`${competitor.faqs.length} answers`} />
        <div className="mt-6 grid max-w-[70ch] gap-4">
          {competitor.faqs.map((faq) => (
            <section
              key={faq.q}
              className="rounded-[10px] border border-line bg-surface px-[18px] py-5"
            >
              <h3 className="font-display text-base font-semibold tracking-tight text-ink">
                {faq.q}
              </h3>
              <p className="mt-2 text-sm leading-[1.65] text-graphite-700">{faq.a}</p>
            </section>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
