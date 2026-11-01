import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { EXIT, main, parseArgs, UsageError } from '../company-match-repair';
import type { CompanyRow, DealRow } from '../sources/partner/partner.parser';
import { invert } from './apply';
import { classify, destinationData, holdingSource, type GroupContext } from './audit';
import type { CompanyEv, Evidence, RevisionEv } from './hydrate';
import { buildPlan, ManifestError, readPlan, selectionOf } from './manifest';
import type { Op, PlannedGroup } from './types';

// --- Fixtures ------------------------------------------------------------------------

const src = (id: string, over: Partial<CompanyRow> = {}): CompanyRow => ({
  company_id: id,
  name: 'Indigo',
  country: 'US',
  city: 'New York',
  website: null,
  industry: 'Real Estate',
  verticals: null,
  about: 'A company.',
  status: 'Active',
  ...over,
});

const deal = (id: string, company: string, over: Partial<DealRow> = {}): DealRow => ({
  deal_id: id,
  company_id: company,
  deal_date: '2025-01-23',
  stage: 'Seed',
  status: 'Completed',
  currency: 'USD',
  size_local: 8_000_000,
  size_usd: 8_000_000,
  ...over,
});

function company(over: Partial<CompanyEv> = {}): CompanyEv {
  return {
    id: 'c-ag',
    slug: 'indigo-ag-inc',
    name: 'Indigo Ag Inc.',
    domain: 'indigoag.com',
    websiteUrl: 'https://indigoag.com',
    linkedinUrl: null,
    legalName: null,
    operatingStatus: 'Active',
    companyType: null,
    primarySector: 'Industrials',
    countryCode: 'US',
    hq: 'Boston, US',
    founded: 0,
    headcount: 0,
    industry: ['Agribusiness'],
    status: 'Private',
    stage: 'Series F',
    totalRaisedUsd: '1370900000',
    partnerFields: ['totalRaisedUsd', 'hq', 'industry', 'stage', 'domain'],
    partnerOnly: true,
    externalSource: 'PARTNER',
    externalId: '155553',
    mergedIntoId: null,
    moderationStatus: 'APPROVED',
    proseDigest: 'x',
    ...over,
  };
}

const emptyEvidence = (): Evidence => ({
  companies: [],
  rounds: [],
  holdings: [],
  identifiers: [],
  revisions: [],
  otherChildren: [],
  proposals: [],
  saved: [],
  reports: [],
  companyCitations: [],
  scans: [],
  apps: [],
  merges: [],
  bindings: [],
  slugsTaken: [],
  idsTaken: [],
});

const rev = (over: Partial<RevisionEv>): RevisionEv => ({
  id: 'rev-1',
  companyId: 'c-ag',
  entityType: 'company',
  entityId: 'c-ag',
  field: 'totalRaisedUsd',
  action: 'UPDATE',
  actor: 'INGEST',
  actorSource: 'PARTNER',
  before: 1312900000,
  after: 1370900000,
  createdAt: '2026-10-18T00:00:00.000Z',
  ...over,
});

