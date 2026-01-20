import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/process';
import { generateStudyGuide } from '../../api/_lib/gemini';
import { storeResultMarkdown } from '../../api/_lib/resultStorage';

vi.mock('../../api/_lib/gemini', () => ({
  generateStudyGuide: vi.fn(async () => '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript')
}));

vi.mock('../../api/_lib/access', () => ({
  authorizeProcess: vi.fn(async () => {}),
  AccessError: class AccessError extends Error {
    status = 401;
    code = 'unauthorized';
  }
}));

vi.mock('../../api/_lib/validateBlobUrl', () => ({
  validateBlobUrl: vi.fn()
}));

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn(async () => {})
}));

vi.mock('../../api/_lib/prompts', () => ({
  getSystemInstruction: () => 'prompt'
}));

vi.mock('../../api/_lib/resultStorage', () => ({
  storeResultMarkdown: vi.fn(async () => null)
}));

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('process handler', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('passes audio and slides to generateStudyGuide', async () => {
    const req = {
      method: 'POST',
      body: {
        audio: { fileUrl: 'https://blob/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [{ fileUrl: 'https://blob/slide.pdf', mimeType: 'application/pdf' }],
        userContext: 'ctx'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(vi.mocked(generateStudyGuide)).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        audio: expect.objectContaining({ mimeType: 'audio/mpeg' }),
        slides: expect.arrayContaining([expect.objectContaining({ mimeType: 'application/pdf' })])
      })
    );
  });

  it('allows slides-only requests', async () => {
    const req = {
      method: 'POST',
      body: {
        slides: [{ fileUrl: 'https://blob/slide.pdf', mimeType: 'application/pdf' }],
        userContext: 'ctx'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(vi.mocked(generateStudyGuide)).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        audio: undefined,
        slides: expect.arrayContaining([expect.objectContaining({ mimeType: 'application/pdf' })])
      })
    );
    expect(vi.mocked(storeResultMarkdown)).toHaveBeenCalledWith(
      expect.any(String),
      'https://blob/slide.pdf'
    );
  });
});
