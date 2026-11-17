import 'reflect-metadata';
import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MAX_COMPANY_VERTICALS, VERTICALS } from '@repo/api';

import { COMPANY_BLANKS } from '../../gate/gate';
import { CompanyEditFieldsDto } from './create-proposal.dto';
import { ListCompaniesDto } from './list-companies.dto';

const listErrors = (query: Record<string, unknown>) =>
  validate(plainToInstance(ListCompaniesDto, query), { whitelist: true });
const editErrors = (changes: Record<string, unknown>) =>
  validate(plainToInstance(CompanyEditFieldsDto, changes), { whitelist: true });

describe('ListCompaniesDto vertical', () => {
  it('accepts a vertical from the vocabulary', async () => {
    expect(await listErrors({ vertical: 'Banking' })).toHaveLength(0);
  });

  it('rejects anything else, case included', async () => {
    expect(await listErrors({ vertical: 'Nope' })).not.toHaveLength(0);
    expect(await listErrors({ vertical: 'banking' })).not.toHaveLength(0);
  });
});

describe('CompanyEditFieldsDto verticals', () => {
  it('accepts up to MAX_COMPANY_VERTICALS distinct verticals, or none', async () => {
    expect(await editErrors({ verticals: VERTICALS.slice(0, MAX_COMPANY_VERTICALS) })).toHaveLength(
      0,
    );
    expect(await editErrors({ verticals: [] })).toHaveLength(0);
  });

  it('rejects too many, duplicates and unknown values', async () => {
    expect(
      await editErrors({ verticals: VERTICALS.slice(0, MAX_COMPANY_VERTICALS + 1) }),
    ).not.toHaveLength(0);
    expect(await editErrors({ verticals: ['Banking', 'Banking'] })).not.toHaveLength(0);
    expect(await editErrors({ verticals: ['Banking', 'Nope'] })).not.toHaveLength(0);
    expect(await editErrors({ verticals: 'Banking' })).not.toHaveLength(0);
  });
});

describe('COMPANY_BLANKS', () => {
  it('blanks masked verticals to an empty list, never null', () => {
    expect(COMPANY_BLANKS.verticals).toEqual([]);
  });
});
