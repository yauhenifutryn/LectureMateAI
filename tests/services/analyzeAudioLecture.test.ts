import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeAudioLecture } from '../../services/geminiService';

describe('analyzeAudioLecture', () => {
  it('signals processing stage after job starts', async () => {
    const stages: string[] = [];
    const fakeUpload = async () => ({
      fileUrl: 'https://public.blob.vercel-storage.com/lectures/test.mp3',
      mimeType: 'audio/mpeg'
    });
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const statuses = [
      { status: 'processing' as const },
      { status: 'completed' as const, resultUrl: 'https://blob/result.md' }
    ];
    const getJobStatus = vi
      .fn()
      .mockImplementation(async () => statuses.shift() ?? statuses[statuses.length - 1]);
    const fetchResultText = vi
      .fn()
      .mockResolvedValue('===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript');

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      sleep: async () => {}
    });

    const fakeFile = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await analyze(fakeFile, [], 'context', {
      onStageChange: (stage) => stages.push(stage)
    });

    expect(stages[0]).toBe('uploading');
    expect(stages).toContain('processing');
    expect(startJob).toHaveBeenCalledWith('job-1', undefined);
  });

  it('provides uploaded blob urls for cleanup', async () => {
    const uploaded: string[] = [];
    const fakeUpload = async (file: File) => ({
      fileUrl: `https://public.blob.vercel-storage.com/lectures/${file.name}`,
      mimeType: 'audio/mpeg'
    });
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const getJobStatus = vi.fn().mockResolvedValue({
      status: 'completed',
      resultUrl: 'https://blob/result.md'
    });
    const fetchResultText = vi
      .fn()
      .mockResolvedValue('===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript');

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      sleep: async () => {}
    });

    const fakeAudio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;
    const fakeSlide = { name: 'slide.pdf', type: 'application/pdf' } as File;

    await analyze(fakeAudio, [fakeSlide], 'context', {
      onUploadComplete: (urls) => uploaded.push(...urls)
    });

    expect(uploaded).toEqual([
      'https://public.blob.vercel-storage.com/lectures/audio.mp3',
      'https://public.blob.vercel-storage.com/lectures/slide.pdf'
    ]);
  });

  it('allows slide-only analysis', async () => {
    const payloads: any[] = [];
    const fakeUpload = async (file: File) => ({
      fileUrl: `https://public.blob.vercel-storage.com/lectures/${file.name}`,
      mimeType: file.type || 'application/pdf'
    });
    const createJob = vi.fn().mockImplementation(async (payload: any) => {
      payloads.push(payload);
      return { jobId: 'job-1' };
    });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const getJobStatus = vi.fn().mockResolvedValue({
      status: 'completed',
      resultUrl: 'https://blob/result.md'
    });
    const fetchResultText = vi
      .fn()
      .mockResolvedValue('===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript');

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      sleep: async () => {}
    });

    const fakeSlide = { name: 'slide.pdf', type: 'application/pdf' } as File;

    await analyze(null, [fakeSlide], 'context');

    expect(payloads).toHaveLength(1);
    expect(payloads[0].audio).toBeUndefined();
    expect(payloads[0].slides).toHaveLength(1);
  });

  it('fails fast when status returns an error', async () => {
    const fakeUpload = async () => ({
      fileUrl: 'https://public.blob.vercel-storage.com/lectures/test.mp3',
      mimeType: 'audio/mpeg'
    });
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const getJobStatus = vi.fn().mockResolvedValue({
      error: { message: 'Unauthorized' }
    });
    const fetchResultText = vi.fn();

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      createJob,
      startJob,
      getJobStatus,
      fetchResultText,
      sleep: async () => {}
    });

    const fakeFile = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await expect(analyze(fakeFile, [], 'context')).rejects.toThrow('Unauthorized');
  });
});
