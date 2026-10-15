import { IsOptional, IsString, MaxLength } from 'class-validator';

import { ListCompaniesDto } from '../../companies/dto/list-companies.dto';

/** The website's directory query, plus the public API's exact domain lookup. */
export class V1ListCompaniesDto extends ListCompaniesDto {
  /** Exact match on the company's host (`example.com`; a scheme, `www.` or path is ignored).
   *  Check it before creating a company, so the same one isn't added twice. */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string;
}
