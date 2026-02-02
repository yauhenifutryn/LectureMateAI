import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/gcs/upload-url';

vi.mock('../../api/_lib/access', () => ({
  authorizeUpload: vi.fn(async () => ({ mode: 'demo', code: 'DEMO', remaining: 3 }))
}));

vi.mock('../../api/_lib/gcs', () => ({
  buildUploadObjectName: vi.fn(() => 'uploads/job-1/test.mp3'),
  createSignedUploadUrl: vi.fn(async () => 'https://signed-upload')
}));

const createRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as VercelResponse & { statusCode: number; body: unknown };
};

const createReq = (overrides: Partial<VercelRequest> = {}) =>
  ({
    method: 'POST',
    headers: {},
    body: {},
    ...overrides
  }) as VercelRequest;

describe('gcs upload url endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns uploadUrl and objectName', async () => {
    const req = createReq({
      body: { filename: 'audio.mp3', mimeType: 'audio/mp3', jobId: 'job-1', demoCode: 'DEMO' }
    });
    const res = createRes();

    await handler(req, res);

    const json = res.body as { uploadUrl: string; objectName: string };
    expect(res.statusCode).toBe(200);
    expect(json.uploadUrl).toBe('https://signed-upload');
    expect(json.objectName).toContain('uploads/job-1');
  });
});
