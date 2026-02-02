import { describe, expect, it, vi } from 'vitest';
import { storeResultMarkdown } from '../../api/_lib/resultStorage';

const buildResultObjectNameMock = vi.fn(() => 'results/job-1/study-guide.md');
const uploadTextObjectMock = vi.fn(async () => undefined);
const createSignedReadUrlMock = vi.fn(async () => 'https://signed-read');

vi.mock('../../api/_lib/gcs', () => ({
  buildResultObjectName: (...args: unknown[]) => buildResultObjectNameMock(...args),
  uploadTextObject: (...args: unknown[]) => uploadTextObjectMock(...args),
  createSignedReadUrl: (...args: unknown[]) => createSignedReadUrlMock(...args)
}));

describe('result storage', () => {
  it('stores markdown to gcs and returns signed url', async () => {
    const url = await storeResultMarkdown('content', 'job-1');
    expect(url).toBe('https://signed-read');
    expect(buildResultObjectNameMock).toHaveBeenCalledWith('job-1');
    expect(uploadTextObjectMock).toHaveBeenCalledWith('results/job-1/study-guide.md', 'content', 'text/markdown');
    expect(createSignedReadUrlMock).toHaveBeenCalledWith('results/job-1/study-guide.md');
  });
});
