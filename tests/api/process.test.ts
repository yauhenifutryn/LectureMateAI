import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../../api/process';
import { validateBlobUrl } from '../../api/_lib/validateBlobUrl';
import { setJobRecord } from '../../api/_lib/jobStore';

vi.mock('../../api/_lib/access', () => ({
  authorizeProcess: vi.fn(async () => ({ mode: 'demo', code: 'DEMO123' })),
  AccessError: class AccessError extends Error {
    status = 401;
    code = 'unauthorized';
  }
}));

vi.mock('../../api/_lib/validateBlobUrl', () => ({
  validateBlobUrl: vi.fn()
}));

vi.mock('../../api/_lib/jobStore', () => ({
  buildJobId: () => 'job-123',
  setJobRecord: vi.fn(async () => {})
}));

vi.mock('../../api/_lib/errors', () => ({
  toPublicError: () => ({ code: 'internal_error', message: 'Processing failed.' })
}));

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('process handler', () => {
  beforeEach(() => {
    vi.mocked(validateBlobUrl).mockReset();
    vi.mocked(setJobRecord).mockReset();
  });

  it('validates audio and slide blob urls', async () => {
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

    expect(vi.mocked(validateBlobUrl)).toHaveBeenCalledWith('https://blob/audio.mp3', undefined);
    expect(vi.mocked(validateBlobUrl)).toHaveBeenCalledWith('https://blob/slide.pdf', undefined);
    expect(vi.mocked(setJobRecord)).toHaveBeenCalledOnce();
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

    expect(vi.mocked(validateBlobUrl)).toHaveBeenCalledWith('https://blob/slide.pdf', undefined);
    expect(vi.mocked(setJobRecord)).toHaveBeenCalledOnce();
  });

  it('stores allowed modelId in the job request', async () => {
    const req = {
      method: 'POST',
      body: {
        audio: { fileUrl: 'https://blob/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [],
        userContext: 'ctx',
        modelId: 'gemini-2.5-pro'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    const call = vi.mocked(setJobRecord).mock.calls[0]?.[0] as any;
    expect(call?.request?.modelId).toBe('gemini-2.5-pro');
  });
});
