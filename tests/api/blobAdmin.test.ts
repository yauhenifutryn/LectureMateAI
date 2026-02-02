import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBlobStats, purgeAllBlobs } from '../../api/_lib/blobAdmin';

const listObjectsMock = vi.fn();
const deleteObjectsMock = vi.fn();

vi.mock('../../api/_lib/gcs', () => ({
  listObjects: (...args: unknown[]) => listObjectsMock(...args),
  deleteObjects: (...args: unknown[]) => deleteObjectsMock(...args)
}));

describe('blobAdmin helpers', () => {
  beforeEach(() => {
    listObjectsMock.mockReset();
    deleteObjectsMock.mockReset();
  });

  it('aggregates blob stats across pages', async () => {
    listObjectsMock
      .mockResolvedValueOnce({
        files: [
          { name: 'uploads/a', size: 100 },
          { name: 'uploads/b', size: 200 }
        ],
        nextPageToken: 'page-2'
      })
      .mockResolvedValueOnce({
        files: [{ name: 'uploads/c', size: 50 }],
        nextPageToken: undefined
      });

    const stats = await fetchBlobStats();

    expect(stats).toEqual({ totalSize: 350, fileCount: 3 });
  });

  it('purges all blobs and returns count', async () => {
    listObjectsMock
      .mockResolvedValueOnce({
        files: [{ name: 'uploads/a', size: 100 }],
        nextPageToken: 'page-2'
      })
      .mockResolvedValueOnce({
        files: [
          { name: 'uploads/b', size: 200 },
          { name: 'uploads/c', size: 300 }
        ],
        nextPageToken: undefined
      });
    deleteObjectsMock.mockResolvedValue(undefined);

    const deleted = await purgeAllBlobs();

    expect(deleted).toBe(3);
    expect(deleteObjectsMock).toHaveBeenCalledTimes(2);
    expect(deleteObjectsMock).toHaveBeenCalledWith(['uploads/a']);
    expect(deleteObjectsMock).toHaveBeenCalledWith(['uploads/b', 'uploads/c']);
  });

  it('returns zero when no blobs exist', async () => {
    listObjectsMock.mockResolvedValueOnce({ files: [], nextPageToken: undefined });

    const deleted = await purgeAllBlobs();

    expect(deleted).toBe(0);
    expect(deleteObjectsMock).not.toHaveBeenCalled();
  });
});
