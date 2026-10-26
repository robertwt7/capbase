import { readFile, stat } from 'node:fs/promises';

import { runPatentPilot, type PatentPilotReport } from './patent-pilot/pilot';

/** Standalone read-only pilot. No Nest app, database client, scheduler or ingest bootstrap. */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('node apps/jobs/dist/pilot-company-patents.js [--companies 25] [--requests 100] [--pages 2] [--since YYYY-MM-DD] [--previous report.json]\n');
    return;
  }
  const allowed = new Set(['--companies', '--requests', '--pages', '--since', '--previous']);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    const value = args[index + 1];
    if (!allowed.has(key) || value === undefined || values.has(key)) throw new Error('Invalid pilot arguments; use --help');
    values.set(key, value);
  }
  let previous: PatentPilotReport | undefined;
  const previousPath = values.get('--previous');
  if (previousPath) {
    if ((await stat(previousPath)).size > 20 * 1024 * 1024) throw new Error('Previous report is too large');
    const parsed = JSON.parse(await readFile(previousPath, 'utf8')) as PatentPilotReport;
    if (parsed.schemaVersion !== 1 || parsed.source !== 'EPO_OPS' || !Array.isArray(parsed.companies)) {
      throw new Error('Invalid previous pilot report');
    }
    previous = parsed;
  }
  const report = await runPatentPilot({
    companies: Number(values.get('--companies') ?? 25),
    requests: Number(values.get('--requests') ?? 100),
    pages: Number(values.get('--pages') ?? 2),
    since: values.get('--since'),
  }, { key: process.env.EPO_OPS_CONSUMER_KEY, secret: process.env.EPO_OPS_CONSUMER_SECRET }, previous);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'CANDIDATES_REQUIRE_ADJUDICATION') process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write('Patent pilot failed: invalid configuration, input report or resource limit. Use --help.\n');
  process.exitCode = 1;
});
