// Company-match repair CLI: `node dist/company-match-repair.js <mode> [options]`.
//
// Modes: audit (default) | plan | apply | verify | rollback | fingerprint.
// audit / plan / verify / fingerprint open SERVER-ENFORCED read-only sessions and
// write nothing to the database. apply / rollback need the exact target
// fingerprint (--expect-db) and --confirm yes, hold the ingest lock (exit 75 if
// busy — nothing is stopped or waited for), and journal every group.
//
// Deliberately boots NO Nest context: no scheduler, no ingest-on-boot, no
// provider clients, no error reporter (repair evidence never leaves the box).
// Only `pg`, the pure repair modules and the parser helpers are loaded.
import { readFileSync } from 'node:fs';

import { runAudit, bindingGroups, bindingBatchEvidence } from './repair/audit';
import { applyPlan } from './repair/apply';
import { readOnlySession, repairTablesPresent, targetFingerprint } from './repair/db';
import { buildPlan, readPlan, selectionOf, writeAuditArtifacts, writePrivate, privateDir } from './repair/manifest';
import { rollbackRun } from './repair/rollback';
import { SourceSnapshot } from './repair/source-snapshot';
import { REPAIR_TOOL_VERSION, type BindingSelection, type PlannedGroup } from './repair/types';
import { verifyRun } from './repair/verify';

const MODES = ['audit', 'plan', 'apply', 'verify', 'rollback', 'fingerprint'] as const;
type Mode = (typeof MODES)[number];

/** Exit codes: 0 ok · 1 error/integrity failure · 2 usage · 3 conflicts/refusals · 75 lock busy. */
export const EXIT = { ok: 0, error: 1, usage: 2, conflict: 3, locked: 75 } as const;

export interface CliArgs {
  mode: Mode;
  snapshot?: string;
  out?: string;
  plan?: string;
  run?: string;
  expectDb?: string;
  confirm?: string;
  slug?: string;
  limitGroups?: number;
  bindings: BindingSelection;
  limitBindingBatches?: number;
  label?: string;
  targetIdFile?: string;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const [first, ...rest] = argv;
  const modeRaw = first && !first.startsWith('--') ? first : 'audit';
  const flags = first && !first.startsWith('--') ? rest : argv;
  if (!(MODES as readonly string[]).includes(modeRaw)) {
    throw new UsageError(`unknown mode "${modeRaw}" (expected ${MODES.join(' | ')})`);
  }
  const out: CliArgs = { mode: modeRaw as Mode, bindings: 'none' };
  const known = new Set(['snapshot', 'out', 'plan', 'run', 'expect-db', 'confirm', 'slug', 'limit-groups', 'bindings', 'limit-binding-batches', 'label', 'target-id-file']);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (!flag.startsWith('--')) throw new UsageError(`unexpected argument "${flag}"`);
    const name = flag.slice(2);
    if (!known.has(name)) throw new UsageError(`unknown option --${name}`);
    const value = flags[++i];
    if (value === undefined || value === '') continue; // an empty make variable is "not given"
    switch (name) {
      case 'snapshot':
        out.snapshot = value;
        break;
      case 'out':
        out.out = value;
        break;
      case 'plan':
        out.plan = value;
        break;
      case 'run':
        out.run = value;
        break;
      case 'expect-db':
        out.expectDb = value;
        break;
      case 'confirm':
        out.confirm = value;
        break;
      case 'slug':
        out.slug = value;
        break;
      case 'label':
        out.label = value;
        break;
      case 'target-id-file':
        out.targetIdFile = value;
        break;
      case 'limit-groups':
      case 'limit-binding-batches': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive integer`);
        if (name === 'limit-groups') out.limitGroups = n;
        else out.limitBindingBatches = n;
        break;
      }
      case 'bindings':
        if (!['none', 'certify', 'hold', 'all'].includes(value)) throw new UsageError('--bindings must be none | certify | hold | all');
        out.bindings = value as BindingSelection;
        break;
    }
  }
  const need = (cond: unknown, what: string) => {
    if (!cond) throw new UsageError(`${out.mode} needs ${what}`);
  };
  if (out.mode === 'audit' || out.mode === 'plan') {
    need(out.snapshot, '--snapshot DIR');
    need(out.out, '--out DIR');
  }
  if (out.mode === 'apply') {
    need(out.plan, '--plan FILE');
    need(out.expectDb, '--expect-db FINGERPRINT');
    need(out.confirm === 'yes', '--confirm yes');
  }
  if (out.mode === 'rollback') {
    need(out.run, '--run ID');
    need(out.expectDb, '--expect-db FINGERPRINT');
    need(out.confirm === 'yes', '--confirm yes');
  }
  if (out.mode === 'verify') need(out.run, '--run ID');
  return out;
}

function targetId(args: CliArgs, required: boolean): string | null {
  const raw = args.targetIdFile ? readFileSync(args.targetIdFile, 'utf8').trim() : process.env.REPAIR_TARGET_ID?.trim();
  if (!raw && required) {
    throw new UsageError(
      'REPAIR_TARGET_ID (or --target-id-file) is required: a UUID provisioned for THIS database, never generated at apply time',
    );
  }
  return raw || null;
}

const log = (m: string) => process.stdout.write(`[company-match-repair] ${m}\n`);

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return EXIT.usage;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set\n');
    return EXIT.usage;
  }
  try {
    switch (args.mode) {
      case 'fingerprint':
        return await fingerprintMode(url, args);
      case 'audit':
      case 'plan':
        return await auditOrPlan(url, args);
      case 'apply':
        return await applyMode(url, args);
      case 'verify':
        return await verifyMode(url, args);
      case 'rollback':
        return await rollbackMode(url, args);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n`);
      return EXIT.usage;
    }
    process.stderr.write(`company-match-repair failed: ${(e as Error).message}\n`);
    return EXIT.error;
  }
}

