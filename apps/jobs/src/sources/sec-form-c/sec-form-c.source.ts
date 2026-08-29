import { Injectable, Logger } from '@nestjs/common';

import { identifyingDomain } from '../../util/domain';
import { kebab } from '../../util/slug';
import { looksLikeEntityName, titleCaseFirm } from '../../util/text';
import type {
  FetchOptions,
  IngestionSource,
  NormalizedPerson,
  NormalizedRecord,
  NormalizedRound,
} from '../ingestion-source';
import { FormCClient } from './form-c.client';
import {
  SEC_FORM_C,
  T_DISCLOSURE,
  T_ISSUER,
  T_SIGNATURE,
  T_SUBMISSION,
  groupOfferings,
  num,
  parseTsv,
  type FormCOffering,
  type FormCTables,
} from './form-c.parser';
import { parseRaisedUsd } from './progress-update';

/** The tables this source reads. Every other member of the archive
 *  (jurisdictions, co-issuers, issuer signatures) has no slot in the schema. */
const WANTED_TABLES = [T_SUBMISSION, T_ISSUER, T_DISCLOSURE, T_SIGNATURE];

/** Reg CF is retail seed capital, statutorily capped at $5M. That is a
 *  structural fact about the exemption, not a guess about the company. */
const REG_CF_STAGE = 'Seed' as const;

/**
 * SEC Form C (Regulation Crowdfunding) source.
 *
 * Every company that raises from retail investors under Reg CF files a Form C,
 * and the SEC republishes the whole corpus as quarterly bulk tables. That is
 * ~9,000 issuers with website, HQ, incorporation date, headcount and signing
 * officers — a population that appears in no other source we ingest.
 *
 * The amount raised is NOT a column: the data set publishes the target and
 * maximum only, and the proceeds appear as prose on a C-U progress update. An
 * offering with no parseable amount contributes no round rather than printing
 * its target as though the money had arrived.
 */
@Injectable()
export class SecFormCSource implements IngestionSource {
  readonly name = SEC_FORM_C;
  private readonly logger = new Logger(SecFormCSource.name);

  constructor(private readonly client: FormCClient) {}

  /** `days` is ignored — the crowdfunding data sets are quarterly snapshots of
   *  the whole corpus, not a rolling window. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const quarters = await this.client.listQuarters();
    if (quarters.length === 0) return [];

    // Merged across quarters before grouping: an offering's C is filed in one
    // quarter and its C-U often lands a year or two later.
    const tables: FormCTables = {};
    let loaded = 0;
    for (const quarter of quarters) {
      const members = await this.client.fetchQuarter(quarter.url);
      if (!members) continue;
      loaded += 1;
      for (const name of WANTED_TABLES) {
        const text = members[name];
        if (!text) continue; // a member missing from an archive is normal
        const rows = parseTsv(text);
        (tables[name] ??= []).push(...rows);
      }
    }

    if (loaded === 0) {
      this.logger.error('No Form C quarter could be downloaded — nothing to ingest');
      return [];
    }

    const offerings = groupOfferings(tables);
    this.logger.log(
      `${offerings.length} offerings from ${(tables[T_SUBMISSION] ?? []).length} filings across ${loaded}/${quarters.length} quarters`,
    );

    return this.toRecords(offerings, opts.limit);
  }

  /** One record per issuer CIK: an issuer that ran several offerings must not
   *  upsert its company row once per offering. */
  private toRecords(offerings: FormCOffering[], limit: number): NormalizedRecord[] {
    const byCik = new Map<string, FormCOffering[]>();
    for (const offering of offerings) {
      if (!offering.cik) continue;
      const list = byCik.get(offering.cik);
      if (list) list.push(offering);
      else byCik.set(offering.cik, [offering]);
    }

    const out: NormalizedRecord[] = [];
    let withRounds = 0;
    for (const [cik, group] of byCik) {
      if (out.length >= limit) break;
      const record = toRecord(cik, group);
      if (record.rounds?.length) withRounds += 1;
      out.push(record);
    }

    this.logger.log(
      `Normalized ${out.length} Reg CF issuers, ${withRounds} of them with a reported raise`,
    );
    return out;
  }
}

