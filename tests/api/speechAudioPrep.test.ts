import { describe, expect, it, vi } from 'vitest';
import type { FilePayload } from '../../api/_lib/gemini';
import { createSpeechAudioPreparer } from '../../api/_lib/speechAudioPrep';

const buildAudio = (): FilePayload => ({
  objectName: 'uploads/job/audio.m4a',
  mimeType: 'audio/m4a'
});

describe('speech audio preparation', () => {
  it('normalizes and chunks audio into temporary flac uploads', async () => {
    const downloadBuffer = vi.fn(async () => Buffer.from('source'));
    const uploadBuffer = vi.fn(async () => {});
    const deleteObjects = vi.fn(async () => {});
    const writeFile = vi.fn(async () => {});
    const readFile = vi.fn(async (filePath: string) => Buffer.from(filePath));
    const execFile = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {});

    const prepareAudio = createSpeechAudioPreparer({
      downloadBuffer,
      uploadBuffer,
      deleteObjects,
      getBucketName: () => 'lecturemateai-uploads-485823',
      makeTempDir: async () => '/tmp/stt-test',
      writeFile,
      readdir: async () => ['chunk-001.flac', 'ignore.txt', 'chunk-000.flac'],
      readFile,
      removeDir,
      execFile,
      makeUploadId: () => 'stt-session',
      getChunkSeconds: () => 3300
    });

    const prepared = await prepareAudio(buildAudio());

    expect(execFile).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
      '-segment_time',
      '3300',
      '/tmp/stt-test/chunk-%03d.flac'
    ]));
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      1,
      'uploads/_stt/stt-session/chunk-000.flac',
      expect.any(Buffer),
      'audio/flac'
    );
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      2,
      'uploads/_stt/stt-session/chunk-001.flac',
      expect.any(Buffer),
      'audio/flac'
    );
    expect(prepared.audioUris).toEqual([
      'gs://lecturemateai-uploads-485823/uploads/_stt/stt-session/chunk-000.flac',
      'gs://lecturemateai-uploads-485823/uploads/_stt/stt-session/chunk-001.flac'
    ]);

    await prepared.cleanup();

    expect(deleteObjects).toHaveBeenCalledWith([
      'uploads/_stt/stt-session/chunk-000.flac',
      'uploads/_stt/stt-session/chunk-001.flac'
    ]);
    expect(removeDir).toHaveBeenCalledWith('/tmp/stt-test');
  });

  it('wraps ffmpeg failures as speech-to-text normalization errors', async () => {
    const prepareAudio = createSpeechAudioPreparer({
      downloadBuffer: async () => Buffer.from('source'),
      uploadBuffer: async () => {},
      deleteObjects: async () => {},
      getBucketName: () => 'lecturemateai-uploads-485823',
      makeTempDir: async () => '/tmp/stt-test',
      writeFile: async () => {},
      readdir: async () => [],
      readFile: async () => Buffer.from(''),
      removeDir: async () => {},
      execFile: async () => {
        throw new Error('ffmpeg failed to decode input');
      }
    });

    await expect(prepareAudio(buildAudio())).rejects.toThrow(
      'Speech-to-Text normalization failed: ffmpeg failed to decode input'
    );
  });
});
