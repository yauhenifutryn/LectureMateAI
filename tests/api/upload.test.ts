import { describe, it, expect } from 'vitest';
import { buildUploadConfig } from '../../api/upload';

describe('buildUploadConfig', () => {
  it('limits content types and size', () => {
    const config = buildUploadConfig();
    expect(config.allowedContentTypes.length).toBeGreaterThan(0);
    expect(config.maxFileSize).toBeGreaterThan(0);
  });
});
