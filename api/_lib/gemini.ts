import { GoogleGenAI } from '@google/genai';

type UploadedFile = {
  name: string;
  uri: string;
  mimeType: string;
};

type UploadInput = {
  buffer: Buffer;
  mimeType: string;
  displayName: string;
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
  const ai = new GoogleGenAI({ apiKey });
  const uploaded: UploadedFile[] = [];

  try {
    for (const file of files) {
      const res = await ai.files.upload({
        file: new Blob([file.buffer], { type: file.mimeType }),
        config: { displayName: file.displayName, mimeType: file.mimeType }
      });
      const uploadedFile = (res as any).file || res;
      uploaded.push({
        name: uploadedFile.name,
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType
      });
    }

    const parts = uploaded.map((file) => ({
      fileData: { fileUri: file.uri, mimeType: file.mimeType }
    }));

    parts.push({ text: promptText });

    const stream = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: { systemInstruction, temperature: 0.2 }
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.text) fullText += chunk.text;
    }

    return { fullText, uploaded };
  } finally {
    for (const file of uploaded) {
      try {
        await ai.files.delete({ name: file.name });
      } catch {
        // Cleanup is best-effort.
      }
    }
  }
}
