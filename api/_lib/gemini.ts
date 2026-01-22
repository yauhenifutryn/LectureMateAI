import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import path from 'path';
import { getSystemInstruction } from './prompts.js';
import { buildPrompt } from './promptBuilder.js';
import { isPollingExpired } from './polling.js';

type FilePayload = {
  fileUrl: string;
  mimeType: string;
};

type StudyInput = {
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
};

type UploadedFile = {
  fileName: string;
  mimeType: string;
  fileUri: string;
};

const buildTempPath = (mimeType?: string) => {
  const ext = mimeType?.split('/')[1] || 'bin';
  return path.join('/tmp', `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
};

const uploadAndWait = async (
  fileManager: GoogleAIFileManager,
  source: FilePayload,
  displayName: string,
  maxPollingMs: number
): Promise<UploadedFile> => {
  const response = await fetch(source.fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tempFilePath = buildTempPath(source.mimeType);
  fs.writeFileSync(tempFilePath, buffer);

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
      fileUri: uploadResult.file.uri
    };
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
};

export async function generateStudyGuide(apiKey: string, input: StudyInput) {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);
  const maxPollingMs = Number(process.env.GEMINI_PROCESS_TIMEOUT_MS ?? 45000);

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

  const uploaded: UploadedFile[] = [];

  try {
    for (const source of sources) {
      const upload = await uploadAndWait(fileManager, source.payload, source.displayName, maxPollingMs);
      uploaded.push(upload);
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
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

    const result = await model.generateContent([...parts, { text: prompt }]);

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
