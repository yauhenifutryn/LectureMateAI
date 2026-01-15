import { upload } from '@vercel/blob/client';
import type { AccessContext, ChatMessage, ChatSession } from '../types';

type UploadedFile = {
  fileUrl: string;
  mimeType: string;
};

type ProcessResponse = {
  text?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

type ChatResponse = {
  reply?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

const getMimeType = (file: File) => {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  return 'audio/mpeg';
};

const sanitizeFileName = (name: string) =>
  name.replace(/[^\x20-\x7E]/g, '').replace(/[^\w.-]/g, '_');

const uploadToBlob = async (file: File): Promise<UploadedFile> => {
  const safeName = sanitizeFileName(file.name || 'upload');
  const pathname = `lectures/${Date.now()}-${safeName}`;
  const blob = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/upload'
  });
  return { fileUrl: blob.url, mimeType: getMimeType(file) };
};

type AnalyzeStage = 'uploading' | 'processing';

type AnalyzeOptions = {
  onStageChange?: (stage: AnalyzeStage) => void;
  onUploadComplete?: (urls: string[]) => void;
  access?: AccessContext;
};

type AnalyzeDependencies = {
  uploadToBlob: (file: File) => Promise<UploadedFile>;
  processRequest: (
    payload: { audio: UploadedFile; slides: UploadedFile[]; userContext: string },
    access?: AccessContext
  ) => Promise<ProcessResponse>;
};

const processRequest = async (
  payload: {
  audio: UploadedFile;
  slides: UploadedFile[];
  userContext: string;
  },
  access?: AccessContext
): Promise<ProcessResponse> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bodyPayload = { ...payload } as {
    audio: UploadedFile;
    slides: UploadedFile[];
    userContext: string;
    demoCode?: string;
  };

  if (access?.mode === 'admin') {
    headers.Authorization = `Bearer ${access.token}`;
  } else if (access?.mode === 'demo') {
    bodyPayload.demoCode = access.token;
  }

  const response = await fetch('/api/process', {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload)
  });

  const data = (await response.json()) as ProcessResponse;
  if (!response.ok && !data.error) {
    return { error: { message: 'Processing failed.' } };
  }

  return data;
};

/**
 * Parses the raw plain text response using the strict separators.
 */
export function parseResponseText(text: string): { studyGuide: string; transcript: string } {
  const GUIDE_SEP = '===STUDY_GUIDE===';
  const TRANS_SEP = '===TRANSCRIPT===';

  const guideIdx = text.indexOf(GUIDE_SEP);
  const transIdx = text.indexOf(TRANS_SEP);

  let studyGuide = '';
  let transcript = '';

  if (guideIdx !== -1 && transIdx !== -1) {
    studyGuide = text.substring(guideIdx + GUIDE_SEP.length, transIdx).trim();
    transcript = text.substring(transIdx + TRANS_SEP.length).trim();
  } else if (guideIdx !== -1) {
    studyGuide = text.substring(guideIdx + GUIDE_SEP.length).trim();
    transcript = 'Transcript generation was interrupted or missing.';
  } else {
    studyGuide = text;
    transcript = 'Could not parse output structure.';
  }

  studyGuide = studyGuide
    .replace(/^```markdown/, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  return { studyGuide, transcript };
}

export const createAnalyzeAudioLecture =
  ({ uploadToBlob: uploadFn, processRequest: processFn }: AnalyzeDependencies) =>
  async (
    audioFile: File,
    slideFiles: File[],
    userContext: string,
    options?: AnalyzeOptions
  ): Promise<{ studyGuide: string; transcript: string }> => {
    if (!audioFile) {
      throw new Error('Audio file is missing.');
    }

    options?.onStageChange?.('uploading');
    const audio = await uploadFn(audioFile);
    const slides = await Promise.all(slideFiles.map((file) => uploadFn(file)));
    options?.onUploadComplete?.([audio.fileUrl, ...slides.map((slide) => slide.fileUrl)]);

    options?.onStageChange?.('processing');
    const data = await processFn(
      {
      audio,
      slides,
      userContext
      },
      options?.access
    );

    if (data.error) {
      throw new Error(data.error.message || 'Processing failed.');
    }

    if (!data.text) {
      throw new Error('Empty response from processing endpoint.');
    }

    return parseResponseText(data.text);
  };

export const analyzeAudioLecture = createAnalyzeAudioLecture({
  uploadToBlob,
  processRequest
});

export const cleanupUploadedFiles = async (
  urls: string[],
  access?: AccessContext
): Promise<void> => {
  if (!urls || urls.length === 0) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const payload: { urls: string[]; demoCode?: string } = { urls };

  if (access?.mode === 'admin') {
    headers.Authorization = `Bearer ${access.token}`;
  } else if (access?.mode === 'demo') {
    payload.demoCode = access.token;
  }

  try {
    await fetch('/api/blob/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Failed to cleanup uploads:', error);
  }
};

export const initializeChatSession = (
  transcript: string,
  studyGuide: string,
  access?: AccessContext
): ChatSession => {
  return {
    async *sendMessageStream({ history }: { message: string; history: ChatMessage[] }) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const payload: {
        transcript: string;
        studyGuide: string;
        messages: { role: string; content: string }[];
        demoCode?: string;
      } = {
        transcript,
        studyGuide,
        messages: history.map((msg) => ({ role: msg.role, content: msg.content }))
      };

      if (access?.mode === 'admin') {
        headers.Authorization = `Bearer ${access.token}`;
      } else if (access?.mode === 'demo') {
        payload.demoCode = access.token;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as ChatResponse;
      if (!response.ok || data.error) {
        throw new Error(data.error?.message || 'Chat failed.');
      }

      const reply = data.reply || '';
      yield { text: reply };
    }
  };
};
