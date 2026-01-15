import { describe, expect, it, vi } from 'vitest';
import { createRunAnalysisWithCleanup } from '../../services/geminiService';

const fakeUpload = async (file: File) => ({
  fileUrl: `https://public.blob.vercel-storage.com/lectures/${file.name}`,
  mimeType: file.type || 'audio/mpeg'
});

describe('runAnalysisWithCleanup', () => {
  it('cleans uploads after success', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const process = vi.fn().mockResolvedValue({
      text: '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript'
    });

    const run = createRunAnalysisWithCleanup({
      uploadToBlob: fakeUpload,
      processRequest: process,
      cleanupUploadedFiles: cleanup
    });

    const audio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await run(audio, [], 'context');

    expect(cleanup).toHaveBeenCalledWith([
      'https://public.blob.vercel-storage.com/lectures/audio.mp3'
    ], undefined);
  });

  it('cleans uploads after failure', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const process = vi.fn().mockResolvedValue({ error: { message: 'fail' } });

    const run = createRunAnalysisWithCleanup({
      uploadToBlob: fakeUpload,
      processRequest: process,
      cleanupUploadedFiles: cleanup
    });

    const audio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await expect(run(audio, [], 'context')).rejects.toThrow('fail');

    expect(cleanup).toHaveBeenCalledWith([
      'https://public.blob.vercel-storage.com/lectures/audio.mp3'
    ], undefined);
  });
});
