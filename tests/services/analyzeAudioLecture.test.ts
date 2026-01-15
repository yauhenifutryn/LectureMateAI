import { describe, it, expect } from 'vitest';
import { createAnalyzeAudioLecture } from '../../services/geminiService';

describe('analyzeAudioLecture', () => {
  it('signals processing stage after uploads finish', async () => {
    const stages: string[] = [];
    const fakeUpload = async () => ({
      fileUrl: 'https://public.blob.vercel-storage.com/lectures/test.mp3',
      mimeType: 'audio/mpeg'
    });
    const fakeProcess = async () => ({
      text: '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript'
    });

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      processRequest: fakeProcess
    });

    const fakeFile = { name: 'audio.mp3', type: 'audio/mpeg' } as File;

    await analyze(fakeFile, [], 'context', {
      onStageChange: (stage) => stages.push(stage)
    });

    expect(stages[0]).toBe('uploading');
    expect(stages).toContain('processing');
  });

  it('provides uploaded blob urls for cleanup', async () => {
    const uploaded: string[] = [];
    const fakeUpload = async (file: File) => ({
      fileUrl: `https://public.blob.vercel-storage.com/lectures/${file.name}`,
      mimeType: 'audio/mpeg'
    });
    const fakeProcess = async () => ({
      text: '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript'
    });

    const analyze = createAnalyzeAudioLecture({
      uploadToBlob: fakeUpload,
      processRequest: fakeProcess
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
});
