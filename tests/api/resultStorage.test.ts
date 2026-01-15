import { describe, expect, it, vi } from 'vitest';
import { buildResultFilename, storeResultMarkdown } from '../../api/_lib/resultStorage';

const putMock = vi.fn();

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args)
}));

describe('result storage', () => {
  it('builds a deterministic filename from source url', () => {
    const name = buildResultFilename(
      'https://example.blob.vercel-storage.com/lectures/123-lecture.mp3',
      1700000000000
    );
    expect(name).toBe('results/1700000000000-123-lecture.md');
  });

  it('stores markdown with public access and correct content type', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/results/test.md', pathname: 'results/test.md' });
    const url = await storeResultMarkdown('content', 'https://example.blob.vercel-storage.com/lectures/audio.mp3', 1700000000000);
    expect(url).toBe('https://blob/results/test.md');
    expect(putMock).toHaveBeenCalledWith(
      'results/1700000000000-audio.md',
      'content',
      expect.objectContaining({ contentType: 'text/markdown', access: 'public' })
    );
  });
});
