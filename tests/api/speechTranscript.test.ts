import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    delete process.env.TRANSCRIPT_LANGUAGE_CODES;
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
  });
});
