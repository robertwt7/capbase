import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, MAX_V1_LIST_DEPTH } from '@repo/api';

/** The 400 message past MAX_V1_LIST_DEPTH, also the Swagger description of that response. */
export const LIST_DEPTH_MESSAGE =
  `Lists stop at row ${MAX_V1_LIST_DEPTH.toLocaleString('en-US')} (page × pageSize). ` +
  'Narrow the query (q, a filter, or domain) instead of paging further.';

/** 400 past row MAX_V1_LIST_DEPTH. Called by each /v1 list route; the website's directory
 *  routes share the DTOs and stay uncapped. */
export function assertListDepth(query: { page?: number; pageSize?: number }): void {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  if (page * pageSize > MAX_V1_LIST_DEPTH) {
    throw new BadRequestException(LIST_DEPTH_MESSAGE);
  }
}
