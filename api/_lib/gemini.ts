import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { getSystemInstruction } from './prompts.js';
import { buildPrompt } from './promptBuilder.js';
import { downloadObjectBuffer } from './gcs.js';

export type FilePayload = {
  objectName: string;
  mimeType: string;
};

type StudyInput = {
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
  transcriptText?: string;
  modelId?: string;
};

export type UploadedFileRef = {
  fileName: string;
  fileUri: string;
  mimeType: string;
  displayName: string;
};

export type GeminiPart = {
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  text?: string;
};

export class OverloadRetryError extends Error {
  code = 'overload_retry';
  constructor(message = 'Gemini overloaded. Retry later.') {
    super(message);
    this.name = 'OverloadRetryError';
  }
}

export class GenerationRetryError extends Error {
  code = 'generation_retry';
  constructor(message = 'Gemini generation retry.') {
    super(message);
    this.name = 'GenerationRetryError';
  }
}

const MODEL_ALLOWLIST = new Set(['gemini-3-pro-preview', 'gemini-3-flash-preview']);

export function getModelId(override?: string): string {
  const candidate = override?.trim();
  if (candidate && MODEL_ALLOWLIST.has(candidate)) {
    return candidate;
  }
  const envModel = process.env.GEMINI_MODEL_ID?.trim();
  if (envModel && MODEL_ALLOWLIST.has(envModel)) {
    return envModel;
  }
  return 'gemini-3-flash-preview';
}

const INLINE_THRESHOLD_BYTES = 10 * 1024 * 1024;
const DEFAULT_POLL_ATTEMPTS = 60;
const DEFAULT_POLL_DELAY_MS = 2000;

type ProcessFileOptions = {
  inlineThresholdBytes?: number;
  alwaysUploadAudio?: boolean;
  pollAttempts?: number;
  pollDelayMs?: number;
  allowUpload?: boolean;
};

type ProcessFileResult = {
  part?: GeminiPart;
  uploaded?: UploadedFileRef;
  skipped?: boolean;
};

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
};

const DEFAULT_OVERLOAD_RETRY: Required<RetryOptions> = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 12000,
  maxElapsedMs: 45000
};

const isOverloadError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const anyError = error as { status?: number; statusCode?: number; message?: string };
  const status = anyError.status ?? anyError.statusCode;
  const message = anyError.message?.toLowerCase() ?? '';
  return status === 503 || message.includes('overloaded');
};

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const anyError = error as { name?: string; message?: string };
  const name = anyError.name?.toLowerCase() ?? '';
  const message = anyError.message?.toLowerCase() ?? '';
  return name.includes('abort') || message.includes('timeout') || message.includes('timed out');
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const parseEnvNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getOverloadRetryDefaults = (): Required<RetryOptions> => {
  const maxAttempts = parseEnvNumber(process.env.GEMINI_OVERLOAD_MAX_ATTEMPTS);
  const baseDelayMs = parseEnvNumber(process.env.GEMINI_OVERLOAD_BASE_DELAY_MS);
  const maxDelayMs = parseEnvNumber(process.env.GEMINI_OVERLOAD_MAX_DELAY_MS);
  const maxElapsedMs = parseEnvNumber(process.env.GEMINI_OVERLOAD_TOTAL_BUDGET_MS);

  return {
    maxAttempts: maxAttempts && maxAttempts > 0 ? Math.floor(maxAttempts) : DEFAULT_OVERLOAD_RETRY.maxAttempts,
    baseDelayMs: baseDelayMs && baseDelayMs >= 0 ? baseDelayMs : DEFAULT_OVERLOAD_RETRY.baseDelayMs,
    maxDelayMs: maxDelayMs && maxDelayMs >= 0 ? maxDelayMs : DEFAULT_OVERLOAD_RETRY.maxDelayMs,
    maxElapsedMs: maxElapsedMs && maxElapsedMs > 0 ? maxElapsedMs : DEFAULT_OVERLOAD_RETRY.maxElapsedMs
  };
};

