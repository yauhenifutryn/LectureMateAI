import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {}
}));

import { processFilePayload } from '../../api/_lib/gemini';

const MB = 1024 * 1024;

vi.mock('../../api/_lib/gcs', () => ({
  downloadObjectBuffer: vi.fn(async (objectName: string) => {
    if (objectName.includes('small')) {
      return Buffer.alloc(2 * MB);
    }
    return Buffer.alloc(20 * MB);
  })
}));

describe('processFilePayload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inlines small non-audio files under the inline threshold', async () => {
    const ai = {
      files: {
        upload: vi.fn(),
        get: vi.fn()
      }
    };

    const result = await processFilePayload(
      ai as any,
      { objectName: 'uploads/small-slide.pdf', mimeType: 'application/pdf' },
      'Lecture Slide 1',
      'slide',
      {
        inlineThresholdBytes: 10 * MB,
        alwaysUploadAudio: true,
        pollAttempts: 1,
        pollDelayMs: 0
      }
    );

    expect(ai.files.upload).not.toHaveBeenCalled();
    expect(result.part.inlineData?.mimeType).toBe('application/pdf');
    expect(result.uploaded).toBeUndefined();
  });

  it('inlines audio when under the inline threshold to match AI Studio behavior', async () => {
    const ai = {
      files: {
        upload: vi.fn().mockResolvedValue({
          name: 'files/abc',
          uri: 'https://example.com/file',
          mimeType: 'audio/m4a'
        }),
        get: vi.fn().mockResolvedValue({
          name: 'files/abc',
          uri: 'https://example.com/file',
          mimeType: 'audio/m4a',
          state: 'ACTIVE'
        })
      }
    };

    const result = await processFilePayload(
      ai as any,
      { objectName: 'uploads/small-audio.m4a', mimeType: 'audio/m4a' },
      'Lecture Audio',
      'audio',
      {
        inlineThresholdBytes: 10 * MB,
        alwaysUploadAudio: true,
        pollAttempts: 1,
        pollDelayMs: 0
      }
    );

    expect(ai.files.upload).not.toHaveBeenCalled();
    expect(result.part.inlineData?.mimeType).toBe('audio/m4a');
    expect(result.uploaded).toBeUndefined();
  });
});
