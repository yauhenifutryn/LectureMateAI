export const parseBucketEnv = (): string => {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error('GCS_BUCKET is required');
  }
  return bucket;
};

export const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export const getMaxUploadBytes = (): number => {
  const raw = Number(process.env.MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return raw;
};

export const buildUploadObjectName = (jobId: string, filename: string): string => {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `uploads/${jobId}/${Date.now()}-${safeName}`;
};

export const buildResultObjectName = (jobId: string): string =>
  `results/${jobId}/study-guide.md`;

export const buildTranscriptObjectName = (jobId: string): string =>
  `results/${jobId}/transcript.txt`;

export const createSignedUploadUrl = async (
  objectName: string,
  contentType: string
): Promise<string> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + getUploadUrlTtlMs(),
    contentType
  });
  return url;
};

export const createSignedReadUrl = async (objectName: string): Promise<string> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + getResultUrlTtlMs()
  });
  return url;
};

export const uploadTextObject = async (
  objectName: string,
  content: string,
  contentType = 'text/plain'
): Promise<void> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  await storage.bucket(bucketName).file(objectName).save(content, { contentType });
};

export const downloadObjectBuffer = async (objectName: string): Promise<Buffer> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const [data] = await storage.bucket(bucketName).file(objectName).download();
  return data;
};

export const getObjectSizeBytes = async (objectName: string): Promise<number> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const [metadata] = await storage.bucket(bucketName).file(objectName).getMetadata();
  const size = Number(metadata.size ?? 0);
  return Number.isFinite(size) ? size : 0;
};

export const deleteObjects = async (objectNames: string[]): Promise<void> => {
  if (objectNames.length === 0) return;
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const bucket = storage.bucket(bucketName);
  await Promise.all(
    objectNames.map(async (name) => {
      if (!name) return;
      try {
        await bucket.file(name).delete({ ignoreNotFound: true });
      } catch {
        // best effort
      }
    })
  );
};

export type ListedObject = { name: string; size: number };

export const listObjects = async (
  prefix: string,
  pageToken?: string
): Promise<{ files: ListedObject[]; nextPageToken?: string }> => {
  const storage = await getStorage();
  const bucketName = parseBucketEnv();
  const [files, , response] = await storage.bucket(bucketName).getFiles({
    prefix,
    pageToken,
    autoPaginate: false
  });
  const apiResponse = response as { nextPageToken?: string } | undefined;
  const mapped = files.map((file) => ({
    name: file.name,
    size: Number(file.metadata.size ?? 0)
  }));
  return { files: mapped, nextPageToken: apiResponse?.nextPageToken };
};

export const validateObjectName = (objectName: string): void => {
  if (!objectName || typeof objectName !== 'string') {
    throw new Error('Invalid object name.');
  }
  if (objectName.includes('..') || objectName.startsWith('/') || objectName.includes('\\')) {
    throw new Error('Invalid object name.');
  }
  if (!objectName.startsWith('uploads/') && !objectName.startsWith('results/')) {
    throw new Error('Invalid object name.');
  }
};

const getUploadUrlTtlMs = (): number => {
  const raw = Number(process.env.GCS_UPLOAD_URL_TTL_SECONDS ?? 900);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 15 * 60 * 1000;
};

const getResultUrlTtlMs = (): number => {
  const raw = Number(process.env.GCS_RESULT_URL_TTL_SECONDS ?? 86400);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 24 * 60 * 60 * 1000;
};

const getStorage = async () => {
  const { Storage } = await import('@google-cloud/storage');
  return new Storage();
};