/** The Indigo group as hydration would see it on production. */
function indigo(over: (ev: Evidence) => void = () => {}): { ev: Evidence; ctx: GroupContext } {
  const ev = emptyEvidence();
  ev.companies = [company()];
  ev.rounds = [
    { id: 'r-ag', companyId: 'c-ag', externalSource: 'PARTNER', externalId: 'V1', amountUsd: '1312900000', kind: 'Equity', moderationStatus: 'APPROVED', roundInvestors: 3 },
    { id: 'r-re', companyId: 'c-ag', externalSource: 'PARTNER', externalId: 'V407056', amountUsd: '8000000', kind: 'Equity', moderationStatus: 'APPROVED', roundInvestors: 2 },
    { id: 'r-med', companyId: 'c-ag', externalSource: 'PARTNER', externalId: 'V444915', amountUsd: '50000000', kind: 'Equity', moderationStatus: 'APPROVED', roundInvestors: 1 },
  ];
  ev.holdings = [
    { id: 'h-ag', companyId: 'c-ag', externalSource: 'PARTNER', externalId: '155553:501', investorId: 'i-1', moderationStatus: 'APPROVED' },
    { id: 'h-re', companyId: 'c-ag', externalSource: 'PARTNER', externalId: '723159:502', investorId: 'i-2', moderationStatus: 'APPROVED' },
    { id: 'h-med', companyId: 'c-ag', externalSource: 'PARTNER', externalId: '787691:503', investorId: 'i-3', moderationStatus: 'APPROVED' },
  ];
  ev.identifiers = [
    { id: 'e1', entityId: 'c-ag', scheme: 'PARTNER', value: '155553', source: 'PARTNER' },
    { id: 'e2', entityId: 'c-ag', scheme: 'PARTNER', value: '723159', source: 'PARTNER' },
    { id: 'e3', entityId: 'c-ag', scheme: 'PARTNER', value: '787691', source: 'PARTNER' },
    { id: 'e4', entityId: 'c-ag', scheme: 'DOMAIN', value: 'indigoag.com', source: 'PARTNER' },
    { id: 'e5', entityId: 'c-ag', scheme: 'DOMAIN', value: 'useindigo.com', source: 'PARTNER' },
    { id: 'e6', entityId: 'c-ag', scheme: 'DOMAIN', value: 'getindigo.com', source: 'PARTNER' },
  ];
  ev.revisions = [rev({})];
  over(ev);
  const ctx: GroupContext = {
    companyIds: ['c-ag'],
    sourceIds: ['155553', '723159', '787691'],
    facts: new Map([
      ['155553', src('155553', { name: 'Indigo Ag, Inc.', website: 'https://www.indigoag.com', city: 'Boston', industry: 'Agribusiness' })],
      ['723159', src('723159', { website: 'useindigo.com' })],
      ['787691', src('787691', { website: 'getindigo.com', city: 'Miami', industry: 'Insurance' })],
    ]),
    deals: new Map([
      ['155553', [deal('V1', '155553', { stage: 'Series F', size_usd: 1312900000 })]],
      ['723159', [deal('V407056', '723159')]],
      ['787691', [deal('V444915', '787691', { stage: 'Series B', deal_date: '2026-01-29', size_usd: 50000000 })]],
    ]),
    dealCompany: new Map([
      ['V1', '155553'],
      ['V407056', '723159'],
      ['V444915', '787691'],
    ]),
    existingBindings: new Map(),
    fingerprint: 'fp',
    bindingsTable: true,
  };
  return { ev, ctx };
}

const ops = (g: PlannedGroup | null) => g?.ops ?? [];
const opsOf = <K extends Op['op']>(g: PlannedGroup | null, k: K) => ops(g).filter((o): o is Extract<Op, { op: K }> => o.op === k);

// --- Classification ---------------------------------------------------------------

