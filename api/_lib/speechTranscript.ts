import { v2 as speechV2 } from '@google-cloud/speech';
import type { FilePayload } from './gemini.js';
import { GenerationRetryError } from './gemini.js';

type BatchRecognizeOperation = {
  promise(): Promise<[unknown, ...unknown[]]>;
};

type SpeechClientLike = {
  batchRecognize(
    request: Record<string, unknown>
  ): Promise<[BatchRecognizeOperation, ...unknown[]]>;
};

type SpeechTranscriptDeps = {
  clientFactory?: (location: string) => SpeechClientLike;
  getProjectId?: () => string | undefined;
  getBucketName?: () => string | undefined;
  getLocation?: () => string;
  getLanguageCodes?: () => string[];
};

const DEFAULT_LOCATION = 'us';
const DEFAULT_LANGUAGE_CODES = ['auto'];
const DEFAULT_MODEL = 'chirp_3';

const defaultClientFactory = (location: string): SpeechClientLike =>
  new speechV2.SpeechClient({
    apiEndpoint: `${location}-speech.googleapis.com`
  });

const getDefaultProjectId = (): string | undefined =>
  process.env.SPEECH_TO_TEXT_PROJECT_ID?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GCP_PROJECT?.trim();

const getDefaultBucketName = (): string | undefined =>
  process.env.GCS_BUCKET?.trim();

const getDefaultLocation = (): string =>
  process.env.SPEECH_TO_TEXT_LOCATION?.trim() || DEFAULT_LOCATION;

const getDefaultLanguageCodes = (): string[] => {
  const raw = process.env.TRANSCRIPT_LANGUAGE_CODES?.trim();
  if (!raw) return [...DEFAULT_LANGUAGE_CODES];
  const codes = raw
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.length > 0 ? codes : [...DEFAULT_LANGUAGE_CODES];
};

const buildRecognizer = (projectId: string, location: string): string =>
  `projects/${projectId}/locations/${location}/recognizers/_`;

const buildGcsUri = (bucketName: string, objectName: string): string =>
  `gs://${bucketName}/${objectName.replace(/^\/+/, '')}`;

const extractTranscriptText = (response: unknown, audioUri: string): string => {
  const resultMap = (response as { results?: Record<string, any> } | undefined)?.results;
  const transcriptResults = resultMap?.[audioUri]?.transcript?.results;
  if (!Array.isArray(transcriptResults)) {
    return '';
  }

  return transcriptResults
    .map((result) => result?.alternatives?.[0]?.transcript ?? '')
    .filter((chunk) => typeof chunk === 'string' && chunk.trim().length > 0)
    .join('\n')
    .trim();
};

export function createSpeechTranscriptGenerator(deps: SpeechTranscriptDeps = {}) {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  const getProjectId = deps.getProjectId ?? getDefaultProjectId;
  const getBucketName = deps.getBucketName ?? getDefaultBucketName;
  const getLocation = deps.getLocation ?? getDefaultLocation;
  const getLanguageCodes = deps.getLanguageCodes ?? getDefaultLanguageCodes;

  return async (audio: FilePayload): Promise<string> => {
    const projectId = getProjectId();
    if (!projectId) {
      throw new Error('Server Config Error: Missing Google Cloud project id for Speech-to-Text.');
    }

    const bucketName = getBucketName();
    if (!bucketName) {
      throw new Error('Server Config Error: Missing GCS bucket for Speech-to-Text input.');
    }

    const location = getLocation();
    const audioUri = buildGcsUri(bucketName, audio.objectName);
    const client = clientFactory(location);

    const request = {
      recognizer: buildRecognizer(projectId, location),
      config: {
        autoDecodingConfig: {},
        languageCodes: getLanguageCodes(),
        model: DEFAULT_MODEL,
        features: {
          enableAutomaticPunctuation: true
        },
        denoiserConfig: {
          denoiseAudio: true,
          snrThreshold: 0
        }
      },
      files: [{ uri: audioUri }],
      recognitionOutputConfig: {
        inlineResponseConfig: {}
      }
    };

    const [operation] = await client.batchRecognize(request);
    const [response] = await operation.promise();
    const transcriptText = extractTranscriptText(response, audioUri);

    if (!transcriptText) {
      throw new GenerationRetryError('Received empty transcript response.');
    }

    return transcriptText;
  };
}

export const generateTranscriptFromSpeech = createSpeechTranscriptGenerator();
