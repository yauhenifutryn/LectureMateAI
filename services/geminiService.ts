import { upload } from '@vercel/blob/client';
import type { AccessContext, ChatMessage, ChatSession, AnalysisResult } from '../types';

type UploadedFile = {
  fileUrl: string;
  mimeType: string;
};

type JobCreateResponse = {
  jobId?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

type JobStatusResponse = {
  status?: 'queued' | 'processing' | 'completed' | 'failed';
  stage?: string;
  progress?: number;
  resultUrl?: string;
  preview?: string;
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
  createJob: (
    payload: { audio?: UploadedFile; slides: UploadedFile[]; userContext: string },
    access?: AccessContext
  ) => Promise<JobCreateResponse>;
  startJob: (jobId: string, access?: AccessContext) => Promise<void>;
  getJobStatus: (jobId: string, access?: AccessContext) => Promise<JobStatusResponse>;
  fetchResultText: (resultUrl: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
};

type CleanupDependencies = AnalyzeDependencies & {
  cleanupUploadedFiles: (urls: string[], access?: AccessContext) => Promise<void>;
};

const buildHeaders = (access?: AccessContext): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (access?.mode === 'admin') {
    headers.Authorization = `Bearer ${access.token}`;
  }
  return headers;
};

const createJobRequest = async (
  payload: {
    audio?: UploadedFile;
    slides: UploadedFile[];
    userContext: string;
  },
  access?: AccessContext
): Promise<JobCreateResponse> => {
  const headers = buildHeaders(access);
  const bodyPayload = { ...payload } as {
    audio?: UploadedFile;
    slides: UploadedFile[];
    userContext: string;
    demoCode?: string;
  };

  if (access?.mode === 'demo') {
    bodyPayload.demoCode = access.token;
  }

  const response = await fetch('/api/process', {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload)
  });

  const data = (await response.json()) as JobCreateResponse;
  if (!response.ok && !data.error) {
    return { error: { message: 'Processing failed.' } };
  }

  return data;
};

