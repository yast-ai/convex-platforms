import type { PaginationOptions, PaginationResult } from 'convex/server';
import type { List, PaginationOptions as WorkOSPaginationOptions } from '@workos-inc/node';
import { ConvexError } from 'convex/values';

export async function paginateWorkOS<T>(
  opts: PaginationOptions,
  fetchPage: (opts: Pick<WorkOSPaginationOptions, 'limit' | 'after'>) => Promise<List<T>>,
): Promise<PaginationResult<T>> {
  if (!Number.isInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > 100)
    throw new ConvexError({ code: 'invalid_page_size', status: 400 });
  if (opts.endCursor != null || opts.maximumRowsRead !== undefined || opts.maximumBytesRead !== undefined)
    throw new ConvexError({ code: 'unsupported_pagination_options', status: 400 });
  const result = await fetchPage({ limit: opts.numItems, after: opts.cursor ?? undefined });
  return {
    page: result.data,
    isDone: !result.listMetadata.after,
    continueCursor: result.listMetadata.after ?? '',
  };
}
