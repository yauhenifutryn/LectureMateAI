import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import path from 'path';
import { SYSTEM_INSTRUCTION } from './prompts';

type UploadedFile = {
  name: string;
  uri: string;
  mimeType: string;
  tempPath: string;
};

type UploadInput = {
  buffer: Buffer;
  mimeType: string;
  displayName: string;
};

type FilePartInput = {
  uri: string;
  mimeType: string;
};

export function buildGenerateParts(files: FilePartInput[], promptText: string) {
  const parts = files.map((file) => ({
    fileData: { mimeType: file.mimeType, fileUri: file.uri }
  }));

  parts.push({ text: promptText });
  return parts;
}

const getExtension = (mimeType: string) => {
  const parts = mimeType.split('/');
  return parts.length > 1 ? parts[1] : 'bin';
};

export async function uploadAndGenerate({
  apiKey,
  systemInstruction,
  promptText,
  files
}: {
  apiKey: string;
  systemInstruction: string;
  promptText: string;
  files: UploadInput[];
}) {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);
  const uploaded: UploadedFile[] = [];

  try {
    for (const [index, file] of files.entries()) {
      const ext = getExtension(file.mimeType);
      const tempFilePath = path.join('/tmp', `upload-${Date.now()}-${index}.${ext}`);
      fs.writeFileSync(tempFilePath, file.buffer);

      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: file.mimeType,
        displayName: file.displayName
      });

      let remoteFile = await fileManager.getFile(uploadResult.file.name);
      while (remoteFile.state === 'PROCESSING') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        remoteFile = await fileManager.getFile(uploadResult.file.name);
      }

      if (remoteFile.state === 'FAILED') {
        throw new Error('Gemini file processing failed.');
      }

      uploaded.push({
        name: uploadResult.file.name,
        uri: uploadResult.file.uri,
        mimeType: uploadResult.file.mimeType,
        tempPath: tempFilePath
      });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: systemInstruction || SYSTEM_INSTRUCTION
    });

    const parts = buildGenerateParts(
      uploaded.map((file) => ({ uri: file.uri, mimeType: file.mimeType })),
      promptText || SYSTEM_INSTRUCTION
    );

    const result = await model.generateContent(parts);
    return { fullText: result.response.text(), uploaded };
  } finally {
    for (const file of uploaded) {
      try {
        await fileManager.deleteFile(file.name);
      } catch {
        // Cleanup is best-effort.
      }

      if (fs.existsSync(file.tempPath)) {
        try {
          fs.unlinkSync(file.tempPath);
        } catch {
          // Best-effort temp cleanup.
        }
      }
    }
  }
}
