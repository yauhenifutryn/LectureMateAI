import { deleteObjects, listObjects } from './gcs.js';

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
    const result = await listObjects('uploads/', cursor);
    for (const file of result.files) {
      totalSize += file.size;
      fileCount += 1;
    }
    cursor = result.nextPageToken;
  } while (cursor);

  return { totalSize, fileCount };
}

export async function purgeAllBlobs(): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const result = await listObjects('uploads/', cursor);
    const names = result.files.map((file) => file.name);
    if (names.length > 0) {
      await deleteObjects(names);
      deleted += names.length;
    }
    cursor = result.nextPageToken;
  } while (cursor);

  return deleted;
}