export async function withOverloadRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const defaults = getOverloadRetryDefaults();
  const maxAttempts = options.maxAttempts ?? defaults.maxAttempts;
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? defaults.baseDelayMs);
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? defaults.maxDelayMs);
  const maxElapsedMs = Math.max(0, options.maxElapsedMs ?? defaults.maxElapsedMs);
  const startTime = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isOverloadError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      if (maxElapsedMs > 0 && Date.now() - startTime >= maxElapsedMs) {
        throw new OverloadRetryError();
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      if (delay > 0) {
        console.warn(`Gemini overloaded. Retrying in ${delay}ms.`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

const buildTempPath = (mimeType?: string) => {
  const ext = mimeType?.split('/')[1] || 'bin';
  return path.join('/tmp', `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
};

const fetchFileBuffer = async (source: FilePayload): Promise<Buffer> => {
  return downloadObjectBuffer(source.objectName);
};

const uploadAndPoll = async (
  ai: GoogleGenAI,
  tempFilePath: string,
  mimeType: string,
  displayName: string,
  pollAttempts: number,
  pollDelayMs: number
): Promise<{ fileName: string; fileUri: string; mimeType: string }> => {
  const uploadResult = await ai.files.upload({
    file: tempFilePath,
    config: { displayName, mimeType }
  });
  const uploadedFile = (uploadResult as any).file || uploadResult;
  if (!uploadedFile?.name) {
    throw new Error('Gemini upload failed.');
  }

  let remoteFile = await ai.files.get({ name: uploadedFile.name });
  let attempts = 0;
  while (remoteFile.state === 'PROCESSING' && attempts < pollAttempts) {
    await sleep(pollDelayMs);
    remoteFile = await ai.files.get({ name: uploadedFile.name });
    attempts += 1;
  }

  if (remoteFile.state === 'FAILED') {
    throw new Error('Gemini file processing failed.');
  }
  if (remoteFile.state === 'PROCESSING') {
    throw new GenerationRetryError('Gemini processing timed out.');
  }

  return {
    fileName: uploadedFile.name,
    fileUri: remoteFile.uri ?? uploadedFile.uri,
    mimeType: remoteFile.mimeType ?? mimeType
  };
};

export async function processFilePayload(
  ai: GoogleGenAI,
  payload: FilePayload,
  displayName: string,
  kind: 'audio' | 'slide',
  options: ProcessFileOptions = {}
): Promise<ProcessFileResult> {
  const inlineThresholdBytes = options.inlineThresholdBytes ?? INLINE_THRESHOLD_BYTES;
  const alwaysUploadAudio = options.alwaysUploadAudio ?? true;
  const allowUpload = options.allowUpload ?? true;
  const pollAttempts = options.pollAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const pollDelayMs = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;
  const mimeType = payload.mimeType || 'application/octet-stream';

  const buffer = await fetchFileBuffer(payload);
  const sizeBytes = buffer.byteLength;
  const shouldInline = sizeBytes <= inlineThresholdBytes;
  if (shouldInline) {
    return {
      part: {
        inlineData: {
          mimeType,
          data: buffer.toString('base64')
        }
      }
    };
  }

  if (kind === 'audio' && !alwaysUploadAudio) {
    return {
      part: {
        inlineData: {
          mimeType,
          data: buffer.toString('base64')
        }
      }
    };
  }

  if (!allowUpload) {
    return { skipped: true };
  }

  const tempFilePath = buildTempPath(mimeType);
  fs.writeFileSync(tempFilePath, buffer);

  try {
    const uploaded = await uploadAndPoll(ai, tempFilePath, mimeType, displayName, pollAttempts, pollDelayMs);
    return {
      part: {
        fileData: {
          mimeType: uploaded.mimeType,
          fileUri: uploaded.fileUri
        }
      },
      uploaded: {
        fileName: uploaded.fileName,
        fileUri: uploaded.fileUri,
        mimeType: uploaded.mimeType,
        displayName
      }
    };
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export async function uploadGeminiFiles(
  apiKey: string,
  sources: { payload: FilePayload; displayName: string; kind: 'audio' | 'slide' }[]
): Promise<UploadedFileRef[]> {
  const ai = new GoogleGenAI({ apiKey });
  const uploaded: UploadedFileRef[] = [];

  for (const source of sources) {
    const result = await processFilePayload(ai, source.payload, source.displayName, source.kind, {
      inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
      alwaysUploadAudio: true
    });
    if (result.uploaded) {
      uploaded.push(result.uploaded);
    }
  }

  return uploaded;
}

export async function checkGeminiFiles(
  apiKey: string,
  uploaded: UploadedFileRef[]
): Promise<{ ready: boolean; failed: boolean; readyCount: number; total: number }> {
  if (uploaded.length === 0) {
    return { ready: true, failed: false, readyCount: 0, total: 0 };
  }

  const ai = new GoogleGenAI({ apiKey });
  let readyCount = 0;
  let failed = false;
  const total = uploaded.length;

  for (const file of uploaded) {
    const state = await ai.files.get({ name: file.fileName });
    if (state.state === 'FAILED') {
      failed = true;
    }
    if (state.state === 'ACTIVE') {
      readyCount += 1;
    }
  }

  return {
    ready: !failed && total > 0 && readyCount === total,
    failed,
    readyCount,
    total
  };
}

export async function cleanupGeminiFiles(apiKey: string, uploaded: UploadedFileRef[]) {
  if (uploaded.length === 0) return;
  const ai = new GoogleGenAI({ apiKey });
  await Promise.all(
    uploaded.map((file) =>
      ai.files.delete({ name: file.fileName }).catch((error) => {
        const status = Number((error as { status?: number })?.status ?? 0);
        const message = String((error as { message?: string })?.message ?? '');
        const expected =
          status === 403 ||
          status === 404 ||
          message.includes('PERMISSION_DENIED') ||
          message.includes('not exist');

        if (expected) {
          console.log(`Gemini cleanup skipped for ${file.fileName}: ${status || 'unknown'}`);
          return;
        }

        console.error('Gemini cleanup failed:', error);
      })
    )
  );
}

const collectStreamText = async (
  stream: AsyncGenerator<{ text?: string }>
): Promise<string> => {
  let fullText = '';
  for await (const chunk of stream) {
    if (chunk.text) {
      fullText += chunk.text;
    }
  }
  return fullText;
};

const buildPromptText = (input: StudyInput): string =>
  buildPrompt({
    systemPrompt: getSystemInstruction(),
    userContext: input.userContext,
    hasAudio: Boolean(input.audio),
    hasSlides: (input.slides || []).length > 0,
    hasRawNotes: false
  });

const buildTranscriptPromptText = (): string =>
  [
    'Transcribe the lecture audio verbatim.',
    'Return only the raw transcript text.',
    'Do not add headers, labels, or markdown.',
    'If words are unclear, use [inaudible].'
  ].join(' ');

const buildInlinePartsForSlides = async (
  ai: GoogleGenAI,
  slides: FilePayload[]
): Promise<GeminiPart[]> => {
  const parts: GeminiPart[] = [];
  for (const slide of slides) {
    const result = await processFilePayload(
      ai,
      slide,
      'Lecture Slide',
      'slide',
      {
        inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
        alwaysUploadAudio: true,
        allowUpload: false
      }
    );
    if (result.part?.inlineData) {
      parts.push(result.part);
    }
  }
  return parts;
};

export async function generateStudyGuide(apiKey: string, input: StudyInput) {
  const ai = new GoogleGenAI({ apiKey });
  const parts: GeminiPart[] = [];
  const uploaded: UploadedFileRef[] = [];

  try {
    if (input.audio) {
      const audioResult = await processFilePayload(ai, input.audio, 'Lecture Audio', 'audio', {
        inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
        alwaysUploadAudio: true
      });
      if (audioResult.part) parts.push(audioResult.part);
      if (audioResult.uploaded) uploaded.push(audioResult.uploaded);
    }

    if (input.slides?.length) {
      for (const [index, slide] of input.slides.entries()) {
        const slideResult = await processFilePayload(ai, slide, `Lecture Slide ${index + 1}`, 'slide', {
          inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
          alwaysUploadAudio: true
        });
        if (slideResult.part) parts.push(slideResult.part);
        if (slideResult.uploaded) uploaded.push(slideResult.uploaded);
      }
    }

    if (parts.length === 0) {
      throw new Error('No files provided for analysis.');
    }

    parts.push({ text: buildPromptText(input) });

    const model = getModelId(input.modelId);
    const responseStream = await withOverloadRetry(() =>
      ai.models.generateContentStream({
        model,
        contents: { parts },
        config: {
          systemInstruction: getSystemInstruction(),
          temperature: 0.2
        }
      })
    );

    const fullText = await collectStreamText(responseStream);
    if (!fullText) {
      throw new Error('Received empty response from Gemini.');
    }
    return fullText;
  } catch (error) {
    if (isOverloadError(error)) {
      throw new OverloadRetryError();
    }
    if (isTimeoutError(error)) {
      throw new GenerationRetryError();
    }
    throw error;
  } finally {
    await cleanupGeminiFiles(apiKey, uploaded);
  }
}

export async function generateStudyGuideFromUploaded(
  apiKey: string,
  input: StudyInput,
  uploaded: UploadedFileRef[]
) {
  const ai = new GoogleGenAI({ apiKey });
  const parts: GeminiPart[] = [];
  const useTranscriptOnly = Boolean(input.transcriptText && input.transcriptText.trim().length > 0);

  uploaded.forEach((file) => {
    if (useTranscriptOnly && file.displayName === 'Lecture Audio') {
      return;
    }
    parts.push({
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.fileUri
      }
    });
  });

  if (input.audio && !useTranscriptOnly) {
    const hasUploadedAudio = uploaded.some((file) => file.displayName === 'Lecture Audio');
    if (!hasUploadedAudio) {
      const inlineAudio = await processFilePayload(ai, input.audio, 'Lecture Audio', 'audio', {
        inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
        alwaysUploadAudio: true,
        allowUpload: false
      });
      if (inlineAudio.part?.inlineData) {
        parts.unshift(inlineAudio.part);
      }
    }
  }

  if (input.slides?.length) {
    const inlineParts = await buildInlinePartsForSlides(ai, input.slides);
    parts.push(...inlineParts);
  }

  if (useTranscriptOnly) {
    parts.push({
      text: ['===TRANSCRIPT===', input.transcriptText!.trim()].join('\n')
    });
  }

  parts.push({ text: buildPromptText(input) });

  const model = getModelId(input.modelId);

  try {
    const responseStream = await ai.models.generateContentStream({
      model,
      contents: { parts },
      config: {
        systemInstruction: getSystemInstruction(),
        temperature: 0.2
      }
    });
    const fullText = await collectStreamText(responseStream);
    if (!fullText) {
      throw new Error('Received empty response from Gemini.');
    }
    return fullText;
  } catch (error) {
    if (isOverloadError(error)) {
      throw new OverloadRetryError();
    }
    if (isTimeoutError(error)) {
      throw new GenerationRetryError();
    }
    throw error;
  }
}

export async function generateTranscriptFromUploaded(
  apiKey: string,
  input: Pick<StudyInput, 'audio' | 'modelId'>,
  uploaded: UploadedFileRef[]
): Promise<string | null> {
  if (!input.audio) return null;
  const ai = new GoogleGenAI({ apiKey });
  const parts: GeminiPart[] = [];

  const uploadedAudio = uploaded.find((file) => file.displayName === 'Lecture Audio');
  if (uploadedAudio) {
    parts.push({
      fileData: {
        mimeType: uploadedAudio.mimeType,
        fileUri: uploadedAudio.fileUri
      }
    });
  } else {
    const inlineAudio = await processFilePayload(ai, input.audio, 'Lecture Audio', 'audio', {
      inlineThresholdBytes: INLINE_THRESHOLD_BYTES,
      alwaysUploadAudio: true,
      allowUpload: false
    });
    if (inlineAudio.part) {
      parts.push(inlineAudio.part);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  parts.push({ text: buildTranscriptPromptText() });

  const model = getModelId(input.modelId);

  try {
    const responseStream = await withOverloadRetry(() =>
      ai.models.generateContentStream({
        model,
        contents: { parts },
        config: {
          temperature: 0
        }
      })
    );
    const fullText = await collectStreamText(responseStream);
    if (!fullText) {
      throw new Error('Received empty transcript response.');
    }
    return fullText.trim();
  } catch (error) {
    if (isOverloadError(error)) {
      throw new OverloadRetryError();
    }
    if (isTimeoutError(error)) {
      throw new GenerationRetryError();
    }
    throw error;
  }
}
