import { Injectable, Logger } from '@nestjs/common';

import type { CsvRow } from '../../util/csv';
import type { ZipEntry } from '../../util/zip-range';
import type {
  FetchOptions,
  IngestionSource,
  NormalizedFund,
  NormalizedRecord,
} from '../ingestion-source';
import { AdvArchiveClient, type AdvArchive } from './adv-archive.client';
import { SEC_ADV_FUNDS, mapScheduleDRow } from './adv-schedule-d.parser';

/** The two filer populations, each with a base file and a Schedule D file.
 *  ERA is where most VC firms sit, so it is read first — a low `limit` still
 *  returns the most relevant slice. */
interface MemberPair {
  label: string;
  /** Archive holding the `*_ADV_Base*` member — always part 1. */
  baseArchive: keyof Pick<AdvArchive, 'part1' | 'part2'>;
  basePattern: RegExp;
  scheduleArchive: keyof Pick<AdvArchive, 'part1' | 'part2'>;
  schedulePattern: RegExp;
}

// Every member name carries the archive's date range, which changes with each
// cut — hence the `_\d` tails rather than literal filenames. The patterns are
// otherwise exact on purpose:
//   - `_7B1_` must be anchored: the archives also ship ~15 sub-tables named
//     `*_Schedule_D_7B1A17b_*`, `*_7B1A22_*`, … which sort BEFORE `_7B1_` and
//     would be picked instead. Those are the fund's brokers and auditors, not
//     the fund table.
//   - the IA base file is split in two, and only `_A` carries `1E1`
//     (Organization CRD#); `_B` is Item 2 and the state registrations.
const MEMBER_PAIRS: MemberPair[] = [
  {
    label: 'ERA',
    baseArchive: 'part1',
    basePattern: /^ERA_ADV_Base_\d[^/]*\.csv$/i,
    scheduleArchive: 'part1',
    schedulePattern: /^ERA_Schedule_D_7B1_\d[^/]*\.csv$/i,
  },
  {
    label: 'IA',
    baseArchive: 'part1',
    basePattern: /^IA_ADV_Base_A_\d[^/]*\.csv$/i,
    // The IA Schedule D member is 396 MB uncompressed and lives in part 2.
    scheduleArchive: 'part2',
    schedulePattern: /^IA_Schedule_D_7B1_\d[^/]*\.csv$/i,
  },
];

/** The filing's Organization CRD# and when it was submitted. Only filings by a
 *  manager we already hold are kept — that is what keeps this map at ~15k
 *  entries instead of ~1.5M, and is why a 533 MB member is affordable. */
interface FilingRef {
  crd: string;
  /** Epoch ms of `DateSubmitted`, 0 when unparseable. A number, not the raw
   *  cell: the SEC writes dates in formats that do not sort lexicographically. */
  submitted: number;
}

/**
 * SEC Form ADV Schedule D 7.B.(1) — the private funds each adviser reports.
 *
 * A *snapshot* source like SEC_ADV: `days` is ignored and it stays off the
 * daily cron. Unlike SEC_ADV it reads the Form ADV **Part 1 data archives**,
 * which the monthly roster download does not contain — the roster has only the
 * firm-level rollup (`fundCount`, `assetsUsd`), which names no fund at all.
 *
 * It contributes no company records and no rounds. Form ADV discloses a fund's
 * type and its gross asset value; it does NOT ask when the fund was raised or
 * how much it targeted, so vintage and size arrive later from pooled Form D
 * filings matched on the fund's name.
 */
@Injectable()
export class SecAdvFundsSource implements IngestionSource {
  readonly name = SEC_ADV_FUNDS;
  private readonly logger = new Logger(SecAdvFundsSource.name);

  constructor(private readonly client: AdvArchiveClient) {}

  /** Form ADV has no company-level data at all. */
  async fetch(): Promise<NormalizedRecord[]> {
    return [];
  }