/** Assemble one issuer from every offering it filed, newest first. */
export function toRecord(cik: string, group: FormCOffering[]): NormalizedRecord {
  const offerings = [...group].sort((a, b) =>
    b.offering.filedAt.localeCompare(a.offering.filedAt),
  );
  const newest = offerings[0]!;
  const info = newest.offering.info;

  const name = (info.NAMEOFISSUER ?? '').trim() || `Reg CF issuer ${cik}`;
  const website = (info.ISSUERWEBSITE ?? '').trim();
  const city = info.CITY ? titleCaseFirm(info.CITY) : '';
  const hq = [city, (info.STATEORCOUNTRY ?? '').trim()].filter(Boolean).join(', ');
  const portal = (info.COMPANYNAME ?? '').trim();

  const rounds: NormalizedRound[] = [];
  for (const offering of offerings) {
    const round = toRound(offering);
    if (round) rounds.push(round);
  }
  const totalRaisedUsd = rounds.reduce((sum, r) => sum + r.amountUsd, 0);

  return {
    source: SEC_FORM_C,
    companyExternalId: cik,
    company: {
      name,
      hq,
      foundedYear: incorporationYear(info.DATEINCORPORATION),
      // Form C has no industry field, so these rows are honestly unclassified
      // rather than guessed into a sector from the issuer's name.
      industry: [],
      primarySector: null,
      stage: REG_CF_STAGE,
      status: 'Private',
      totalRaisedUsd,
      ...(identifyingDomain(website) ? { domain: identifyingDomain(website)! } : {}),
      websiteUrl: normalizeUrl(website),
      headcount: num(newest.offering.disclosure.CURRENTEMPLOYEES) ?? 0,
      oneLiner: oneLinerFor(portal),
      description: describe(name, hq, portal, rounds.length),
    },
    ...(rounds.length ? { rounds } : {}),
    people: toPeople(cik, offerings),
  };
}

/** The offering's round, or null when no C-U reported a parseable amount.
 *  Deliberate: a target is not proceeds, and printing one as the other would
 *  make ~6,000 offerings look funded that never closed. */
function toRound(offering: FormCOffering): NormalizedRound | null {
  const progress = offering.progress;
  if (!progress) return null;

  const raised = parseRaisedUsd(
    progress.info.PROGRESSUPDATE ?? '',
    num(offering.offering.disclosure.MAXIMUMOFFERINGAMOUNT),
    progress.filedAt,
  );
  if (!raised) return null;

  const date = progress.filedAt || offering.offering.filedAt;
  if (!date) return null;

  return {
    externalId: offering.fileNumber,
    name: 'Crowdfunding raise (Reg CF)',
    date,
    amountUsd: raised,
    kind: offering.offering.disclosure.SECURITYOFFEREDTYPE === 'Debt' ? 'Debt' : 'Equity',
  };
}

/** Signing officers, keyed by CIK like the Form D people so a re-filing updates
 *  in place. Entities that signed on the issuer's behalf are not people. */
function toPeople(cik: string, offerings: FormCOffering[]): NormalizedPerson[] {
  const out: NormalizedPerson[] = [];
  const seen = new Set<string>();

  for (const offering of offerings) {
    const year = Number(offering.offering.filedAt.slice(0, 4)) || new Date().getUTCFullYear();
    for (const signer of offering.signers) {
      if (!signer.name || looksLikeEntityName(signer.name)) continue;
      const externalId = `${cik}:person:${kebab(signer.name)}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      out.push({
        externalId,
        name: signer.name,
        role: signer.title || 'Signatory',
        title: signer.title || null,
        since: year,
      });
    }
  }
  return out;
}

function oneLinerFor(portal: string): string {
  return portal
    ? `Raised capital from retail investors through a Regulation Crowdfunding offering on ${portal}.`
    : 'Raised capital from retail investors through a Regulation Crowdfunding offering.';
}

function describe(name: string, hq: string, portal: string, offerings: number): string {
  const where = hq ? ` of ${hq}` : '';
  const via = portal ? ` through the funding portal ${portal}` : '';
  const count =
    offerings > 1 ? ` It has filed ${offerings} such offerings.` : '';
  return `${name}${where} filed a Form C with the SEC to offer securities to retail investors under Regulation Crowdfunding${via}.${count}`;
}

/** `DATEINCORPORATION` is ISO on 10,944 of 10,945 offerings. */
function incorporationYear(value: string | undefined): number {
  const year = Number((value ?? '').slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : 0;
}

function normalizeUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    // Round-tripping through URL rejects the free-text junk this cell collects.
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}
