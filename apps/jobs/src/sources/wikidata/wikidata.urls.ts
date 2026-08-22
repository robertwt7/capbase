/** The public page for a Wikidata entity — the citation target for anything
 *  the WIKIDATA source contributed, since `externalId` *is* the QID. */
export function wikidataEntityUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}