describe('classify — the Indigo acceptance example', () => {
  const { ev, ctx } = indigo();
  const r = classify('src:155553+723159+787691', ev, 'h', ctx);

  it('is repairable with 155553 as the anchor', () => {
    expect(r.audited.class).toBe('repairable');
    expect(r.audited.anchor).toBe('155553');
    expect(r.audited.moves).toEqual(['723159', '787691']);
  });

  it('creates one source-owned company per moved identity, deterministic slugs, its own total', () => {
    const created = opsOf(r.repair, 'createCompany');
    expect(created.map((c) => c.data.slug)).toEqual(['indigo-723159', 'indigo-787691']);
    expect(created.map((c) => c.data.totalRaisedUsd)).toEqual(['8000000', '50000000']);
    expect(created.map((c) => c.data.stage)).toEqual(['Seed', 'Series B']);
    expect(created.every((c) => c.data.partnerOnly === true && c.data.externalSource === 'PARTNER')).toBe(true);
    expect(created.map((c) => c.data.domain)).toEqual(['useindigo.com', 'getindigo.com']);
  });

  it('moves exactly the rounds, holdings and identifiers the source says belong elsewhere', () => {
    expect(opsOf(r.repair, 'moveRound').map((o) => o.id)).toEqual(['r-re', 'r-med']);
    expect(opsOf(r.repair, 'moveHolding').map((o) => o.id)).toEqual(['h-re', 'h-med']);
    expect(opsOf(r.repair, 'moveIdentifier').map((o) => `${o.scheme}:${o.value}`).sort()).toEqual([
      'DOMAIN:getindigo.com',
      'DOMAIN:useindigo.com',
      'PARTNER:723159',
      'PARTNER:787691',
    ]);
  });

  it('lowers the incumbent total by exactly the moved raises — never deletes a round', () => {
    expect(opsOf(r.repair, 'setCompanyField')).toEqual([
      { op: 'setCompanyField', companyId: 'c-ag', field: 'totalRaisedUsd', before: '1370900000', after: '1312900000' },
    ]);
    expect(ops(r.repair).some((o) => (o.op as string).startsWith('delete'))).toBe(false);
    expect(r.repair!.expect.amountUsd).toBe('1370900000');
  });

  it('binds every identity and explains the split with names and counts only', () => {
    const bindings = opsOf(r.repair, 'upsertBinding');
    expect(bindings.map((b) => [b.sourceCompanyId, b.after.method])).toEqual([
      ['723159', 'repair-split'],
      ['787691', 'repair-split'],
      ['155553', 'repair-anchor'],
    ]);
    const repairs = opsOf(r.repair, 'appendRevision').filter((o) => o.action === 'REPAIR');
    expect(repairs).toHaveLength(4);
    expect(repairs[0]!.after).toEqual({ kind: 'split-out', other: { name: 'Indigo', slug: 'indigo-723159' }, rounds: 1, holdings: 1 });
    // The displayed payload carries no row ids (those stay in the private journal).
    expect(JSON.stringify(repairs.map((o) => o.after))).not.toMatch(/r-re|h-re|c-ag|crc/);
  });
});

describe('classify — what stays with a person', () => {
  const cls = (mut: (ev: Evidence, ctx: GroupContext) => void) => {
    const { ev, ctx } = indigo();
    mut(ev, ctx);
    return classify('k', ev, 'h', ctx);
  };

  it('same-domain aliases (the publisher listing one company twice) are review-only', () => {
    const r = cls((_ev, ctx) => ctx.facts.set('723159', src('723159', { website: 'indigoag.com' })));
    expect(r.audited.class).toBe('review_required');
    expect(r.audited.reasons).toContain('same_domain_aliases');
    expect(r.repair).toBeNull();
  });

  it('an alias with no website cannot be partitioned', () => {
    const r = cls((_ev, ctx) => ctx.facts.set('723159', src('723159', { website: null })));
    expect(r.audited.reasons).toContain('alias_without_domain');
  });

  it('a missing source company or deal is source_missing, never a deletion', () => {
    expect(cls((_ev, ctx) => ctx.facts.delete('787691')).audited.class).toBe('source_missing');
    expect(cls((_ev, ctx) => ctx.dealCompany.delete('V444915')).audited.reasons).toContain('source_deal_missing');
  });

  it('a reviewed merge is honoured', () => {
    const r = cls((ev) => ev.merges.push({ id: 'm', survivorId: 'c-ag', losingId: 'c-old', unmerged: false }));
    expect(r.audited.reasons).toContain('reviewed_merge');
  });

  it('a human edit, a human child or another source’s child blocks the automatic split', () => {
    expect(cls((ev) => ev.revisions.push(rev({ id: 'rv2', actor: 'ADMIN', actorSource: null, field: 'hq' }))).audited.reasons).toContain('human_edits');
    expect(
      cls((ev) => ev.rounds.push({ id: 'r-h', companyId: 'c-ag', externalSource: null, externalId: null, amountUsd: '1', kind: 'Equity', moderationStatus: 'APPROVED', roundInvestors: 0 }))
        .audited.reasons,
    ).toContain('human_children');
    expect(
      cls((ev) => ev.otherChildren.push({ table: 'PersonRole', id: 'p', companyId: 'c-ag', externalSource: 'SEC_EDGAR', moderationStatus: 'APPROVED' }))
        .audited.reasons,
    ).toContain('public_children_unresolved');
  });

  it('an eligible deal without its own round (a historical dedup) is not reconstructed', () => {
    const r = cls((_ev, ctx) => ctx.deals.get('723159')!.push(deal('V999', '723159')));
    expect(r.audited.reasons).toContain('unaccounted_deal');
  });

  it('a total another writer touched is not lowered by inference', () => {
    const r = cls((ev) => ev.revisions.push(rev({ id: 'rv3', actorSource: 'SEC_EDGAR' })));
    expect(r.audited.reasons).toContain('uncertain_total');
  });

  it('a total that needs no change needs no proof', () => {
    const r = cls((ev) => {
      ev.companies[0] = company({ totalRaisedUsd: '0', partnerFields: [] });
      for (const x of ev.rounds) x.amountUsd = '0';
    });
    expect(r.audited.class).toBe('repairable');
    expect(opsOf(r.repair, 'setCompanyField')).toEqual([]);
  });
});

