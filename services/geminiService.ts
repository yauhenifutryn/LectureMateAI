import type { AccessContext, ChatMessage, ChatSession, AnalysisResult } from '../types';

type UploadedFile = {
  objectName: string;
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
  modelId?: string;
  inputs?: {
    audio: boolean;
    slidesCount: number;
  };
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

type ParsedResponse<T> = {
  json?: T;
  text?: string;
};

const parseResponse = async <T>(response: Response): Promise<ParsedResponse<T>> => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return { json: (await response.json()) as T };
    } catch {
      // fall through to text
    }
  }
  try {
    return { text: await response.text() };
  } catch {
    return {};
  }
};

const normalizeErrorMessage = (
  response: Response,
  jsonError?: { message?: string },
  text?: string,
  fallback?: string
): string => {
  if (jsonError?.message) return jsonError.message;
  const trimmed = text?.trim();
  if (trimmed) {
    if (!trimmed.startsWith('<')) {
      return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
    }
  }
  if (response.statusText) return response.statusText;
  return fallback || 'Request failed.';
};

const getMimeType = (file: File) => {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  return 'audio/mpeg';
};

const sanitizeFileName = (name: string) =>
  name.replace(/[^\x20-\x7E]/g, '').replace(/[^\w.-]/g, '_');

type UploadContext = {
  jobId: string;
  access?: AccessContext;
};

const requestUploadUrl = async (
  file: File,
  context: UploadContext
): Promise<{ uploadUrl: string; objectName: string }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body: { filename: string; mimeType: string; jobId: string; demoCode?: string } = {
    filename: sanitizeFileName(file.name || 'upload'),
    mimeType: getMimeType(file),
    jobId: context.jobId
  };

  if (context.access?.mode === 'admin') {
    headers.Authorization = `Bearer ${context.access.token}`;
  } else if (context.access?.mode === 'demo') {
    body.demoCode = context.access.token;
  }

  const response = await fetch('/api/gcs/upload-url', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const { json: data, text } = await parseResponse<{
    uploadUrl?: string;
    objectName?: string;
    error?: { message?: string };
  }>(response);
  if (!response.ok || !data?.uploadUrl || !data?.objectName) {
    throw new Error(
      normalizeErrorMessage(response, data?.error, text, 'Failed to prepare upload.')
    );
  }

  return { uploadUrl: data.uploadUrl, objectName: data.objectName };
};

const uploadToGcs = async (file: File, context: UploadContext): Promise<UploadedFile> => {
  const { uploadUrl, objectName } = await requestUploadUrl(file, context);
  const mimeType = getMimeType(file);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType
    },
    body: file
  });

  if (!response.ok) {
    throw new Error('Upload failed.');
  }

  return { objectName, mimeType };
};

type AnalyzeStage = 'uploading' | 'processing';

type AnalyzeOptions = {
  onStageChange?: (stage: AnalyzeStage) => void;
  onUploadComplete?: (objectNames: string[]) => void;
  onStatusUpdate?: (status: JobStatusResponse) => void;
  access?: AccessContext;
  modelId?: string;
};

type AnalyzeDependencies = {
  uploadToBlob: (file: File, context: UploadContext) => Promise<UploadedFile>;
  createJob: (
    payload: { audio?: UploadedFile; slides: UploadedFile[]; userContext: string; modelId?: string },
    access?: AccessContext
  ) => Promise<JobCreateResponse>;
  startJob: (jobId: string, access?: AccessContext) => Promise<void>;
  getJobStatus: (jobId: string, access?: AccessContext) => Promise<JobStatusResponse>;
  fetchResultText: (resultUrl: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
};

type CleanupDependencies = AnalyzeDependencies & {
  cleanupUploadedFiles: (objectNames: string[], access?: AccessContext) => Promise<void>;
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
    modelId?: string;
  },
  access?: AccessContext
): Promise<JobCreateResponse> => {
  const headers = buildHeaders(access);
  const bodyPayload = { ...payload } as {
    audio?: UploadedFile;
    slides: UploadedFile[];
    userContext: string;
    modelId?: string;
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

  const { json: data, text } = await parseResponse<JobCreateResponse>(response);
  if (!response.ok) {
    return {
      error: {
        message: normalizeErrorMessage(response, data?.error, text, 'Processing failed.')
      }
    };
  }
  if (!data) {
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

  const response = await fetch('/api/process', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...bodyPayload, action: 'run' })
  });

  if (!response.ok) {
    const { json: data, text } = await parseResponse<JobStatusResponse>(response);
    throw new Error(
      normalizeErrorMessage(response, data?.error, text, 'Processing failed.')
    );
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

  const response = await fetch(`/api/process?${params.toString()}`, {
    method: 'GET',
    headers
  });

  const { json: data, text } = await parseResponse<JobStatusResponse>(response);
  if (!response.ok) {
    return {
      error: {
        message: normalizeErrorMessage(response, data?.error, text, 'Status failed.')
      }
    };
  }
  return data ?? { error: { message: 'Status failed.' } };
};