const startJobRequest = async (jobId: string, access?: AccessContext): Promise<void> => {
  const headers = buildHeaders(access);
  const bodyPayload: { jobId: string; demoCode?: string } = { jobId };

  if (access?.mode === 'demo') {
    bodyPayload.demoCode = access.token;
  }

  const response = await fetch('/api/process/run', {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as JobStatusResponse | null;
    throw new Error(data?.error?.message || 'Processing failed.');
  }
};

const getJobStatusRequest = async (
  jobId: string,
  access?: AccessContext
): Promise<JobStatusResponse> => {
  const headers = buildHeaders(access);
  const params = new URLSearchParams({ jobId });
  if (access?.mode === 'demo') {
    params.set('demoCode', access.token);
  }

  const response = await fetch(`/api/process/status?${params.toString()}`, {
    method: 'GET',
    headers
  });

  const data = (await response.json()) as JobStatusResponse;
  if (!response.ok && !data.error) {
    return { error: { message: 'Status failed.' } };
  }
  return data;
};

const fetchResultText = async (resultUrl: string): Promise<string> => {
  const response = await fetch(resultUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch analysis result.');
  }
  return response.text();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollJobStatus = async (
  jobId: string,
  access: AccessContext | undefined,
  getStatus: (jobId: string, access?: AccessContext) => Promise<JobStatusResponse>,
  wait: (ms: number) => Promise<void>,
  maxAttempts = 120
): Promise<JobStatusResponse> => {
  let delayMs = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getStatus(jobId, access);
    if (status.error) {
      return status;
    }
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    await wait(delayMs);
    delayMs = Math.min(Math.floor(delayMs * 1.5), 8000);
  }

  return { status: 'failed', error: { message: 'Processing timed out.' } };
};

/**
 * Parses the raw plain text response using the strict separators.
 */
export function parseResponseText(text: string): {
  studyGuide: string;
  transcript: string;
  slides?: string;
  rawNotes?: string;
} {
  const GUIDE_SEP = '===STUDY_GUIDE===';
  const TRANS_SEP = '===TRANSCRIPT===';
  const SLIDES_SEP = '===SLIDES===';
  const RAW_SEP = '===RAW_NOTES===';

  const guideIdx = text.indexOf(GUIDE_SEP);
  const transIdx = text.indexOf(TRANS_SEP);
  const slidesIdx = text.indexOf(SLIDES_SEP);
  const rawIdx = text.indexOf(RAW_SEP);

  let studyGuide = '';
  let transcript = '';
  let slides: string | undefined;
  let rawNotes: string | undefined;

  if (guideIdx !== -1 && transIdx !== -1) {
    studyGuide = text.substring(guideIdx + GUIDE_SEP.length, transIdx).trim();
    const transcriptEnd =
      slidesIdx !== -1 && slidesIdx > transIdx
        ? slidesIdx
        : rawIdx !== -1 && rawIdx > transIdx
          ? rawIdx
          : text.length;
    transcript = text.substring(transIdx + TRANS_SEP.length, transcriptEnd).trim();
    if (slidesIdx !== -1) {
      const slidesEnd = rawIdx !== -1 && rawIdx > slidesIdx ? rawIdx : text.length;
      slides = text.substring(slidesIdx + SLIDES_SEP.length, slidesEnd).trim();
    }
    if (rawIdx !== -1) {
      rawNotes = text.substring(rawIdx + RAW_SEP.length).trim();
    }
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

  return { studyGuide, transcript, slides, rawNotes };
}

export const createAnalyzeAudioLecture =
  ({
    uploadToBlob: uploadFn,
    createJob,
    startJob,
    getJobStatus,
    fetchResultText: fetchResult,
    sleep: sleepFn
  }: AnalyzeDependencies) =>
  async (
    audioFile: File | null,
    slideFiles: File[],
    userContext: string,
    options?: AnalyzeOptions
  ): Promise<AnalysisResult> => {
    if (!audioFile && slideFiles.length === 0) {
      throw new Error('Audio or slide files are required.');
    }

    options?.onStageChange?.('uploading');
    const audio = audioFile ? await uploadFn(audioFile) : undefined;
    const slides = await Promise.all(slideFiles.map((file) => uploadFn(file)));
    const uploadedUrls = [
      ...(audio ? [audio.fileUrl] : []),
      ...slides.map((slide) => slide.fileUrl)
    ];
    options?.onUploadComplete?.(uploadedUrls);

    const jobResponse = await createJob(
      {
        audio,
        slides,
        userContext
      },
      options?.access
    );

    if (jobResponse.error) {
      throw new Error(jobResponse.error.message || 'Processing failed.');
    }

    if (!jobResponse.jobId) {
      throw new Error('Processing did not return a job id.');
    }

    void startJob(jobResponse.jobId, options?.access).catch((error) => {
      console.error('Failed to start processing job:', error);
    });
    options?.onStageChange?.('processing');

    const status = await pollJobStatus(
      jobResponse.jobId,
      options?.access,
      getJobStatus,
      sleepFn || sleep
    );

    if (status.error) {
      throw new Error(status.error.message || 'Processing failed.');
    }

    if (!status.resultUrl) {
      throw new Error('Processing result missing.');
    }

    const resultText = await fetchResult(status.resultUrl);
    return parseResponseText(resultText);
  };

export const analyzeAudioLecture = createAnalyzeAudioLecture({
  uploadToBlob,
  createJob: createJobRequest,
  startJob: startJobRequest,
  getJobStatus: getJobStatusRequest,
  fetchResultText,
  sleep
});

export const createRunAnalysisWithCleanup =
  ({
    uploadToBlob: uploadFn,
    createJob,
    startJob,
    getJobStatus,
    fetchResultText: fetchResult,
    cleanupUploadedFiles: cleanupFn,
    sleep: sleepFn
  }: CleanupDependencies) =>
  async (
    audioFile: File | null,
    slideFiles: File[],
    userContext: string,
    options?: AnalyzeOptions
  ): Promise<AnalysisResult> => {
    let uploadedUrls: string[] = [];

    try {
      const analyze = createAnalyzeAudioLecture({
        uploadToBlob: uploadFn,
        createJob,
        startJob,
        getJobStatus,
        fetchResultText: fetchResult,
        sleep: sleepFn
      });
      return await analyze(audioFile, slideFiles, userContext, {
        ...options,
        onUploadComplete: (urls) => {
          uploadedUrls = urls;
          options?.onUploadComplete?.(urls);
        }
      });
    } catch (error) {
      if (uploadedUrls.length > 0) {
        await cleanupFn(uploadedUrls, options?.access);
      }
      throw error;
    }
  };

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

export const analyzeAudioLectureWithCleanup = createRunAnalysisWithCleanup({
  uploadToBlob,
  createJob: createJobRequest,
  startJob: startJobRequest,
  getJobStatus: getJobStatusRequest,
  fetchResultText,
  sleep,
  cleanupUploadedFiles
});

export const initializeChatSession = (
  transcript: string,
  studyGuide: string,
  access?: AccessContext,
  slides?: string,
  rawNotes?: string
): ChatSession => {
  return {
    async *sendMessageStream({ history }: { message: string; history: ChatMessage[] }) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const payload: {
        transcript: string;
        studyGuide: string;
        slides?: string;
        rawNotes?: string;
        messages: { role: string; content: string }[];
        demoCode?: string;
      } = {
        transcript,
        studyGuide,
        slides,
        rawNotes,
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
