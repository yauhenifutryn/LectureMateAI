import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {}
}));

import { processFilePayload } from '../../api/_lib/gemini';

const MB = 1024 * 1024;

const makeFetchResponse = (bytes: number) => ({
  ok: true,
  arrayBuffer: async () => Buffer.alloc(bytes)
});

describe('processFilePayload', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('inlines small non-audio files under the inline threshold', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeFetchResponse(2 * MB));
    const ai = {
      files: {
        upload: vi.fn(),
        get: vi.fn()
      }
    };

    const result = await processFilePayload(
      ai as any,
      { fileUrl: 'https://example.com/slide.pdf', mimeType: 'application/pdf' },
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeFetchResponse(2 * MB));
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
      { fileUrl: 'https://example.com/audio.m4a', mimeType: 'audio/m4a' },
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
