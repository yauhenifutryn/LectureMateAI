import { describe, expect, it } from 'vitest';
import { buildUploadObjectName, buildResultObjectName, parseBucketEnv } from '../../api/_lib/gcs';

describe('gcs helpers', () => {
  it('builds upload object names with jobId prefix', () => {
    const name = buildUploadObjectName('job-1', 'audio.mp3');
    expect(name).toMatch(/^uploads\/job-1\//);
  });

  it('builds result object names', () => {
    const name = buildResultObjectName('job-1');
    expect(name).toBe('results/job-1/study-guide.md');
  });

  it('throws when GCS_BUCKET is missing', () => {
    delete process.env.GCS_BUCKET;
    expect(() => parseBucketEnv()).toThrow('GCS_BUCKET');
  });
});
