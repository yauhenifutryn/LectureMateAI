import { del, list } from '@vercel/blob';

type BlobStats = {
  totalSize: number;
  fileCount: number;
};

const PAGE_LIMIT = 1000;

export async function fetchBlobStats(): Promise<BlobStats> {
  let totalSize = 0;
  let fileCount = 0;
  let cursor: string | undefined;

  do {
    const result = await list({ cursor, limit: PAGE_LIMIT });
    for (const blob of result.blobs) {
      totalSize += blob.size;
      fileCount += 1;
    }
    if (!result.hasMore) break;
    cursor = result.cursor;
  } while (cursor);

  return { totalSize, fileCount };
}

export async function purgeAllBlobs(): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const result = await list({ cursor, limit: PAGE_LIMIT });
    const urls = result.blobs.map((blob) => blob.url);
    if (urls.length > 0) {
      await del(urls);
      deleted += urls.length;
    }
    if (!result.hasMore) break;
    cursor = result.cursor;
  } while (cursor);

  return deleted;
}
