import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import path from 'path';
import { getSystemInstruction } from './prompts.js';
import { buildPrompt } from './promptBuilder.js';
import { isPollingExpired } from './polling.js';

export type FilePayload = {
  fileUrl: string;
  mimeType: string;
};

type StudyInput = {
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
  modelId?: string;
};

export type UploadedFileRef = {
  fileName: string;
  fileUri: string;
  mimeType: string;
  displayName: string;
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

const MODEL_ALLOWLIST = new Set(['gemini-2.5-pro', 'gemini-2.5-flash']);

export function getModelId(override?: string): string {
  const candidate = override?.trim();
  if (candidate && MODEL_ALLOWLIST.has(candidate)) {
    return candidate;
  }
  const envModel = process.env.GEMINI_MODEL_ID?.trim();
  if (envModel && MODEL_ALLOWLIST.has(envModel)) {
    return envModel;
  }
  return 'gemini-2.5-flash';
}

const buildTempPath = (mimeType?: string) => {
  const ext = mimeType?.split('/')[1] || 'bin';
  return path.join('/tmp', `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
};

const fetchToTempFile = async (source: FilePayload): Promise<string> => {
  const response = await fetch(source.fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tempFilePath = buildTempPath(source.mimeType);
  fs.writeFileSync(tempFilePath, buffer);
  return tempFilePath;
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

const uploadAndWait = async (
  fileManager: GoogleAIFileManager,
  source: FilePayload,
  displayName: string,
  maxPollingMs: number
): Promise<UploadedFileRef> => {
  const tempFilePath = await fetchToTempFile(source);

  let uploadResult: Awaited<ReturnType<typeof fileManager.uploadFile>> | undefined;

  try {
    uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: source.mimeType,
      displayName
    });

    const pollingStart = Date.now();
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === 'PROCESSING') {
      if (isPollingExpired(pollingStart, Date.now(), maxPollingMs)) {
        throw new Error('Gemini processing timed out.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state === 'FAILED') {
      throw new Error('Gemini file processing failed.');
    }

    return {
      fileName: uploadResult.file.name,
      mimeType: uploadResult.file.mimeType,
      fileUri: uploadResult.file.uri,
      displayName
    };
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
};

export async function uploadGeminiFiles(
  apiKey: string,
  sources: { payload: FilePayload; displayName: string }[]
): Promise<UploadedFileRef[]> {
  const fileManager = new GoogleAIFileManager(apiKey);
  const uploaded: UploadedFileRef[] = [];

  for (const source of sources) {
    const tempFilePath = await fetchToTempFile(source.payload);
    try {
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: source.payload.mimeType,
        displayName: source.displayName
      });
      uploaded.push({
        fileName: uploadResult.file.name,
        fileUri: uploadResult.file.uri,
        mimeType: uploadResult.file.mimeType,
        displayName: source.displayName
      });
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  return uploaded;
}

export async function checkGeminiFiles(
  apiKey: string,
  uploaded: UploadedFileRef[]
): Promise<{ ready: boolean; failed: boolean; readyCount: number; total: number }> {
  const fileManager = new GoogleAIFileManager(apiKey);
  let readyCount = 0;
  let failed = false;
  const total = uploaded.length;

  for (const file of uploaded) {
    const state = await fileManager.getFile(file.fileName);
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
  const fileManager = new GoogleAIFileManager(apiKey);
  await Promise.all(
    uploaded.map((file) =>
      fileManager.deleteFile(file.fileName).catch((error) => {
        console.error('Gemini cleanup failed:', error);
      })
    )
  );
}

export async function generateStudyGuide(apiKey: string, input: StudyInput) {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);
  const rawTimeout = Number(process.env.GEMINI_PROCESS_TIMEOUT_MS ?? 0);
  const maxPollingMs = Number.isFinite(rawTimeout) ? rawTimeout : 0;

  const sources: { payload: FilePayload; displayName: string }[] = [];
  if (input.audio) {
    sources.push({ payload: input.audio, displayName: 'Lecture Audio' });
  }
  (input.slides || []).forEach((slide, index) => {
    sources.push({ payload: slide, displayName: `Lecture Slide ${index + 1}` });
  });

  if (sources.length === 0) {
    throw new Error('No files provided for analysis.');
  }

  const uploaded: UploadedFileRef[] = [];

  try {
    for (const source of sources) {
      const upload = await uploadAndWait(fileManager, source.payload, source.displayName, maxPollingMs);
      uploaded.push(upload);
    }

    const model = genAI.getGenerativeModel({ model: getModelId(input.modelId) });
    const parts = uploaded.map((file) => ({
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.fileUri
      }
    }));

    const prompt = buildPrompt({
      systemPrompt: getSystemInstruction(),
      userContext: input.userContext,
      hasAudio: Boolean(input.audio),
      hasSlides: uploaded.length > 0 && (input.slides || []).length > 0,
      hasRawNotes: false
    });

    const result = await withOverloadRetry(() => model.generateContent([...parts, { text: prompt }]));

    return result.response.text();
  } finally {
    await Promise.all(
      uploaded.map((file) =>
        fileManager.deleteFile(file.fileName).catch((error) => {
          console.error('Gemini cleanup failed:', error);
        })
      )
    );
  }
}

export async function generateStudyGuideFromUploaded(
  apiKey: string,
  input: StudyInput,
  uploaded: UploadedFileRef[]
) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: getModelId(input.modelId) });
  const parts = uploaded.map((file) => ({
    fileData: {
      mimeType: file.mimeType,
      fileUri: file.fileUri
    }
  }));

  const prompt = buildPrompt({
    systemPrompt: getSystemInstruction(),
    userContext: input.userContext,
    hasAudio: Boolean(input.audio),
    hasSlides: (input.slides || []).length > 0,
    hasRawNotes: false
  });

  const timeoutMs = Number(process.env.GEMINI_GENERATION_TIMEOUT_MS ?? 45000);
  try {
    const result = await model.generateContent([...parts, { text: prompt }], {
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined
    });
    return result.response.text();
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
