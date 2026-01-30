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

const DEFAULT_MODEL_ID = 'gemini-2.5-flash';
const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);

const resolveModelId = (modelId?: string) =>
  modelId && ALLOWED_MODELS.has(modelId) ? modelId : DEFAULT_MODEL_ID;

const buildTempPath = (mimeType?: string) => {
  const ext = mimeType?.split('/')[1] || 'bin';
  return path.join('/tmp', `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
};

const fetchFileBuffer = async (source: FilePayload): Promise<Buffer> => {
  const response = await fetch(source.fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const buildSources = (input: StudyInput) => {
  const sources: { payload: FilePayload; displayName: string }[] = [];
  if (input.audio) {
    sources.push({ payload: input.audio, displayName: 'Lecture Audio' });
  }
  (input.slides || []).forEach((slide, index) => {
    sources.push({ payload: slide, displayName: `Lecture Slide ${index + 1}` });
  });
  return sources;
};

export async function uploadGeminiFiles(apiKey: string, input: StudyInput): Promise<UploadedFileRef[]> {
  const fileManager = new GoogleAIFileManager(apiKey);
  const sources = buildSources(input);
  if (sources.length === 0) {
    throw new Error('No files provided for analysis.');
  }

  const uploads: UploadedFileRef[] = [];
  for (const source of sources) {
    const buffer = await fetchFileBuffer(source.payload);
    const tempFilePath = buildTempPath(source.payload.mimeType);
    fs.writeFileSync(tempFilePath, buffer);
    try {
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: source.payload.mimeType,
        displayName: source.displayName
      });
      uploads.push({
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

  return uploads;
}

export async function checkGeminiFiles(
  apiKey: string,
  uploaded: UploadedFileRef[],
  maxPollingMs = Number(process.env.GEMINI_PROCESS_TIMEOUT_MS ?? 45000)
): Promise<{ ready: boolean }>
{
  const fileManager = new GoogleAIFileManager(apiKey);
  const pollingStart = Date.now();

  for (const file of uploaded) {
    let status = await fileManager.getFile(file.fileName);
    while (status.state === 'PROCESSING') {
      if (isPollingExpired(pollingStart, Date.now(), maxPollingMs)) {
        throw new Error('Gemini processing timed out.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await fileManager.getFile(file.fileName);
    }
    if (status.state === 'FAILED') {
      throw new Error('Gemini file processing failed.');
    }
    if (status.state !== 'ACTIVE') {
      return { ready: false };
    }
  }

  return { ready: true };
}

export async function generateStudyGuideFromUploaded(
  apiKey: string,
  uploaded: UploadedFileRef[],
  input: StudyInput
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: resolveModelId(input.modelId) });
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

  const timeoutMs = Number(process.env.GEMINI_GENERATION_TIMEOUT_MS ?? 50000);
  const result = await withTimeout(
    model.generateContent([...parts, { text: prompt }]),
    timeoutMs,
    'Gemini generation timed out.'
  );

  return result.response.text();
}

export async function cleanupGeminiFiles(apiKey: string, uploaded: UploadedFileRef[]): Promise<void> {
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
  const uploaded = await uploadGeminiFiles(apiKey, input);
  try {
    await checkGeminiFiles(apiKey, uploaded);
    return await generateStudyGuideFromUploaded(apiKey, uploaded, input);
  } finally {
    await cleanupGeminiFiles(apiKey, uploaded);
  }
}
