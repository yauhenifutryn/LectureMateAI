import { describe, expect, it, vi } from 'vitest';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';

const delMock = vi.fn();

vi.mock('@vercel/blob', () => ({
  del: (...args: unknown[]) => delMock(...args)
}));

describe('cleanupBlobUrls', () => {
  it('deletes each blob url', async () => {
    delMock.mockResolvedValue(undefined);
    const logger = { error: vi.fn() };

    await cleanupBlobUrls(['https://blob/a', 'https://blob/b'], logger);

    expect(delMock).toHaveBeenCalledTimes(2);
    expect(delMock).toHaveBeenCalledWith('https://blob/a');
    expect(delMock).toHaveBeenCalledWith('https://blob/b');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs failures without throwing', async () => {
    delMock.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined);
    const logger = { error: vi.fn() };

    await cleanupBlobUrls(['https://blob/a', 'https://blob/b'], logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
