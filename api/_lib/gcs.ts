export const parseBucketEnv = (): string => {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error('GCS_BUCKET is required');
  }
  return bucket;
};

export const buildUploadObjectName = (jobId: string, filename: string): string => {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `uploads/${jobId}/${Date.now()}-${safeName}`;
};

export const buildResultObjectName = (jobId: string): string =>
  `results/${jobId}/study-guide.md`;

export const createSignedUploadUrl = async (
  objectName: string,
  contentType: string
): Promise<string> => {
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucketName = parseBucketEnv();
  const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 15 * 60 * 1000,
    contentType
  });
  return url;
};