async function fingerprintMode(url: string, args: CliArgs): Promise<number> {
  const q = await readOnlySession(url);
  try {
    const { fingerprint, identity } = await targetFingerprint(q, targetId(args, true)!);
    log(`database ${identity.database} (oid ${identity.databaseOid}), server ${identity.server}`);
    process.stdout.write(`${fingerprint}\n`);
    return EXIT.ok;
  } finally {
    await q.end();
  }
}

async function auditOrPlan(url: string, args: CliArgs): Promise<number> {
  const planning = args.mode === 'plan';
  const snap = await SourceSnapshot.open(args.snapshot!);
  log(`bundle ${snap.bundleSha256.slice(0, 16)}… (${snap.companyIds.size} companies, ${snap.dealCompany.size} deals)`);
  const q = await readOnlySession(url);
  try {
    const tables = await repairTablesPresent(q);
    if (planning && !tables.ledger) throw new Error('plan needs the company_repair migration applied (CompanyRepairRun/Group missing)');
    const id = targetId(args, planning);
    const fp = id ? (await targetFingerprint(q, id)).fingerprint : 'unprovisioned';
    const audit = await runAudit(q, snap, { slug: args.slug ?? null, fingerprint: fp, log });
    const meta = {
      tool: REPAIR_TOOL_VERSION,
      mode: args.mode,
      databaseFingerprint: fp,
      bundleSha256: snap.bundleSha256,
      slug: args.slug ?? null,
      generatedAt: new Date().toISOString(),
      bindingTablesPresent: tables.bindings,
    };
    writeAuditArtifacts(args.out!, audit, meta);
    log(
      `classes: ${Object.entries(audit.counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')} · ${audit.coverage.trivialAnchors} clean anchors · ${audit.repairs.length} repair groups · ` +
        `${audit.certify.length} certifications · ${audit.holds.length} holds`,
    );
    if (!planning) return EXIT.ok;

    const repairs = args.limitGroups ? audit.repairs.slice(0, args.limitGroups) : audit.repairs;
    const groups: PlannedGroup[] = [...repairs];
    const want = (k: 'certify' | 'hold') => args.bindings === 'all' || args.bindings === k;
    for (const kind of ['certify', 'hold'] as const) {
      if (!want(kind)) continue;
      const candidates = kind === 'certify' ? audit.certify : audit.holds;
      const planned = bindingGroups(kind, candidates, () => '', args.limitBindingBatches ?? null);
      for (const g of planned) {
        await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
          g.observedHash = await bindingBatchEvidence(
            q,
            g.ops.map((o) => ({ sourceId: (o as { sourceCompanyId: string }).sourceCompanyId, companyId: (o as { after: { companyId: string } }).after.companyId })),
            true,
          );
        } finally {
          await q.query('COMMIT');
        }
      }
      groups.push(...planned);
    }
    const plan = buildPlan({
      fingerprint: fp,
      bundleSha256: snap.bundleSha256,
      groups,
      selection: selectionOf({ slug: args.slug, limitGroups: args.limitGroups, bindings: args.bindings, limitBindingBatches: args.limitBindingBatches }),
    });
    const path = writePrivate(args.out!, 'plan.json', JSON.stringify(plan, null, 1) + '\n');
    log(`plan ${path}: ${groups.length} groups, manifest ${plan.manifestHash}`);
    log(`target fingerprint ${fp}`);
    return EXIT.ok;
  } finally {
    await q.end();
  }
}

