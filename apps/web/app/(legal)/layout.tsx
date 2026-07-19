import { PageContainer } from '@/components/ui';

// Shared prose shell for the legal pages (/terms, /privacy). Pages render plain
// semantic HTML; the descendant variants below carry the typography so neither
// page repeats styling. The "Last updated" line is a <div> (not <p>) so it can
// carry its own mono styling without fighting the [&_p] selectors.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <article
        className="max-w-[70ch]
          [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-ink
          [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink
          [&_p]:mt-3 [&_p]:text-[15px] [&_p]:leading-[1.7] [&_p]:text-graphite-900
          [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[15px] [&_ul]:leading-[1.7] [&_ul]:text-graphite-900
          [&_li]:mt-1
          [&_a]:underline [&_a]:underline-offset-[3px]"
      >
        {children}
      </article>
    </PageContainer>
  );
}
