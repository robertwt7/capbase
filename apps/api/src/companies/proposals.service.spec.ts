import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { CreateChangeProposalDto } from './dto/create-proposal.dto';

function dbCompany() {
  return {
    id: 'c1',
    slug: 'helia',
    name: 'Helia',
    domain: 'helia.com',
    oneLiner: 'one liner',
    description: 'desc',
    hq: 'SF',
    founded: 2016,
    headcount: 10,
    industry: ['Fintech'],
    status: 'Private',
    stage: 'Series B',
    totalRaisedUsd: 1000n,
    lastValuationUsd: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    legalName: null,
    operatingStatus: null,
    companyType: null,
    primarySector: 'Fintech',
  };
}

function makeService() {
  const create = jest.fn(async () => ({ id: 'p1', moderationStatus: 'PENDING' }));
  const findUnique = jest.fn(async () => dbCompany());
  const prisma = {
    company: { findUnique },
    changeProposal: { create },
  } as unknown as PrismaService;
  const service = new CompaniesService(prisma, {} as unknown as UsersService);
  return { service, create };
}

describe('CompaniesService.proposeChange', () => {
  it('strips values equal to the current company state', async () => {
    const { service, create } = makeService();

    await service.proposeChange(
      'helia',
      {
        changes: {
          hq: 'SF', // no-op: same as current
          totalRaisedUsd: 1000, // no-op: BigInt column compared as number
          industry: ['Fintech'], // no-op: array compared element-wise
          headcount: 25,
        },
        note: 'source: annual report',
      } as CreateChangeProposalDto,
      'u1',
    );

    const call = (create.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(call.data.changes).toEqual({ headcount: 25 });
    expect(call.data.note).toBe('source: annual report');
    expect(call.data.moderationStatus).toBe('PENDING');
    expect(call.data.submittedById).toBe('u1');
    expect(call.data.companyId).toBe('c1');
  });

  it('rejects an all-no-op diff with 400', async () => {
    const { service, create } = makeService();

    await expect(
      service.proposeChange(
        'helia',
        { changes: { hq: 'SF', headcount: 10 } } as CreateChangeProposalDto,
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an empty changes object with 400', async () => {
    const { service, create } = makeService();

    await expect(
      service.proposeChange('helia', { changes: {} } as CreateChangeProposalDto, 'u1'),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps null when it clears a currently-set nullable field', async () => {
    const { service, create } = makeService();

    await service.proposeChange(
      'helia',
      { changes: { primarySector: null } } as unknown as CreateChangeProposalDto,
      'u1',
    );

    const call = (create.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(call.data.changes).toEqual({ primarySector: null });
  });
});
