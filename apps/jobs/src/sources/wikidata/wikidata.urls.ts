import { linkedIdentifierUrl } from '@repo/api';

/** The public page for a Wikidata entity — the citation target for anything
 *  the WIKIDATA source contributed, since `externalId` *is* the QID. Delegates
 *  to the identifier crosswalk so the Wikidata URL has one definition. */
export function wikidataEntityUrl(qid: string): string {
  return linkedIdentifierUrl('WIKIDATA', qid);
}
