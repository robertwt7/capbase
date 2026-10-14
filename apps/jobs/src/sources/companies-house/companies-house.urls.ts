import { linkedIdentifierUrl } from '@repo/api';

/** The company's own page on the register — what a registry citation points
 *  at. One definition, shared with the identifier crosswalk's link. */
export function companyUrl(number: string): string {
  return linkedIdentifierUrl('COMPANIES_HOUSE', number);
}

export const COMPANIES_HOUSE_PUBLISHER = 'Companies House';
