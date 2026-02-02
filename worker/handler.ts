import 'dotenv/config';
import {
  OverloadRetryError,
  GenerationRetryError,
  uploadGeminiFiles,
  checkGeminiFiles,
  generateStudyGuideFromUploaded,
  cleanupGeminiFiles,
  getModelId
} from '../api/_lib/gemini.js';
import { cleanupBlobUrls } from '../api/_lib/blobCleanup.js';
import { toPublicError } from '../api/_lib/errors.js';
import { storeResultMarkdown } from '../api/_lib/resultStorage.js';
import { getJobRecord, updateJobRecord } from '../api/_lib/jobStore.js';

type WorkerResult = {
  jobId: string;
  status: string;
  stage?: string;
  progress?: number;
  resultUrl?: string;
  preview?: string;
  error?: { code?: string; message: string };
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

const TRANSCRIPT_SEPARATOR = '===TRANSCRIPT===';
const SLIDES_SEPARATOR = '===SLIDES===';
const RAW_NOTES_SEPARATOR = '===RAW_NOTES===';

const extractTranscript = (text: string): string | null => {
  const transIdx = text.indexOf(TRANSCRIPT_SEPARATOR);
  if (transIdx === -1) return null;
  const after = transIdx + TRANSCRIPT_SEPARATOR.length;
  const slidesIdx = text.indexOf(SLIDES_SEPARATOR);
  const rawIdx = text.indexOf(RAW_NOTES_SEPARATOR);
  const endCandidates = [slidesIdx, rawIdx].filter((idx) => idx !== -1 && idx > after);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  const transcript = text.substring(after, end).trim();
  if (!transcript) return null;
  return transcript;
};

export async function runJob(jobId: string): Promise<WorkerResult> {
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

  const cleanupUrls = [
    ...(job.request.audio?.objectName ? [job.request.audio.objectName] : []),
    ...job.request.slides.map((slide) => slide.objectName)
  ];

  let shouldCleanupBlob = false;
  let shouldCleanupGemini = false;
  let uploaded = job.uploaded ?? [];

  try {
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
        shouldCleanupBlob = cleanupUrls.length > 0;
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

    const resultText = await generateStudyGuideFromUploaded(
      apiKey,
      {
        audio: job.request.audio,
        slides: job.request.slides,
        userContext: job.request.userContext,
        modelId: job.request.modelId
      },
      uploaded
    );

    if (!extractTranscript(resultText)) {
      throw new Error('Transcript missing in output.');
    }

    const resultUrl = await storeResultMarkdown(resultText, jobId);

    const completed = await updateJobRecord(jobId, {
      status: 'completed',
      stage: 'generating',
      progress: 100,
      resultUrl: resultUrl || undefined,
      preview: buildPreview(resultText),
      error: undefined
    });

    shouldCleanupBlob = cleanupUrls.length > 0;
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
    const publicError = toPublicError(error);
    const failed = await updateJobRecord(jobId, {
      status: 'failed',
      stage: job.stage,
      error: publicError
    });
    shouldCleanupBlob = cleanupUrls.length > 0;
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
    if (shouldCleanupBlob && cleanupUrls.length > 0) {
      await cleanupBlobUrls(cleanupUrls, console);
    }
  }
}