async function currentFingerprint(url: string, args: CliArgs): Promise<string> {
  const q = await readOnlySession(url);
  try {
    return (await targetFingerprint(q, targetId(args, true)!)).fingerprint;
  } finally {
    await q.end();
  }
}

async function applyMode(url: string, args: CliArgs): Promise<number> {
  const plan = readPlan(args.plan!);
  if (args.snapshot) {
    const snap = await SourceSnapshot.open(args.snapshot);
    if (snap.bundleSha256 !== plan.source.bundleSha256) throw new Error('SNAPSHOT is not the bundle this plan was made from');
  }
  const fp = await currentFingerprint(url, args);
  if (fp !== args.expectDb) throw new Error('EXPECT_DB does not match this database — refusing to write');
  if (plan.databaseFingerprint !== fp) throw new Error('this plan was made for a different database — refusing to write');
  const result = await applyPlan({ url, plan, fingerprint: fp, runId: args.run ?? null, label: args.label ?? null, log });
  if (result.locked) {
    log('another ingest holds the lock — nothing done; retry when it finishes');
    return EXIT.locked;
  }
  const report = { tool: REPAIR_TOOL_VERSION, manifestHash: plan.manifestHash, ...result, finishedAt: new Date().toISOString() };
  if (args.out) {
    privateDir(args.out);
    writePrivate(args.out, `apply-${result.runId}.json`, JSON.stringify(report, null, 2) + '\n');
  }
  log(`run ${result.runId}: ${result.applied.length} applied, ${result.skipped.length} already applied, ${result.conflicts.length} conflicts`);
  return result.conflicts.length ? EXIT.conflict : EXIT.ok;
}

async function verifyMode(url: string, args: CliArgs): Promise<number> {
  const plan = args.plan ? readPlan(args.plan) : null;
  const q = await readOnlySession(url);
  try {
    const expect = plan ? new Map(plan.groups.filter((g) => g.kind === 'repair').map((g) => [g.key, g.expect])) : undefined;
    const result = await verifyRun(q, args.run!, expect);
    const text = JSON.stringify(result, null, 2) + '\n';
    if (args.out) {
      privateDir(args.out);
      writePrivate(args.out, `verify-${args.run}.json`, text);
    } else process.stdout.write(text);
    const failed = result.groups.filter((g) => g.failures.length);
    log(
      `run ${args.run} (${result.runStatus}): ${result.groups.length} groups, ${failed.length} with integrity failures, ` +
        `${result.groups.filter((g) => g.changedSince).length} changed since`,
    );
    return result.ok ? EXIT.ok : EXIT.error;
  } finally {
    await q.end();
  }
}

async function rollbackMode(url: string, args: CliArgs): Promise<number> {
  const fp = await currentFingerprint(url, args);
  if (fp !== args.expectDb) throw new Error('EXPECT_DB does not match this database — refusing to write');
  const result = await rollbackRun({ url, runId: args.run!, fingerprint: fp, log });
  if (result.locked) return EXIT.locked;
  log(`run ${args.run}: ${result.rolledBack.length} rolled back, ${result.refused.length} refused`);
  return result.refused.length ? EXIT.conflict : EXIT.ok;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`company-match-repair failed: ${String(err)}\n`);
      process.exit(EXIT.error);
    },
  );
}
