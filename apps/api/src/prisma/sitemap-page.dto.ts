import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** `?page=N` on the four `GET /<family>/sitemap` reads — 0-based, one
 *  `SITEMAP_PAGE_SIZE` page each. Omitted means page 0. */
export class SitemapPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  page?: number;
}
