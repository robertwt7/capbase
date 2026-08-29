import { describe, it, expect } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import { SecS1Source } from './sec-s1.source';
import type { S1Client, S1Ref } from './s1.client';
import type { NormalizedInvestor } from '../ingestion-source';

const REF: S1Ref = {
  cik: '0002021880',
  accession: '0001193125-25-013425',
  file: 'd915070ds1a.htm',
  form: 'S-1/A',
  filedAt: '2025-01-27',
  filer: 'HMH Holding Inc',
};

/** The ownership table structure real filings use: upper-case markup, the `%`
 *  sign in its own column, a firm, a director and a group summary row. */
const DOCUMENT =
  `<HTML>${'<P>Filler prose to push the section past the front matter. '.repeat(40)}</P>` +
  `<P><B>PRINCIPAL STOCKHOLDERS</B></P>` +
  `<TABLE>` +
  `<TR><TD>Name of Beneficial Owner</TD><TD>Shares</TD><TD></TD><TD>Percent</TD><TD></TD></TR>` +
  `<TR><TD>Entities affiliated with New Enterprise Associates(1)</TD><TD>12,345,678</TD><TD></TD><TD>18.4</TD><TD>%</TD></TR>` +
  `<TR><TD>Jane Founder(2)</TD><TD>2,000,000</TD><TD></TD><TD>3.0</TD><TD>%</TD></TR>` +
  `<TR><TD>All executive officers and directors as a group (8 persons)</TD><TD>6,500,000</TD><TD></TD><TD>9.7</TD><TD>%</TD></TR>` +
  `</TABLE></HTML>`;

function config(env: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function client(refs: S1Ref[], docs: Record<string, string | null>): S1Client {
  return {
    listS1Docs: async () => refs,
    fetchDocument: async (ref: S1Ref) => docs[ref.accession] ?? null,
  } as unknown as S1Client;
}

const RUN = { days: 1, limit: 10 };

describe('SecS1Source', () => {
  it('emits one record per filer, carrying holders but no rounds or money', () => {
    return new SecS1Source(client([REF], { [REF.accession]: DOCUMENT }), config())
      .fetch(RUN)
      .then((records) => {
        expect(records).toHaveLength(1);
        const [record] = records;
        expect(record!.source).toBe('SEC_S1');
        // The CIK is stored unpadded, matching every other SEC source.
        expect(record!.companyExternalId).toBe('2021880');
        expect(record!.company.name).toBe('HMH Holding Inc');
        // An S-1 says who owns the company, not what it raised.
        expect(record!.rounds).toBeUndefined();
        expect(record!.company.totalRaisedUsd).toBe(0);
      });
  });

  it('publishes only firms, and only against a firm we already know', async () => {
    const [record] = await new SecS1Source(
      client([REF], { [REF.accession]: DOCUMENT }),
      config(),
    ).fetch(RUN);

    expect(record!.investors).toEqual<NormalizedInvestor[]>([
      {
        externalId: '2021880:holder:new-enterprise-associates',
        name: 'New Enterprise Associates',
        type: 'Venture',
        firstRound: 'Undisclosed',
        rounds: 0,
        onlyIfKnown: true,
      },
    ]);
  });

  it('drops the individual director and the group summary row', async () => {
    const [record] = await new SecS1Source(
      client([REF], { [REF.accession]: DOCUMENT }),
      config(),
    ).fetch(RUN);
    const names = record!.investors!.map((i) => i.name);
    expect(names).not.toContain('Jane Founder');
    expect(names.some((n) => /as a group/i.test(n))).toBe(false);
  });

  it('emits nothing for a filing with no ownership table', async () => {
    const records = await new SecS1Source(
      client([REF], { [REF.accession]: '<HTML><P>No such section.</P></HTML>' }),
      config(),
    ).fetch(RUN);
    expect(records).toEqual([]);
  });

  it('gates on S1_MIN_CONFIDENCE', async () => {
    // This table's header says "Holder", which is not a recognised
    // beneficial-owner header, so its rows score 0.8 rather than 1.0.
    const weaker = DOCUMENT.replace('Name of Beneficial Owner', 'Holder');
    const client80 = client([REF], { [REF.accession]: weaker });

    const kept = await new SecS1Source(client80, config()).fetch(RUN);
    expect(kept[0]!.investors).toHaveLength(1);

    const dropped = await new SecS1Source(client80, config({ S1_MIN_CONFIDENCE: '0.9' })).fetch(
      RUN,
    );
    expect(dropped).toEqual([]);
  });

  it('reads one document per filer, however many amendments it filed', async () => {
    const amendment: S1Ref = { ...REF, accession: '0001193125-25-999999', filedAt: '2025-03-01' };
    const fetched: string[] = [];
    const spy = {
      listS1Docs: async () => [REF, amendment],
      fetchDocument: async (ref: S1Ref) => {
        fetched.push(ref.accession);
        return DOCUMENT;
      },
    } as unknown as S1Client;

    await new SecS1Source(spy, config()).fetch(RUN);
    expect(fetched).toEqual([REF.accession]);
  });

  it('stops at the document limit', async () => {
    const refs = Array.from({ length: 5 }, (_, i) => ({ ...REF, cik: `000${i}`, accession: `a-${i}` }));
    const docs = Object.fromEntries(refs.map((r) => [r.accession, DOCUMENT]));
    const records = await new SecS1Source(client(refs, docs), config()).fetch({
      days: 1,
      limit: 2,
    });
    expect(records).toHaveLength(2);
  });
});
