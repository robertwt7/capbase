import type { Seed } from './types';
import { adminUser } from './001-admin-user';
import { demoCompanies } from './002-demo-companies';

/** Ordered seed registry. To add a phase: create `NNN-name.ts` exporting a
 *  `Seed`, append it here. Applied phases are recorded in SeedHistory and
 *  never re-run — never edit or rename a phase that has shipped; add a new
 *  one instead (same rule as schema migrations). */
export const seeds: readonly Seed[] = [adminUser, demoCompanies];
