import 'dotenv/config';
import {
  OverloadRetryError,
  GenerationRetryError,
  uploadGeminiFiles,
  checkGeminiFiles,
  generateStudyGuideFromUploaded,
  generateTranscriptFromUploaded,
  cleanupGeminiFiles,
  getModelId
} from '../api/_lib/gemini.js';
import { cleanupBlobUrls } from '../api/_lib/blobCleanup.js';
import { toPublicError } from '../api/_lib/errors.js';
import { recordJobHistory } from '../api/_lib/jobHistory.js';
import { storeResultMarkdown, storeTranscriptText } from '../api/_lib/resultStorage.js';
import { clearActiveJobId, getJobRecord, updateJobRecord } from '../api/_lib/jobStore.js';
import { getMaxUploadBytes, getObjectSizeBytes } from '../api/_lib/gcs.js';

type WorkerResult = {
  jobId: string;
  status: string;
  stage?: string;
  progress?: number;
  resultUrl?: string;
  preview?: string;
  error?: { code?: string; message: string };
};

type WorkerExecutionContext = {
  taskName?: string;
  queueName?: string;
  retryCount?: number;
  attemptCount?: number;
};

const POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getPollTimeoutMs = (): number => {
  const raw = Number(process.env.WORKER_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_POLL_TIMEOUT_MS;
  return raw;
};

const buildPreview = (text: string, maxChars = 2000): string => {
  if (!text) return '';
  return text.slice(0, maxChars).trim();
};

const TRANSCRIPT_FALLBACK_ATTEMPTS = 3;
const TRANSCRIPT_UNAVAILABLE_PLACEHOLDER =
  '(Transcript unavailable after repeated empty responses from Gemini. Study guide generated without transcript.)';

const isTransientUpstreamError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (!message) return false;
  return [
    'fetch failed',
    'headers timeout',
    'socket hang up',
    'connection reset',
    'econnreset',
    'etimedout',
    'timeout awaiting',
    'temporarily unavailable',
    'service unavailable',
    '503',
    '429'
  ].some((fragment) => message.includes(fragment));
};

const isRetryableGenerationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (!message) return false;
  return [
    'empty transcript response',
    'empty response from gemini'
  ].some((fragment) => message.includes(fragment));
};

const stripResponseSections = (text: string): string => {
  if (!text) return '';
  let output = text.replace(/^\s*===\s*STUDY_GUIDE\s*===/i, '').trim();
  const stopMatch = /===\s*(TRANSCRIPT|SLIDES|RAW_NOTES)\s*===/i.exec(output);
  if (stopMatch && typeof stopMatch.index === 'number' && stopMatch.index >= 0) {
    output = output.slice(0, stopMatch.index).trim();
  }
  return output;
};

const shouldFallbackTranscript = (error: unknown, execution?: WorkerExecutionContext): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const attemptCount = execution?.attemptCount ?? 1;
  return (
    attemptCount >= TRANSCRIPT_FALLBACK_ATTEMPTS &&
    message.includes('empty transcript response')
  );
};

