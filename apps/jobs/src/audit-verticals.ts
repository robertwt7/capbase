/**
 * Read-only vertical coverage audit: `make audit-verticals[-prod]`.
 *
 * Runs `deriveVerticals` over every approved, unmerged company's stored `industry` labels and
 * prints the tables the vertical plan (`thoughts/shared/plans/2026-11-16-vertical-taxonomy-
 * and-market-maps.md`) records: labels by source, coverage per sector, per-vertical membership
 * and page/index status, and the most frequent unmapped labels per source (the next mapping
 * review's worklist). It simulates the mapping, so it can run before the backfill and after any
 * mapping change.
 *
 * Plain `pg`, no Nest context, and the session is read-only at the SERVER
 * (`default_transaction_read_only`): it cannot write whatever the DATABASE_URL allows.
 */
import { Client } from 'pg';

import {
  labelSlug,
  VERTICAL_PAGE_MIN_COMPANIES,
  VERTICAL_SECTOR,
  VERTICALS,
  type Vertical,
} from '@repo/api';
import { normaliseSicText, SIC2007 } from '@repo/api/domain/sic2007';
import {
  deriveVerticals,
  FORM_D_VERTICALS,
  PARTNER_VERTICALS,
  WIKIDATA_VERTICALS,
} from '@repo/api/domain/vertical-map';

const PAGE = 10_000;
const TOP_UNMAPPED = 25;

interface Row {
  id: string;
  primarySector: string | null;
  externalSource: string | null;
  partnerOnly: boolean;
  partnerMarked: boolean;
  industry: string[];
}

const inc = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const pct = (n: number, d: number) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
const fmt = (n: number) => n.toLocaleString('en-US');

/** A label some table (or the SIC list) has reviewed, whether or not it yields a vertical. */
function reviewed(label: string, partnerMarked: boolean): boolean {
  return (
    (partnerMarked && label in PARTNER_VERTICALS) ||
    label in FORM_D_VERTICALS ||
    label in WIKIDATA_VERTICALS ||
    normaliseSicText(label) in SIC2007
  );
}

function table(head: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set\n');
    return 2;
  }
  const client = new Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on -c application_name=audit-verticals',
  });
  await client.connect();
  try {
    const ro = await client.query<{ default_transaction_read_only: string }>(
      'SHOW default_transaction_read_only',
    );
    if (ro.rows[0]?.default_transaction_read_only !== 'on')
      throw new Error('could not open a read-only session');

    // Labels by source.
    const bySource = new Map<
      string,
      {
        companies: number;
        withLabels: number;
        labels: Set<string>;
        marked: number;
        unmapped: Map<string, number>;
      }
    >();
    // Coverage per sector.
    const bySector = new Map<
      string,
      { companies: number; withVertical: number; publicVertical: number }
    >();
    // Per vertical.
    const members = new Map<Vertical, number>();
    const publicMembers = new Map<Vertical, number>();
    let multi = 0;
    let scanned = 0;
    let cursor = '';

    for (;;) {
      const { rows } = await client.query<Row>(
        `SELECT id, "primarySector", "externalSource", "partnerOnly",
                'industry' = ANY("partnerFields") AS "partnerMarked", industry
           FROM "Company"
          WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL AND id > $1
          ORDER BY id
          LIMIT $2`,
        [cursor, PAGE],
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      scanned += rows.length;

      for (const row of rows) {
        const source = row.externalSource ?? 'contributed';
        let s = bySource.get(source);
        if (!s) {
          s = { companies: 0, withLabels: 0, labels: new Set(), marked: 0, unmapped: new Map() };
          bySource.set(source, s);
        }
        s.companies++;
        if (row.industry.length > 0) s.withLabels++;
        if (row.partnerMarked && row.industry.length > 0) s.marked++;
        for (const label of row.industry) {
          s.labels.add(label);
          if (!reviewed(label, row.partnerMarked)) inc(s.unmapped, label);
        }

        const { verticals } = deriveVerticals(row.industry, row.partnerMarked);
        const sector = row.primarySector ?? '(no sector)';
        let c = bySector.get(sector);
        if (!c) {
          c = { companies: 0, withVertical: 0, publicVertical: 0 };
          bySector.set(sector, c);
        }
        c.companies++;
        if (verticals.length > 0) {
          c.withVertical++;
          if (!row.partnerMarked) c.publicVertical++;
        }
        if (verticals.length > 1) multi++;
        for (const v of verticals) {
          inc(members, v);
          if (!row.partnerMarked && !row.partnerOnly) inc(publicMembers, v);
        }
      }
    }

    const out: string[] = [];
    out.push(`# Vertical audit — ${fmt(scanned)} approved unmerged companies`, '');

    out.push('## Labels by source', '');
    out.push(
      table(
        ['Source', 'Companies', 'With labels', 'Distinct labels', '`industry` partner-marked'],
        [...bySource.entries()]
          .sort((a, b) => b[1].companies - a[1].companies)
          .map(([src, s]) => [
            src,
            fmt(s.companies),
            fmt(s.withLabels),
            fmt(s.labels.size),
            fmt(s.marked),
          ]),
      ),
      '',
    );

    out.push('## Coverage per sector', '');
    const sectorRows = [...bySector.entries()].sort((a, b) => b[1].companies - a[1].companies);
    const all = sectorRows.reduce(
      (t, [, c]) => ({
        companies: t.companies + c.companies,
        withVertical: t.withVertical + c.withVertical,
        publicVertical: t.publicVertical + c.publicVertical,
      }),
      { companies: 0, withVertical: 0, publicVertical: 0 },
    );
    out.push(
      table(
        ['Sector', 'Companies', 'With a vertical', '%', 'Public', '%'],
        [...sectorRows, ['**All**', all] as const].map(([sector, c]) => [
          sector,
          fmt(c.companies),
          fmt(c.withVertical),
          pct(c.withVertical, c.companies),
          fmt(c.publicVertical),
          pct(c.publicVertical, c.companies),
        ]),
      ),
      '',
      `${fmt(multi)} companies hold two or more verticals.`,
      '',
    );

    out.push('## Verticals', '');
    let pages = 0;
    let indexed = 0;
    out.push(
      table(
        ['Sector', 'Vertical', 'Slug', 'Companies', 'Public', 'Page'],
        VERTICALS.map((v) => {
          const n = members.get(v) ?? 0;
          const p = publicMembers.get(v) ?? 0;
          const page = n >= VERTICAL_PAGE_MIN_COMPANIES;
          const index = page && p >= VERTICAL_PAGE_MIN_COMPANIES;
          if (page) pages++;
          if (index) indexed++;
          return [
            VERTICAL_SECTOR[v],
            v,
            labelSlug(v),
            fmt(n),
            fmt(p),
            !page ? 'no page' : index ? 'page, indexed' : 'page, `noindex`',
          ];
        }),
      ),
      '',
      `${pages} verticals get a page; ${indexed} are indexable.`,
      '',
    );

    out.push(`## Top ${TOP_UNMAPPED} unreviewed labels per source`, '');
    for (const [src, s] of [...bySource.entries()].sort(
      (a, b) => b[1].companies - a[1].companies,
    )) {
      // SBIR labels are funding agencies, never industries: reviewed once, never mapped.
      if (src === 'SBIR') continue;
      const top = [...s.unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_UNMAPPED);
      if (top.length === 0) continue;
      out.push(
        `### ${src}`,
        '',
        table(
          ['Label', 'Uses'],
          top.map(([l, n]) => [l, fmt(n)]),
        ),
        '',
      );
    }

    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`audit-verticals failed: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
