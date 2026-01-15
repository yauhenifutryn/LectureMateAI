import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBlobStats, purgeAllBlobs } from '../../api/_lib/blobAdmin';

const listMock = vi.fn();
const delMock = vi.fn();

vi.mock('@vercel/blob', () => ({
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args)
}));

describe('blobAdmin helpers', () => {
  beforeEach(() => {
    listMock.mockReset();
    delMock.mockReset();
  });

  it('aggregates blob stats across pages', async () => {
    listMock
      .mockResolvedValueOnce({
        blobs: [
          { size: 100, url: 'https://blob/a' },
          { size: 200, url: 'https://blob/b' }
        ],
        cursor: 'page-2',
        hasMore: true
      })
      .mockResolvedValueOnce({
        blobs: [{ size: 50, url: 'https://blob/c' }],
        cursor: undefined,
        hasMore: false
      });

    const stats = await fetchBlobStats();

    expect(stats).toEqual({ totalSize: 350, fileCount: 3 });
  });

  it('purges all blobs and returns count', async () => {
    listMock
      .mockResolvedValueOnce({
        blobs: [{ size: 100, url: 'https://blob/a' }],
        cursor: 'page-2',
        hasMore: true
      })
      .mockResolvedValueOnce({
        blobs: [
          { size: 200, url: 'https://blob/b' },
          { size: 300, url: 'https://blob/c' }
        ],
        cursor: undefined,
        hasMore: false
      });
    delMock.mockResolvedValue(undefined);

    const deleted = await purgeAllBlobs();

    expect(deleted).toBe(3);
    expect(delMock).toHaveBeenCalledTimes(2);
    expect(delMock).toHaveBeenCalledWith(['https://blob/a']);
    expect(delMock).toHaveBeenCalledWith(['https://blob/b', 'https://blob/c']);
  });

  it('returns zero when no blobs exist', async () => {
    listMock.mockResolvedValueOnce({ blobs: [], cursor: undefined, hasMore: false });

    const deleted = await purgeAllBlobs();

    expect(deleted).toBe(0);
    expect(delMock).not.toHaveBeenCalled();
  });
});