export async function runJob(jobId: string, execution?: WorkerExecutionContext): Promise<WorkerResult> {
  const job = await getJobRecord(jobId);
  if (!job) {
    throw new Error('Job not found.');
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return {
      jobId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      resultUrl: job.resultUrl,
      preview: job.preview,
      error: job.error
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Server Config Error: Missing API Key');
  }

  const audioCleanupUrls = job.request.audio?.objectName ? [job.request.audio.objectName] : [];
  const slideCleanupUrls = job.request.slides.map((slide) => slide.objectName);

  let blobCleanupUrls: string[] = [];
  let shouldCleanupGemini = false;
  let uploaded = job.uploaded ?? [];

  try {
    const maxBytes = getMaxUploadBytes();
    if (job.request.audio?.objectName) {
      const size = await getObjectSizeBytes(job.request.audio.objectName);
      if (size > maxBytes) {
        throw new Error('File too large.');
      }
    }
    for (const slide of job.request.slides) {
      const size = await getObjectSizeBytes(slide.objectName);
      if (size > maxBytes) {
        throw new Error('File too large.');
      }
    }

    if (uploaded.length === 0) {
      await updateJobRecord(jobId, {
        status: 'processing',
        stage: 'uploading',
        progress: 5,
        error: undefined
      });

      const sources: {
        payload: { objectName: string; mimeType: string };
        displayName: string;
        kind: 'audio' | 'slide';
      }[] = [];
      if (job.request.audio) {
        sources.push({ payload: job.request.audio, displayName: 'Lecture Audio', kind: 'audio' });
      }
      job.request.slides.forEach((slide, index) => {
        sources.push({ payload: slide, displayName: `Lecture Slide ${index + 1}`, kind: 'slide' });
      });

      uploaded = await uploadGeminiFiles(apiKey, sources);
      await updateJobRecord(jobId, {
        status: 'processing',
        stage: 'polling',
        progress: 25,
        uploaded,
        error: undefined
      });
    }

    const pollStart = Date.now();
    while (true) {
      const readiness = await checkGeminiFiles(apiKey, uploaded);
      if (readiness.failed) {
      const failed = await updateJobRecord(jobId, {
        status: 'failed',
        stage: 'polling',
        error: { code: 'gemini_processing_failed', message: 'Gemini file processing failed.' }
      });
      await clearActiveJobId(job.access, jobId).catch((clearError) => {
        console.error('Failed to clear active job id:', clearError);
      });
      blobCleanupUrls = [...audioCleanupUrls];
      shouldCleanupGemini = true;
        return {
          jobId,
          status: failed.status,
          stage: failed.stage,
          progress: failed.progress,
          error: failed.error
        };
      }
      if (readiness.ready) {
        break;
      }
      if (Date.now() - pollStart > getPollTimeoutMs()) {
        throw new GenerationRetryError('Gemini processing still pending.');
      }
      const progress = 25 + Math.floor((readiness.readyCount / Math.max(1, readiness.total)) * 40);
      await updateJobRecord(jobId, {
        status: 'processing',
        stage: 'polling',
        progress,
        error: undefined
      });
      await sleep(POLL_INTERVAL_MS);
    }

    await updateJobRecord(jobId, {
      status: 'processing',
      stage: 'generating',
      progress: 80,
      error: undefined
    });

    console.info('Worker model:', getModelId(job.request.modelId));
    if (execution?.taskName) {
      console.info('Worker execution:', {
        jobId,
        taskName: execution.taskName,
        retryCount: execution.retryCount,
        attemptCount: execution.attemptCount
      });
    }

    let transcriptText: string | null = null;
    let transcriptOutputText: string | null = null;
    if (job.request.audio) {
      try {
        transcriptText = await generateTranscriptFromUploaded(
          apiKey,
          {
            audio: job.request.audio,
            modelId: job.request.modelId
          },
          uploaded
        );
        if (!transcriptText || transcriptText.trim().length === 0) {
          throw new GenerationRetryError('Received empty transcript response.');
        }
        transcriptOutputText = transcriptText;
      } catch (error) {
        if (!shouldFallbackTranscript(error, execution)) {
          throw error;
        }
        transcriptText = null;
        transcriptOutputText = TRANSCRIPT_UNAVAILABLE_PLACEHOLDER;
        console.warn('Transcript fallback activated:', {
          jobId,
          taskName: execution?.taskName,
          retryCount: execution?.retryCount,
          attemptCount: execution?.attemptCount
        });
      }
    }

    const resultText = await generateStudyGuideFromUploaded(
      apiKey,
      {
        audio: job.request.audio,
        slides: job.request.slides,
        userContext: job.request.userContext,
        transcriptText: transcriptText ?? undefined,
        modelId: job.request.modelId
      },
      uploaded
    );
    const cleanStudyGuideText = stripResponseSections(resultText) || resultText.trim();
    const resultUrl = await storeResultMarkdown(cleanStudyGuideText, jobId);
    const transcriptUrl = transcriptOutputText
      ? await storeTranscriptText(transcriptOutputText, jobId)
      : null;

    const completed = await updateJobRecord(jobId, {
      status: 'completed',
      stage: 'generating',
      progress: 100,
      resultUrl: resultUrl || undefined,
      transcriptUrl: transcriptUrl || undefined,
      preview: buildPreview(cleanStudyGuideText),
      error: undefined
    });
    await recordJobHistory(completed).catch((error) => {
      console.error('Failed to record job history:', error);
    });
    await clearActiveJobId(job.access, jobId).catch((clearError) => {
      console.error('Failed to clear active job id:', clearError);
    });

    blobCleanupUrls = [...audioCleanupUrls, ...slideCleanupUrls];
    shouldCleanupGemini = true;

    return {
      jobId,
      status: completed.status,
      stage: completed.stage,
      progress: completed.progress,
      resultUrl: completed.resultUrl,
      preview: completed.preview
    };
  } catch (error) {
    if (error instanceof OverloadRetryError) {
      const retryError = {
        code: 'overloaded_retry',
        message: 'Gemini is overloaded. Retrying shortly.'
      };
      const queued = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error: retryError
      });
      return {
        jobId,
        status: queued.status,
        stage: queued.stage,
        progress: queued.progress,
        error: queued.error
      };
    }
    if (error instanceof GenerationRetryError) {
      const retryError = {
        code: 'generation_retry',
        message: 'Gemini processing still pending. Retrying shortly.'
      };
      const queued = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error: retryError
      });
      return {
        jobId,
        status: queued.status,
        stage: queued.stage,
        progress: queued.progress,
        error: queued.error
      };
    }
    if (isRetryableGenerationError(error)) {
      const retryError = {
        code: 'generation_retry',
        message: 'Gemini returned empty output. Retrying shortly.'
      };
      const queued = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error: retryError
      });
      return {
        jobId,
        status: queued.status,
        stage: queued.stage,
        progress: queued.progress,
        error: queued.error
      };
    }
    if (isTransientUpstreamError(error)) {
      const retryError = {
        code: 'upstream_retry',
        message: 'Transient upstream error. Retrying shortly.'
      };
      const queued = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error: retryError
      });
      return {
        jobId,
        status: queued.status,
        stage: queued.stage,
        progress: queued.progress,
        error: queued.error
      };
    }
    const latestJob = await getJobRecord(jobId).catch(() => null);
    const failureStage = latestJob?.stage ?? job.stage;
    const failureProgress = latestJob?.progress ?? job.progress;
    console.error('Worker job failed:', {
      jobId,
      stage: failureStage,
      progress: failureProgress,
      taskName: execution?.taskName,
      retryCount: execution?.retryCount,
      attemptCount: execution?.attemptCount,
      error
    });
    const publicError = toPublicError(error);
    const failed = await updateJobRecord(jobId, {
      status: 'failed',
      stage: failureStage,
      error: publicError
    });
    await clearActiveJobId(job.access, jobId).catch((clearError) => {
      console.error('Failed to clear active job id:', clearError);
    });
    blobCleanupUrls = [...audioCleanupUrls];
    shouldCleanupGemini = uploaded.length > 0;
    return {
      jobId,
      status: failed.status,
      stage: failed.stage,
      progress: failed.progress,
      error: failed.error
    };
  } finally {
    if (shouldCleanupGemini && uploaded.length > 0) {
      await cleanupGeminiFiles(apiKey, uploaded).catch((error) => {
        console.error('Gemini cleanup failed:', error);
      });
    }
    if (blobCleanupUrls.length > 0) {
      await cleanupBlobUrls(blobCleanupUrls, console);
    }
  }
}