describe('classify — children and retractions', () => {
  it('a source id whose rounds sit on another company joins both, and is left for review', () => {
    const { ev, ctx } = indigo((e) => {
      e.companies.push(company({ id: 'c-other', slug: 'other', externalSource: 'SEC_EDGAR', externalId: '9' }));
      e.rounds[1]!.companyId = 'c-other';
    });
    ctx.companyIds = ['c-ag', 'c-other'];
    const r = classify('k', ev, 'h', ctx);
    expect(r.audited).toMatchObject({ class: 'review_required', reasons: ['children_split_across_companies'] });
    expect(r.repair).toBeNull();
  });

  it('a retracted round moves with its status and stays out of both totals', () => {
    const { ev, ctx } = indigo((e) => {
      e.rounds[1]!.moderationStatus = 'REJECTED';
    });
    const r = classify('k', ev, 'h', ctx);
    expect(opsOf(r.repair, 'moveRound').map((o) => o.id)).toContain('r-re');
    const created = opsOf(r.repair, 'createCompany');
    expect(created[0]!.data.totalRaisedUsd).toBe('0');
    // Moving ownership is not re-approval: no op touches moderation.
    expect(JSON.stringify(ops(r.repair))).not.toMatch(/moderationStatus":"APPROVED"[^}]*r-re/);
    expect(opsOf(r.repair, 'setCompanyField')[0]).toMatchObject({ after: '1320900000' });
  });
});

describe('classify — one source id on a public company', () => {
  const single = (incumbent: Partial<CompanyEv>, row: Partial<CompanyRow>) => {
    const ev = emptyEvidence();
    ev.companies = [company({ id: 'c-pub', externalSource: 'COMPANIES_HOUSE', externalId: '01', partnerFields: [], ...incumbent })];
    ev.identifiers = [{ id: 'e1', entityId: 'c-pub', scheme: 'PARTNER', value: '723159', source: 'PARTNER' }];
    const ctx: GroupContext = {
      companyIds: ['c-pub'],
      sourceIds: ['723159'],
      facts: new Map([['723159', src('723159', row)]]),
      deals: new Map(),
      dealCompany: new Map(),
      existingBindings: new Map(),
      fingerprint: 'fp',
      bindingsTable: true,
    };
    return classify('k', ev, 'h', ctx);
  };

  it('a false association (two different websites) is reported and held, never split by guess', () => {
    const r = single({ name: 'Indigo Ltd', domain: 'indigo.co.uk' }, { website: 'useindigo.com' });
    expect(r.audited.class).toBe('review_required');
    expect(r.audited.reasons).toEqual(['singleton_domain_mismatch']);
    expect(r.repair).toBeNull();
    expect(r.holds).toEqual([expect.objectContaining({ sourceId: '723159', companyId: 'c-pub', status: 'REVIEW_REQUIRED' })]);
  });

  it('the same website certifies the binding', () => {
    const r = single({ name: 'Indigo', domain: 'useindigo.com' }, { website: 'https://useindigo.com' });
    expect(r.audited.class).toBe('consistent');
    expect(r.certify).toEqual([expect.objectContaining({ status: 'RESOLVED', method: 'certified:domain' })]);
  });

  it('a name that only matched through the broad key is not evidence', () => {
    const r = single({ name: 'Indigo Ag Inc.', domain: '' }, { name: 'Indigo', website: null });
    expect(r.audited.reasons).toEqual(['singleton_unverified']);
  });
});

describe('destinationData', () => {
  it('writes the source’s own sanitized prose and partner-only provenance, never the name as a partner field', () => {
    const d = destinationData(src('723159', { website: 'useindigo.com', about: '<b>Builds</b> things.' }), [deal('V407056', '723159')], 'indigo-723159', 8_000_000n);
    expect(d.description).toBe('Builds things.');
    expect(d.partnerFields).not.toContain('name');
    expect(d.partnerFields).toEqual(expect.arrayContaining(['domain', 'totalRaisedUsd', 'stage']));
    expect(d.totalRaisedUsd).toBe('8000000');
  });
});

describe('holdingSource', () => {
  it.each([
    ['723159:502', '723159'],
    ['723159:', null],
    [':502', null],
    ['nokey', null],
    [null, null],
  ])('%s → %s', (key, sid) => expect(holdingSource(key)).toBe(sid));
});

// --- Inverse operations ----------------------------------------------------------

describe('invert', () => {
  it('reverses moves and fields, restores bindings, and deletes created rows last', () => {
    const forward: Op[] = [
      { op: 'createCompany', id: 'c-new', data: { slug: 's' } },
      { op: 'moveRound', id: 'r1', from: 'a', to: 'c-new' },
      { op: 'setCompanyField', companyId: 'a', field: 'totalRaisedUsd', before: '10', after: '8' },
      { op: 'upsertBinding', source: 'PARTNER', sourceCompanyId: '1', before: null, after: { companyId: 'c-new', status: 'RESOLVED', method: 'm', evidence: {}, evidenceHash: 'h' } },
      { op: 'appendRevision', id: 'rv', companyId: 'c-new', action: 'REPAIR', field: '', before: null, after: {}, actorSource: 'PARTNER' },
    ];
    const inv = invert(forward);
    expect(inv.map((o) => o.op)).toEqual(['restoreBinding', 'setCompanyField', 'moveRound', 'deleteCompany']);
    expect(inv[1]).toMatchObject({ before: '8', after: '10' });
    expect(inv[2]).toMatchObject({ from: 'c-new', to: 'a' });
    expect(inv[3]).toEqual({ op: 'deleteCompany', id: 'c-new', ownRevisionIds: ['rv'] });
  });
});

// --- Manifest ----------------------------------------------------------------------

describe('readPlan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-plan-'));
  const { ev, ctx } = indigo();
  const group = classify('src:155553+723159+787691', ev, 'h', ctx).repair!;
  const plan = buildPlan({ fingerprint: 'fp', bundleSha256: 'b', groups: [group], selection: selectionOf({}) });
  const write = (p: unknown, name = 'plan.json') => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(p));
    return path;
  };

  it('accepts an untouched plan, and is deterministic', () => {
    expect(readPlan(write(plan)).manifestHash).toBe(plan.manifestHash);
    expect(buildPlan({ fingerprint: 'fp', bundleSha256: 'b', groups: [group], selection: selectionOf({}) }).manifestHash).toBe(plan.manifestHash);
  });

  it('refuses a tampered plan', () => {
    const tampered = JSON.parse(JSON.stringify(plan));
    tampered.groups[0].ops.find((o: Op) => o.op === 'setCompanyField').after = '0';
    expect(() => readPlan(write(tampered, 't.json'))).toThrow(ManifestError);
  });

  it('refuses a disallowed field or operation even with a matching hash', () => {
    const evil = JSON.parse(JSON.stringify(plan));
    evil.groups[0].ops.push({ op: 'setCompanyField', companyId: 'c-ag', field: 'description', before: '', after: 'x' });
    const { manifestHash: _drop, ...body } = evil;
    void _drop;
    const rehashed = buildPlan({ fingerprint: body.databaseFingerprint, bundleSha256: body.source.bundleSha256, groups: body.groups, selection: body.selection });
    expect(() => readPlan(write(rehashed, 'e.json'))).toThrow(/field description/);
    const sql = JSON.parse(JSON.stringify(plan));
    sql.groups[0].ops.push({ op: 'executeSql', sql: 'DROP TABLE "Company"' });
    const rehashedSql = buildPlan({ fingerprint: 'fp', bundleSha256: 'b', groups: sql.groups, selection: sql.selection });
    expect(() => readPlan(write(rehashedSql, 's.json'))).toThrow(/unknown operation/);
  });

  it('refuses a malformed file', () => {
    expect(() => readPlan(write('{not json', 'm.json'))).toThrow(ManifestError);
    writeFileSync(join(dir, 'raw.json'), '{oops');
    expect(() => readPlan(join(dir, 'raw.json'))).toThrow(/not valid JSON/);
  });

  it('serializes money as strings', () => {
    expect(readFileSync(write(plan), 'utf8')).toContain('"1312900000"');
  });
});

