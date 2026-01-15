import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import path from 'path';
import { getSystemInstruction } from './prompts.js';
import { isPollingExpired } from './polling.js';

export async function generateStudyGuide(
  apiKey: string,
  fileUrl: string,
  mimeType: string,
  userContext?: string
) {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const ext = mimeType?.split('/')[1] || 'bin';
  const tempFilePath = path.join('/tmp', `upload-${Date.now()}.${ext}`);
  fs.writeFileSync(tempFilePath, buffer);

  let uploadResult: Awaited<ReturnType<typeof fileManager.uploadFile>> | undefined;

  try {
    uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType,
      displayName: 'Lecture Audio'
    });

    const pollingStart = Date.now();
    const maxPollingMs = Number(process.env.GEMINI_PROCESS_TIMEOUT_MS ?? 45000);

    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === 'PROCESSING') {
      if (isPollingExpired(pollingStart, Date.now(), maxPollingMs)) {
        throw new Error('Gemini processing timed out.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state === 'FAILED') {
      throw new Error('Gemini audio processing failed.');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    const result = await model.generateContent([
      {
        fileData: {
          mimeType: uploadResult.file.mimeType,
          fileUri: uploadResult.file.uri
        }
      },
      { text: userContext || getSystemInstruction() }
    ]);

    return result.response.text();
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    if (uploadResult) {
      await fileManager.deleteFile(uploadResult.file.name).catch(console.error);
    }
  }
}