const fetchResultText = async (resultUrl: string): Promise<string> => {
  const response = await fetch(resultUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch analysis result.');
  }
  return response.text();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSIENT_ERROR_CODES = new Set(['dispatch_failed', 'overloaded_retry', 'generation_retry']);

const isTransientStatusError = (status: JobStatusResponse): boolean => {
  const code = status.error?.code;
  if (!code) return false;
  if (status.status === 'failed') return false;
  return TRANSIENT_ERROR_CODES.has(code);
};

const pollJobStatus = async (
  jobId: string,
  access: AccessContext | undefined,
  getStatus: (jobId: string, access?: AccessContext) => Promise<JobStatusResponse>,
  wait: (ms: number) => Promise<void>,
  runJob?: (jobId: string, access?: AccessContext) => Promise<void>,
  onStatusUpdate?: (status: JobStatusResponse) => void,
  maxAttempts = 120
): Promise<JobStatusResponse> => {
  let delayMs = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getStatus(jobId, access);
    onStatusUpdate?.(status);
    if (status.error && !isTransientStatusError(status)) {
      return status;
    }
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    if (runJob && (status.status === 'queued' || status.status === 'processing')) {
      if (!status.stage || status.stage === 'queued' || status.stage === 'uploading' || status.stage === 'polling' || status.stage === 'generating') {
        try {
          await runJob(jobId, access);
        } catch (error) {
          console.error('Failed to advance processing job:', error);
        }
      }
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

  if (!transcript || transcript.trim().length === 0) {
    transcript = '(No transcript provided.)';
  }

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
    const uploadBatchId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const uploadContext = { jobId: uploadBatchId, access: options?.access };
    const audio = audioFile ? await uploadFn(audioFile, uploadContext) : undefined;
    const slides = await Promise.all(slideFiles.map((file) => uploadFn(file, uploadContext)));
    const uploadedObjects = [
      ...(audio ? [audio.objectName] : []),
      ...slides.map((slide) => slide.objectName)
    ];
    options?.onUploadComplete?.(uploadedObjects);

    const jobResponse = await createJob(
      {
        audio,
        slides,
        userContext,
        modelId: options?.modelId
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
    sleepFn || sleep,
    startJob,
    options?.onStatusUpdate
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
  uploadToBlob: uploadToGcs,
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
    let uploadedObjects: string[] = [];

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
        onUploadComplete: (objects) => {
          uploadedObjects = objects;
          options?.onUploadComplete?.(objects);
        }
      });
    } catch (error) {
      if (uploadedObjects.length > 0) {
        await cleanupFn(uploadedObjects, options?.access);
      }
      throw error;
    }
  };

export const cleanupUploadedFiles = async (
  objects: string[],
  access?: AccessContext
): Promise<void> => {
  if (!objects || objects.length === 0) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const payload: { objects: string[]; demoCode?: string } = { objects };

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
  uploadToBlob: uploadToGcs,
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

      const { json: data, text } = await parseResponse<ChatResponse>(response);
      if (!response.ok || data?.error) {
        throw new Error(
          normalizeErrorMessage(response, data?.error, text, 'Chat failed.')
        );
      }

      const reply = data?.reply || '';
      yield { text: reply };
    }
  };
};
