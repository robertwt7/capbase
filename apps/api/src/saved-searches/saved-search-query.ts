import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  COMPANY_QUERY_PARAMS,
  SAVED_SEARCH_NAME_MAX,
  SAVED_SEARCH_PARAMS_MAX,
  companyQueryToParams,
  validateCompanyScreen,
} from '@repo/api';
import { ListCompaniesDto } from '../companies/dto/list-companies.dto';

export function searchName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > SAVED_SEARCH_NAME_MAX
  )
    throw new BadRequestException('name must contain 1–100 characters');
  return value.trim();
}
/** Persisted input is strict. The public directory's forgiving URL parser stays unchanged. */
export async function decodeSavedParams(value: unknown) {
  if (typeof value !== 'string' || value.length > SAVED_SEARCH_PARAMS_MAX)
    throw new BadRequestException(
      'params must be a string of at most 2000 characters',
    );
  const params = new URLSearchParams(value);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!(COMPANY_QUERY_PARAMS as readonly string[]).includes(key))
      throw new BadRequestException(
        `Unsupported query key: ${key.slice(0, 80)}`,
      );
    if (seen.has(key))
      throw new BadRequestException(`Repeated query key: ${key}`);
    seen.add(key);
  }
  const values = Object.fromEntries(params);
  if (values.q !== undefined) values.q = values.q.trim();
  if (values.country !== undefined)
    values.country = values.country.trim().toUpperCase();
  const query = plainToInstance(ListCompaniesDto, values);
  const errors = await validate(query, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length)
    throw new BadRequestException(
      `Invalid query params: ${errors.map((e) => e.property).join(', ')}`,
    );
  const invalid = validateCompanyScreen(query);
  if (invalid) throw new BadRequestException(invalid);
  return { query, params: companyQueryToParams(query).toString() };
}