  /** `days` is ignored — the archive is a frozen cut, not a rolling window. */
  async fetchFunds(opts: FetchOptions): Promise<NormalizedFund[]> {
    const known = opts.knownManagerCrds;
    if (!known || known.size === 0) {
      this.logger.warn(
        'No investor firms with a CRD in the database — run `make ingest SOURCE=SEC_ADV` first, or every fund would be dropped for having no manager',
      );
      return [];
    }

    const archive = await this.client.resolveArchive();
    if (!archive) return [];

    const members = new Map<string, ZipEntry[]>();
    for (const url of [archive.part1, archive.part2]) {
      members.set(url, await this.client.listMembers(url));
    }

    /** Newest filing per fund wins, so a fund that re-filed reports its latest
     *  gross assets rather than whichever row the stream happened to end on. */
    const funds = new Map<string, { fund: NormalizedFund; submitted: number }>();

    for (const pair of MEMBER_PAIRS) {
      if (funds.size >= opts.limit) break;
      await this.readPair(archive, members, pair, known, funds, opts.limit);
    }

    const out = [...funds.values()].map((f) => f.fund).slice(0, opts.limit);
    const byStrategy = new Map<string, number>();
    for (const f of out) byStrategy.set(f.strategy ?? 'Other', (byStrategy.get(f.strategy ?? 'Other') ?? 0) + 1);
    this.logger.log(
      `ADV Schedule D ${archive.label}: ${out.length} funds across ${new Set(out.map((f) => f.managerCrd)).size} managers (${[...byStrategy]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')})`,
    );
    return out;
  }

  /** Read one (base, Schedule D) pair: the base file resolves FilingID → CRD,
   *  the Schedule D file supplies the funds. */
  private async readPair(
    archive: AdvArchive,
    members: Map<string, ZipEntry[]>,
    pair: MemberPair,
    known: ReadonlySet<string>,
    funds: Map<string, { fund: NormalizedFund; submitted: number }>,
    limit: number,
  ): Promise<void> {
    const baseUrl = archive[pair.baseArchive];
    const scheduleUrl = archive[pair.scheduleArchive];
    const baseMatches = (members.get(baseUrl) ?? []).filter((e) =>
      pair.basePattern.test(basename(e.name)),
    );
    const scheduleMatches = (members.get(scheduleUrl) ?? []).filter((e) =>
      pair.schedulePattern.test(basename(e.name)),
    );
    const baseEntry = baseMatches[0];
    const scheduleEntry = scheduleMatches[0];
    if (!baseEntry || !scheduleEntry) {
      this.logger.warn(
        `${pair.label}: could not find both members (base ${baseEntry?.name ?? 'missing'}, schedule ${scheduleEntry?.name ?? 'missing'})`,
      );
      return;
    }
    // The SEC ships one base member per population today. If a future cut
    // splits it, the extra parts hold filings this pass would silently miss.
    if (baseMatches.length > 1 || scheduleMatches.length > 1) {
      this.logger.warn(
        `${pair.label}: archive holds more than one matching member — reading only ${baseEntry.name} + ${scheduleEntry.name}, ignoring ${[...baseMatches.slice(1), ...scheduleMatches.slice(1)].map((e) => e.name).join(', ')}`,
      );
    }
    this.logger.log(`${pair.label}: reading ${baseEntry.name} + ${scheduleEntry.name}`);

    const filings = new Map<string, FilingRef>();
    let baseRows = 0;
    const baseOk = await this.client.streamCsv(baseUrl, baseEntry, (row: CsvRow) => {
      baseRows += 1;
      const filingId = (row['FilingID'] ?? '').trim();
      const crd = (row['1E1'] ?? '').trim();
      // Discard filings by managers we don't hold before they cost any memory:
      // their funds would be dropped at write time anyway, for want of a
      // manager to attach to.
      if (!filingId || !crd || !known.has(crd)) return;
      filings.set(filingId, { crd, submitted: parseSubmitted(row['DateSubmitted']) });
    });
    if (!baseOk) return;
    this.logger.log(
      `${pair.label}: ${filings.size} of ${baseRows} filings are by a manager we hold`,
    );

    let scheduleRows = 0;
    let kept = 0;
    const scheduleOk = await this.client.streamCsv(scheduleUrl, scheduleEntry, (row: CsvRow) => {
      scheduleRows += 1;
      if (funds.size >= limit) return;
      const filing = filings.get((row['FilingID'] ?? '').trim());
      if (!filing) return;

      const fund = mapScheduleDRow(row, filing.crd);
      if (!fund) return;

      const existing = funds.get(fund.externalId);
      // A fund appears once per amendment; the newest filing is the current
      // state of it. Ties keep the first seen, which is stable across runs.
      if (existing && existing.submitted >= filing.submitted) return;
      if (!existing) kept += 1;
      funds.set(fund.externalId, { fund, submitted: filing.submitted });
    });
    if (!scheduleOk) return;
    this.logger.log(`${pair.label}: ${kept} funds from ${scheduleRows} Schedule D rows`);
  }
}

/** ZIP members may be stored under a directory prefix. */
function basename(name: string): string {
  return name.split('/').pop() ?? name;
}

/** `DateSubmitted` → epoch ms, 0 when absent or unparseable. Comparing the raw
 *  cells would be wrong: the SEC's date formats do not sort as strings. */
function parseSubmitted(value: string | undefined): number {
  const raw = (value ?? '').trim();
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}
