import { describe, it, expect } from '@jest/globals';

import { parseFormD } from './form-d.parser';
import { toFund } from './sec-edgar.source';

const REF = {
  cik: '0001998888',
  accession: '0001104659-26-084290',
  companyName: 'ANDREESSEN HOROWITZ FUND X-B, L.P.',
  dateFiled: '2026-08-04',
};

function pooledXml(opts: { fundType?: string; offering?: string; sold?: string } = {}): string {
  return `<?xml version="1.0"?>
<edgarSubmission>
  <primaryIssuer>
    <cik>0001998888</cik>
    <entityName>Andreessen Horowitz Fund X-B, L.P.</entityName>
    <issuerAddress>
      <city>Menlo Park</city>
      <stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription>
    </issuerAddress>
    <yearOfInc><value>2023</value></yearOfInc>
  </primaryIssuer>
  <offeringData>
    <industryGroup>
      <industryGroupType>Pooled Investment Fund</industryGroupType>
      <investmentFundInfo>
        <investmentFundType>${opts.fundType ?? 'Venture Capital Fund'}</investmentFundType>
      </investmentFundInfo>
    </industryGroup>
    <offeringSalesAmounts>
      <totalOfferingAmount>${opts.offering ?? 'Indefinite'}</totalOfferingAmount>
      <totalAmountSold>${opts.sold ?? '425000000'}</totalAmountSold>
    </offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;
}

describe('toFund', () => {
  it('maps a pooled Form D filing to a fund keyed on the fund’s own CIK', () => {
    expect(toFund(REF, parseFormD(pooledXml())!)).toEqual({
      externalId: '0001998888',
      name: 'Andreessen Horowitz Fund X-B, L.P.',
      managerCrd: null,
      strategy: 'Venture capital',
      vintageYear: 2023,
      targetUsd: null,
      closedUsd: 425_000_000,
      grossAssetsUsd: null,
      hq: 'Menlo Park, CALIFORNIA',
      secFundId: null,
      cikNumber: '0001998888',
    });
  });

  it('never claims a manager — Form D does not name the firm', () => {
    expect(toFund(REF, parseFormD(pooledXml())!).managerCrd).toBeNull();
  });

  it('records a real target when the offering is not indefinite', () => {
    expect(toFund(REF, parseFormD(pooledXml({ offering: '500000000' }))!).targetUsd).toBe(
      500_000_000,
    );
  });

  it('reports no capital closed rather than $0 when nothing was sold', () => {
    expect(toFund(REF, parseFormD(pooledXml({ sold: '0', offering: 'Indefinite' }))!).closedUsd)
      .toBeNull();
  });
});