// --- CLI guards ------------------------------------------------------------------

describe('CLI arguments', () => {
  it('defaults to audit and rejects unknown modes and options', () => {
    expect(parseArgs(['--snapshot', 's', '--out', 'o']).mode).toBe('audit');
    expect(() => parseArgs(['repair-everything'])).toThrow(UsageError);
    expect(() => parseArgs(['audit', '--snapshot', 's', '--out', 'o', '--force', 'x'])).toThrow(UsageError);
  });

  it('a write needs the plan, the exact target and an explicit yes', () => {
    expect(() => parseArgs(['apply', '--plan', 'p', '--expect-db', 'fp'])).toThrow(/--confirm yes/);
    expect(() => parseArgs(['apply', '--plan', 'p', '--confirm', 'yes'])).toThrow(/--expect-db/);
    expect(() => parseArgs(['rollback', '--expect-db', 'fp', '--confirm', 'yes'])).toThrow(/--run/);
    expect(parseArgs(['apply', '--plan', 'p', '--expect-db', 'fp', '--confirm', 'yes', '--run', '']).run).toBeUndefined();
  });

  it('exits with the usage code before touching any database', async () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none';
    try {
      expect(await main(['apply', '--plan', 'x'])).toBe(EXIT.usage);
      expect(await main(['nonsense'])).toBe(EXIT.usage);
    } finally {
      process.env.DATABASE_URL = before;
    }
  });
});

describe('CLI import graph', () => {
  it('loads no Nest application, scheduler, ingest service or error reporter', () => {
    const loaded = Object.keys(require.cache);
    for (const forbidden of ['app.module', 'ingest.scheduler', 'ingest.service', 'instrument', '@nestjs/schedule', '@sentry']) {
      expect(loaded.filter((p) => p.includes(forbidden))).toEqual([]);
    }
  });
});
