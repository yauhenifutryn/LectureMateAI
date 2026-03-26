import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { FilePayload } from './gemini.js';
import {
  deleteObjects,
  downloadObjectBuffer,
  parseBucketEnv,
  uploadBufferObject
} from './gcs.js';

type PreparedSpeechAudio = {
  audioUris: string[];
  cleanup: () => Promise<void>;
};

type SpeechAudioPrepDeps = {
  downloadBuffer?: (objectName: string) => Promise<Buffer>;
  uploadBuffer?: (objectName: string, content: Buffer, contentType?: string) => Promise<void>;
  deleteObjects?: (objectNames: string[]) => Promise<void>;
  getBucketName?: () => string;
  makeTempDir?: () => Promise<string>;
  writeFile?: (filePath: string, data: Buffer) => Promise<void>;
  readdir?: (dirPath: string) => Promise<string[]>;
  readFile?: (filePath: string) => Promise<Buffer>;
  removeDir?: (dirPath: string) => Promise<void>;
  execFile?: (file: string, args: string[]) => Promise<void>;
  makeUploadId?: () => string;
  getChunkSeconds?: () => number;
};

const DEFAULT_CHUNK_SECONDS = 55 * 60;
const execFile = promisify(execFileCallback);

const sanitizeBaseName = (objectName: string): string =>
  path.basename(objectName).replace(/[^a-zA-Z0-9._-]/g, '_');

const getChunkSeconds = (): number => {
  const raw = Number(process.env.SPEECH_TO_TEXT_CHUNK_SECONDS ?? DEFAULT_CHUNK_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHUNK_SECONDS;
  return raw;
};

const makeTempDir = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), 'lecturemate-stt-'));

const removeDir = async (dirPath: string): Promise<void> => {
  await rm(dirPath, { recursive: true, force: true });
};

const runFfmpeg = async (file: string, args: string[]): Promise<void> => {
  await execFile(file, args);
};

export function createSpeechAudioPreparer(deps: SpeechAudioPrepDeps = {}) {
  const downloadBuffer = deps.downloadBuffer ?? downloadObjectBuffer;
  const uploadBuffer = deps.uploadBuffer ?? uploadBufferObject;
  const cleanupObjects = deps.deleteObjects ?? deleteObjects;
  const getBucketName = deps.getBucketName ?? parseBucketEnv;
  const createTempDir = deps.makeTempDir ?? makeTempDir;
  const writeBuffer = deps.writeFile ?? writeFile;
  const listDir = deps.readdir ?? readdir;
  const readBuffer = deps.readFile ?? readFile;
  const cleanupDir = deps.removeDir ?? removeDir;
  const runExecFile = deps.execFile ?? runFfmpeg;
  const makeUploadId = deps.makeUploadId ?? randomUUID;
  const chunkSeconds = deps.getChunkSeconds ?? getChunkSeconds;

  return async (audio: FilePayload): Promise<PreparedSpeechAudio> => {
    const bucketName = getBucketName();
    const tempDir = await createTempDir();
    const sourceName = sanitizeBaseName(audio.objectName);
    const sourcePath = path.join(tempDir, sourceName);
    const chunkPattern = path.join(tempDir, 'chunk-%03d.flac');
    const uploadId = makeUploadId();
    const uploadedObjectNames: string[] = [];

    try {
      const sourceBuffer = await downloadBuffer(audio.objectName);
      await writeBuffer(sourcePath, sourceBuffer);

      await runExecFile('ffmpeg', [
        '-nostdin',
        '-y',
        '-i',
        sourcePath,
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'flac',
        '-f',
        'segment',
        '-segment_time',
        String(chunkSeconds()),
        '-reset_timestamps',
        '1',
        chunkPattern
      ]);

      const chunkNames = (await listDir(tempDir))
        .filter((name) => /^chunk-\d+\.flac$/i.test(name))
        .sort();

      if (chunkNames.length === 0) {
        throw new Error('Speech-to-Text normalization produced no audio chunks.');
      }

      for (const chunkName of chunkNames) {
        const chunkPath = path.join(tempDir, chunkName);
        const chunkBuffer = await readBuffer(chunkPath);
        const objectName = `uploads/_stt/${uploadId}/${chunkName}`;
        await uploadBuffer(objectName, chunkBuffer, 'audio/flac');
        uploadedObjectNames.push(objectName);
      }

      return {
        audioUris: uploadedObjectNames.map((objectName) => `gs://${bucketName}/${objectName}`),
        cleanup: async () => {
          await cleanupObjects(uploadedObjectNames);
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown audio preparation error.';
      throw new Error(`Speech-to-Text normalization failed: ${message}`);
    } finally {
      await cleanupDir(tempDir).catch(() => {
        // best effort
      });
    }
  };
}

export const prepareAudioForSpeech = createSpeechAudioPreparer();
