import { describe, expect, it, vi } from 'vitest';
import { createRunAnalysisWithCleanup } from '../../services/geminiService';

const fakeUpload = async (file: File) => ({
  fileUrl: `https://public.blob.vercel-storage.com/lectures/${file.name}`,
  mimeType: file.type || 'audio/mpeg'
});

describe('runAnalysisWithCleanup', () => {
  it('does not clean uploads after success', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const getJobStatus = vi.fn().mockResolvedValue({
      status: 'completed',
      resultUrl: 'https://blob/result.md'
    });
    const fetchResultText = vi
      .fn()
      .mockResolvedValue('===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript');

    const run = createRunAnalysisWithCleanup({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      cleanupUploadedFiles: cleanup,
      sleep: async () => {}
    });

    const audio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await run(audio, [], 'context');

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('cleans uploads after failure', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const getJobStatus = vi.fn().mockResolvedValue({
      status: 'failed',
      error: { message: 'fail' }
    });
    const fetchResultText = vi.fn();

    const run = createRunAnalysisWithCleanup({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      cleanupUploadedFiles: cleanup,
      sleep: async () => {}
    });

    const audio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await expect(run(audio, [], 'context')).rejects.toThrow('fail');

    expect(cleanup).toHaveBeenCalledWith(
      ['https://public.blob.vercel-storage.com/lectures/audio.mp3'],
      undefined
    );
  });
});
