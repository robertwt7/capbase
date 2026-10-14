import { describe, it, expect } from '@jest/globals';

import { candidateSnapshots, snapshotUrl } from './companies-house.client';

describe('Companies House snapshots', () => {
  it('tries the current month, then the one before', () => {
    expect(candidateSnapshots(new Date('2026-10-03T12:00:00Z'))).toEqual(['2026-10-01', '2026-09-01']);
    expect(candidateSnapshots(new Date('2027-01-02T00:00:00Z'))).toEqual(['2027-01-01', '2026-12-01']);
  });

  it('builds the one-file product URL', () => {
    expect(snapshotUrl('2026-10-01')).toBe(
      'https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-2026-10-01.zip',
    );
  });
});
