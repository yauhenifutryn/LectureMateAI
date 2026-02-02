import { describe, expect, it, vi } from 'vitest';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';

const deleteMock = vi.fn();

vi.mock('../../api/_lib/gcs', () => ({
  deleteObjects: (...args: unknown[]) => deleteMock(...args)
}));

describe('cleanupBlobUrls', () => {
  it('deletes each blob url', async () => {
    deleteMock.mockResolvedValue(undefined);
    const logger = { error: vi.fn() };

    await cleanupBlobUrls(['uploads/job-1/a.mp3', 'uploads/job-1/b.pdf'], logger);

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith(['uploads/job-1/a.mp3']);
    expect(deleteMock).toHaveBeenCalledWith(['uploads/job-1/b.pdf']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs failures without throwing', async () => {
    deleteMock.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined);
    const logger = { error: vi.fn() };

    await cleanupBlobUrls(['uploads/job-1/a.mp3', 'uploads/job-1/b.pdf'], logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
