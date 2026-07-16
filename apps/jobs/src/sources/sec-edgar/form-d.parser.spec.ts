import { describe, it, expect } from '@jest/globals';

import { parseFormD } from './form-d.parser';

/** Minimal primary_doc.xml in the shape SEC EDGAR serves for Form D filings. */
function relatedPerson(opts: {
  first?: string;
  middle?: string;
  last?: string;
  relationships?: string[];
  clarification?: string;
}): string {
  const relationships = (opts.relationships ?? ['Executive Officer'])
    .map((rel) => `<relationship>${rel}</relationship>`)
    .join('\n        ');
  return `<relatedPersonInfo>
      <relatedPersonName>
        ${opts.first ? `<firstName>${opts.first}</firstName>` : ''}
        ${opts.middle ? `<middleName>${opts.middle}</middleName>` : ''}
        ${opts.last ? `<lastName>${opts.last}</lastName>` : ''}
      </relatedPersonName>
      <relatedPersonRelationshipList>
        ${relationships}
      </relatedPersonRelationshipList>
      ${opts.clarification ? `<relationshipClarification>${opts.clarification}</relationshipClarification>` : ''}
    </relatedPersonInfo>`;
}

function formDXml(opts: {
  entityName?: string;
  industry?: string;
  isAmendment?: boolean;
  previousAccession?: string;
  relatedPersons?: string[];
}): string {
  const amendment = opts.isAmendment
    ? `<isAmendment>true</isAmendment>
       <previousAccessionNumber>${opts.previousAccession ?? ''}</previousAccessionNumber>`
    : '<isAmendment>false</isAmendment>';
  const relatedPersonsList = opts.relatedPersons?.length
    ? `<relatedPersonsList>
    ${opts.relatedPersons.join('\n    ')}
  </relatedPersonsList>`
    : '';

  return `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>X0708</schemaVersion>
  <submissionType>${opts.isAmendment ? 'D/A' : 'D'}</submissionType>
  ${relatedPersonsList}
  <primaryIssuer>
    <cik>0002011811</cik>
    <entityName>${opts.entityName ?? 'Acme Robotics, Inc.'}</entityName>
    <issuerAddress>
      <street1>1 Market St</street1>
      <city>San Francisco</city>
      <stateOrCountry>CA</stateOrCountry>
      <stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription>
      <zipCode>94105</zipCode>
    </issuerAddress>
    <yearOfInc>
      <withinFiveYears>true</withinFiveYears>
      <value>2021</value>
    </yearOfInc>
  </primaryIssuer>
  <offeringData>
    <industryGroup>
      <industryGroupType>${opts.industry ?? 'Other Technology'}</industryGroupType>
    </industryGroup>
    <typeOfFiling>
      <newOrAmendment>
        ${amendment}
      </newOrAmendment>
      <dateOfFirstSale>
        <value>2026-06-15</value>
      </dateOfFirstSale>
    </typeOfFiling>
    <offeringSalesAmounts>
      <totalOfferingAmount>10000000</totalOfferingAmount>
      <totalAmountSold>7500000</totalAmountSold>
      <totalRemaining>2500000</totalRemaining>
    </offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;
}

describe('parseFormD', () => {
  it('extracts issuer and offering fields from an operating-company filing', () => {
    const parsed = parseFormD(formDXml({}));
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      entityName: 'Acme Robotics, Inc.',
      city: 'San Francisco',
      state: 'CALIFORNIA',
      yearOfInc: 2021,
      industry: 'Other Technology',
      amountSoldUsd: 7500000,
      dateOfFirstSale: '2026-06-15',
      isPooledFund: false,
      isAmendment: false,
      previousAccession: null,
    });
  });

  it('flags pooled investment funds', () => {
    const parsed = parseFormD(
      formDXml({
        entityName: 'AGC Skild I a Series of AGC AI Nexus Fund LLC',
        industry: 'Pooled Investment Fund',
      }),
    );
    expect(parsed?.isPooledFund).toBe(true);
  });

  it('extracts the previous accession from a D/A amendment', () => {
    const parsed = parseFormD(
      formDXml({ isAmendment: true, previousAccession: '0001213900-26-012345' }),
    );
    expect(parsed?.isAmendment).toBe(true);
    expect(parsed?.previousAccession).toBe('0001213900-26-012345');
  });

  it('treats a missing newOrAmendment block as a new filing', () => {
    const xml = formDXml({}).replace(
      /<newOrAmendment>[\s\S]*?<\/newOrAmendment>/,
      '',
    );
    const parsed = parseFormD(xml);
    expect(parsed?.isAmendment).toBe(false);
    expect(parsed?.previousAccession).toBeNull();
  });

  it('returns null when the issuer name is missing', () => {
    expect(parseFormD('<edgarSubmission></edgarSubmission>')).toBeNull();
  });

  describe('related persons', () => {
    it('extracts an array of related persons with roles and titles', () => {
      const parsed = parseFormD(
        formDXml({
          relatedPersons: [
            relatedPerson({
              first: 'Jane',
              middle: 'Q',
              last: 'Founder',
              relationships: ['Executive Officer', 'Director'],
              clarification: 'CEO',
            }),
            relatedPerson({ first: 'John', last: 'Board', relationships: ['Director'] }),
          ],
        }),
      );
      expect(parsed?.people).toEqual([
        { name: 'Jane Q Founder', role: 'Executive Officer', title: 'CEO' },
        { name: 'John Board', role: 'Director', title: null },
      ]);
    });

    it('handles a single relatedPersonInfo object (not an array)', () => {
      const parsed = parseFormD(
        formDXml({
          relatedPersons: [relatedPerson({ first: 'Solo', last: 'Officer' })],
        }),
      );
      expect(parsed?.people).toEqual([
        { name: 'Solo Officer', role: 'Executive Officer', title: null },
      ]);
    });

    it('skips entity-like entries such as fund administrators', () => {
      const parsed = parseFormD(
        formDXml({
          relatedPersons: [
            relatedPerson({ last: 'Sydecar LLC', relationships: ['Promoter'] }),
            relatedPerson({ first: 'Acme', last: 'Capital Management' }),
            relatedPerson({ first: 'Real', last: 'Person' }),
          ],
        }),
      );
      expect(parsed?.people).toEqual([
        { name: 'Real Person', role: 'Executive Officer', title: null },
      ]);
    });

    it('returns an empty list when relatedPersonsList is absent', () => {
      expect(parseFormD(formDXml({}))?.people).toEqual([]);
    });
  });
});
