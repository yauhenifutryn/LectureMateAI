import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilePayload } from '../../api/_lib/gemini';
import { GenerationRetryError } from '../../api/_lib/gemini';
import { createSpeechTranscriptGenerator } from '../../api/_lib/speechTranscript';

type FakeOperation = {
  promise: () => Promise<[unknown]>;
};

type FakeClient = {
  batchRecognize: ReturnType<typeof vi.fn>;
};

const buildAudio = (): FilePayload => ({
  objectName: 'uploads/job/audio.mp3',
  mimeType: 'audio/mpeg'
});

describe('speech transcript generator', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TRANSCRIPT_LANGUAGE_CODES;
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('submits a Chirp 3 batch recognition request against the uploaded GCS object', async () => {
    const operation: FakeOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          results: {
            'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3': {
              transcript: {
                results: [{ alternatives: [{ transcript: 'Recovered transcript' }] }]
              }
            }
          }
        }
      ])
    };
    const client: FakeClient = {
      batchRecognize: vi.fn().mockResolvedValue([operation])
    };

    const transcribe = createSpeechTranscriptGenerator({
      clientFactory: () => client as never,
      getProjectId: () => 'lecturemateai-485823',
      getBucketName: () => 'lecturemateai-uploads-485823',
      getLocation: () => 'us'
    });

    const transcript = await transcribe(buildAudio());

    expect(transcript).toBe('Recovered transcript');
    expect(client.batchRecognize).toHaveBeenCalledWith(
      expect.objectContaining({
        recognizer: 'projects/lecturemateai-485823/locations/us/recognizers/_',
        files: [{ uri: 'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3' }],
        config: expect.objectContaining({
          model: 'chirp_3',
          languageCodes: ['auto']
        })
      })
    );
  });

  it('supports configured transcript language codes', async () => {
    process.env.TRANSCRIPT_LANGUAGE_CODES = 'en-US, pl-PL';
    const operation: FakeOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          results: {
            'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3': {
              transcript: {
                results: [{ alternatives: [{ transcript: 'Recovered transcript' }] }]
              }
            }
          }
        }
      ])
    };
    const client: FakeClient = {
      batchRecognize: vi.fn().mockResolvedValue([operation])
    };

    const transcribe = createSpeechTranscriptGenerator({
      clientFactory: () => client as never,
      getProjectId: () => 'lecturemateai-485823',
      getBucketName: () => 'lecturemateai-uploads-485823',
      getLocation: () => 'us'
    });

    await transcribe(buildAudio());

    expect(client.batchRecognize).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          languageCodes: ['en-US', 'pl-PL']
        })
      })
    );
  });

  it('reads transcript text from the V2 inlineResult transcript payload', async () => {
    const operation: FakeOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          results: {
            'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3': {
              inlineResult: {
                transcript: {
                  results: [{ alternatives: [{ transcript: 'Recovered inline transcript' }] }]
                }
              }
            }
          }
        }
      ])
    };
    const client: FakeClient = {
      batchRecognize: vi.fn().mockResolvedValue([operation])
    };

    const transcribe = createSpeechTranscriptGenerator({
      clientFactory: () => client as never,
      getProjectId: () => 'lecturemateai-485823',
      getBucketName: () => 'lecturemateai-uploads-485823',
      getLocation: () => 'us'
    });

    await expect(transcribe(buildAudio())).resolves.toBe('Recovered inline transcript');
    expect(infoSpy).toHaveBeenCalledWith(
      'Speech-to-Text transcript generated:',
      expect.objectContaining({
        audioUri: 'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3',
        transcriptLength: 'Recovered inline transcript'.length
      })
    );
  });

  it('falls back to the only result when Speech-to-Text returns a non-URI result key', async () => {
    const operation: FakeOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          results: {
            'audio.mp3': {
              inlineResult: {
                transcript: {
                  results: [{ alternatives: [{ transcript: 'Recovered by fallback key' }] }]
                }
              }
            }
          }
        }
      ])
    };
    const client: FakeClient = {
      batchRecognize: vi.fn().mockResolvedValue([operation])
    };

    const transcribe = createSpeechTranscriptGenerator({
      clientFactory: () => client as never,
      getProjectId: () => 'lecturemateai-485823',
      getBucketName: () => 'lecturemateai-uploads-485823',
      getLocation: () => 'us'
    });

    await expect(transcribe(buildAudio())).resolves.toBe('Recovered by fallback key');
  });

  it('raises a retryable error when Speech-to-Text returns no transcript text', async () => {
    const operation: FakeOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          results: {
            'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3': {
              transcript: {
                results: []
              }
            }
          }
        }
      ])
    };
    const client: FakeClient = {
      batchRecognize: vi.fn().mockResolvedValue([operation])
    };

    const transcribe = createSpeechTranscriptGenerator({
      clientFactory: () => client as never,
      getProjectId: () => 'lecturemateai-485823',
      getBucketName: () => 'lecturemateai-uploads-485823',
      getLocation: () => 'us'
    });

    await expect(transcribe(buildAudio())).rejects.toBeInstanceOf(GenerationRetryError);
    await expect(transcribe(buildAudio())).rejects.toThrow('Received empty transcript response.');
    expect(warnSpy).toHaveBeenCalledWith(
      'Speech-to-Text returned empty transcript:',
      expect.objectContaining({
        audioUri: 'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3',
        configuredLanguageCodes: ['auto'],
        matchedResultKey: 'gs://lecturemateai-uploads-485823/uploads/job/audio.mp3',
        transcriptResultCount: 0
      })
    );
  });
});
