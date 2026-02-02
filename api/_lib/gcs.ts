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
