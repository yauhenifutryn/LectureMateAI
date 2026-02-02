import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeAudioLecture } from '../../services/geminiService';

describe('analyzeAudioLecture', () => {
  it('signals processing stage after job starts', async () => {
    const stages: string[] = [];
    const fakeUpload = async (_file: File) => ({
      objectName: 'uploads/job-1/test.mp3',
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
      objectName: `uploads/job-1/${file.name}`,
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

    expect(uploaded).toEqual(['uploads/job-1/audio.mp3', 'uploads/job-1/slide.pdf']);
  });

  it('allows slide-only analysis', async () => {
    const payloads: any[] = [];
    const fakeUpload = async (file: File) => ({
      objectName: `uploads/job-1/${file.name}`,
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
    const fakeUpload = async (_file: File) => ({
      objectName: 'uploads/job-1/test.mp3',
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

  it('keeps polling when a transient dispatch error is reported', async () => {
    const fakeUpload = async (_file: File) => ({
      objectName: 'uploads/job-1/test.mp3',
      mimeType: 'audio/mpeg'
    });
    const createJob = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const startJob = vi.fn().mockResolvedValue(undefined);
    const statuses = [
      { status: 'queued' as const, error: { code: 'dispatch_failed', message: 'Retrying' } },
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

    await expect(analyze(fakeFile, [], 'context')).resolves.toBeDefined();
    expect(startJob).toHaveBeenCalledWith('job-1', undefined);
  });

  it('passes selected modelId to job creation', async () => {
    const payloads: any[] = [];
    const fakeUpload = async (file: File) => ({
      objectName: `uploads/job-1/${file.name}`,
      mimeType: file.type || 'audio/mpeg'
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

    const fakeAudio = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await analyze(fakeAudio, [], 'context', {
      modelId: 'gemini-3-pro-preview'
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].modelId).toBe('gemini-3-pro-preview');
  });
});
