import type { Vertical } from '@repo/api';
import { deriveVerticals } from '@repo/api/domain/vertical-map';

/** The read surface `humanVerticalCompanyIds` needs (a PrismaClient or a test fake). */
interface ProposalReader {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Company ids whose verticals a human owns: an APPROVED edit proposal changed them. Derivation
 * (ingest, the backfill) never touches these. A retraction rejects the proposal, so the company
 * leaves this set and the next derivation takes it back. Small: approved proposals only.
 */
export async function humanVerticalCompanyIds(db: ProposalReader): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ companyId: string }[]>`
    SELECT DISTINCT "companyId" FROM "ChangeProposal"
     WHERE "moderationStatus" = 'APPROVED' AND changes ? 'verticals'`;
  return new Set(rows.map((r) => r.companyId));
}

/** Whether a row's verticals carry the partner mark: derived from partner labels, and non-empty
 *  (a mark on an empty list would mask nothing). */
export const verticalsPartnerMarked = (
  partnerSource: boolean,
  verticals: readonly string[],
): boolean => partnerSource && verticals.length > 0;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The update a row needs so its `verticals` hold their derivation from `industry`, or null when
 * they already do. Pure. `'verticals'` is in `partnerFields` exactly when the derivation used
 * partner labels and is non-empty. `partnerSource` comes from the row's `'industry'` mark
 * (backfill) or the writing source (ingest).
 */
export function planVerticals(
  row: {
    verticals: readonly string[];
    industry: readonly string[];
    partnerFields: readonly string[];
  },
  partnerSource: boolean,
): { verticals: Vertical[]; partnerFields?: string[] } | null {
  const { verticals } = deriveVerticals(row.industry, partnerSource);
  const marked = row.partnerFields.includes('verticals');
  const wantMark = verticalsPartnerMarked(partnerSource, verticals);
  const sameVerticals = sameList(row.verticals, verticals);
  if (sameVerticals && marked === wantMark) return null;
  return {
    verticals,
    ...(marked !== wantMark && {
      partnerFields: wantMark
        ? [...row.partnerFields, 'verticals']
        : row.partnerFields.filter((f) => f !== 'verticals'),
    }),
  };
}
