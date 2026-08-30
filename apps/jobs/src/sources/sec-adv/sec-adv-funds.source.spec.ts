import { describe, it, expect, jest } from '@jest/globals';

import type { CsvRow } from '../../util/csv';
import type { ZipEntry } from '../../util/zip-range';
import type { AdvArchiveClient } from './adv-archive.client';
import { SecAdvFundsSource } from './sec-adv-funds.source';

const ARCHIVE = {
  label: '20111105-20241231',
  part1: 'https://www.sec.gov/files/adv-filing-data-20111105-20241231-part1.zip',
  part2: 'https://www.sec.gov/files/adv-filing-data-20111105-20241231-part2.zip',
};

const PREFIX = 'adv-filing-data-20111105-20241231-';

/** Member names verbatim from the real archives' central directories. The
 *  `7B1A*` sub-tables are the point: they sort BEFORE `7B1_` and name the
 *  fund's brokers and auditors, not the fund. */
const PART1_MEMBERS = [
  `${PREFIX}part1/`,
  `${PREFIX}part1/ADV_Filing_Types_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_ADV_1J_1K_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_ADV_Base_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_Schedule_D_7A_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_Schedule_D_7B1A17b_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_Schedule_D_7B1A22_20111105_20241231.csv`,
  `${PREFIX}part1/ERA_Schedule_D_7B1_20111105_20241231.csv`,
  `${PREFIX}part1/IA_ADV_Base_A_20111105_20241231.csv`,
  `${PREFIX}part1/IA_ADV_Base_B_20111105_20241231.csv`,
];

const PART2_MEMBERS = [
  `${PREFIX}part2/`,
  `${PREFIX}part2/IA_Schedule_D_7B1A17b_20111105_20241231.csv`,
  `${PREFIX}part2/IA_Schedule_D_7B1A22_20111105_20241231.csv`,
  `${PREFIX}part2/IA_Schedule_D_7B1_20111105_20241231.csv`,
];

const entry = (name: string): ZipEntry => ({
  name,
  offset: 0,
  compressedSize: 1,
  uncompressedSize: 1,
  method: 8,
});

/** Rows keyed by the member they belong to, in the real column shapes. */
const ROWS: Record<string, CsvRow[]> = {
  'ERA_ADV_Base': [
    { FilingID: '680011', '1E1': '140089', DateSubmitted: '11/13/2012' },
    // A filer whose CRD we do not hold: its funds must never be emitted.
    { FilingID: '680012', '1E1': '999999', DateSubmitted: '11/13/2012' },
  ],
  'ERA_Schedule_D_7B1': [
    {
      FilingID: '680011',
      'Fund Name': 'ACME VENTURES FUND I, L.P.',
      'Fund ID': '805-1111111111',
      State: 'CA',
      Country: 'United States',
      'Fund Type': 'Venture Capital Fund',
      'Gross Asset Value': '21339823',
    },
    {
      FilingID: '680012',
      'Fund Name': 'UNKNOWN MANAGER FUND, L.P.',
      'Fund ID': '805-2222222222',
      'Fund Type': 'Hedge Fund',
      'Gross Asset Value': '5000',
    },
  ],
  'IA_ADV_Base_A': [
    { FilingID: '679955', '1E1': '160489', DateSubmitted: '11/13/2012 01:39:54 PM' },
    { FilingID: '779955', '1E1': '160489', DateSubmitted: '03/31/2024 09:00:00 AM' },
  ],
  'IA_Schedule_D_7B1': [
    {
      FilingID: '679955',
      'Fund Name': 'BIG FUND X-B, L.P.',
      'Fund ID': '805-3333333333',
      'Fund Type': 'Private Equity Fund',
      'Gross Asset Value': '1000000',
    },
    // Same fund, re-filed later with a larger NAV — the newest filing wins.
    {
      FilingID: '779955',
      'Fund Name': 'BIG FUND X-B, L.P.',
      'Fund ID': '805-3333333333',
      'Fund Type': 'Private Equity Fund',
      'Gross Asset Value': '3030000000',
    },
  ],
};

function stubClient() {
  const read: string[] = [];
  const client = {
    resolveArchive: jest.fn(async () => ARCHIVE),
    listMembers: jest.fn(async (url: string) =>
      (url === ARCHIVE.part1 ? PART1_MEMBERS : PART2_MEMBERS).map(entry),
    ),
    streamCsv: jest.fn(async (_url: string, e: ZipEntry, onRow: (row: CsvRow) => void) => {
      const base = e.name.split('/').pop()!.replace(/_\d{8}_\d{8}\.csv$/, '');
      read.push(base);
      for (const row of ROWS[base] ?? []) onRow(row);
      return true;
    }),
  };
  return { client: client as unknown as AdvArchiveClient, read, spies: client };
}

const RUN = { days: 1, limit: 1000, knownManagerCrds: new Set(['140089', '160489']) };

describe('SecAdvFundsSource', () => {
  it('contributes no company records', async () => {
    const { client } = stubClient();
    await expect(new SecAdvFundsSource(client).fetch()).resolves.toEqual([]);
  });

  it('reads the 7B1 fund table, not the 7B1A* sub-tables that sort before it', async () => {
    const { client, read } = stubClient();
    await new SecAdvFundsSource(client).fetchFunds(RUN);

    expect(read).toEqual([
      'ERA_ADV_Base',
      'ERA_Schedule_D_7B1',
      'IA_ADV_Base_A',
      'IA_Schedule_D_7B1',
    ]);
    // IA_ADV_Base_B is Item 2 and the state registrations — it has no 1E1.
    expect(read).not.toContain('IA_ADV_Base_B');
  });

  it('drops funds whose manager is not in the known-CRD set', async () => {
    const { client } = stubClient();
    const funds = await new SecAdvFundsSource(client).fetchFunds(RUN);

    expect(funds.map((f) => f.externalId)).toEqual(['805-1111111111', '805-3333333333']);
    expect(funds.every((f) => f.managerCrd !== '999999')).toBe(true);
  });

  it('keeps the newest filing per fund, so a re-filed NAV wins', async () => {
    const { client } = stubClient();
    const funds = await new SecAdvFundsSource(client).fetchFunds(RUN);

    const big = funds.find((f) => f.externalId === '805-3333333333')!;
    expect(big.grossAssetsUsd).toBe(3_030_000_000);
    expect(big.managerCrd).toBe('160489');
  });

  it('reads nothing at all when no investor firm carries a CRD', async () => {
    const { client, spies } = stubClient();
    const funds = await new SecAdvFundsSource(client).fetchFunds({ days: 1, limit: 1000 });

    // Every fund would be dropped for want of a manager; do not spend 180 MB
    // of SEC bandwidth discovering that.
    expect(funds).toEqual([]);
    expect(spies.resolveArchive).not.toHaveBeenCalled();
  });

  it('respects the limit', async () => {
    const { client } = stubClient();
    const funds = await new SecAdvFundsSource(client).fetchFunds({ ...RUN, limit: 1 });
    expect(funds).toHaveLength(1);
  });
});
